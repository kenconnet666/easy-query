/**
 * 查询构建器。方法只记下 lambda，执行（toList、count …）时才在新的构建现场里求值、生成语法树，
 * 所以构建器不可变、可以复用：`const base = db.queryable(User).where(...)`，再分别 `base.count()`、`base.limit(10).toList()`。
 */
import { checkAliases, type Node, type OrderNode, type SelectNode } from './ast.ts'
import { SqlWriter, type Statement } from './dialect.ts'
import { aggregate, aggregateCodec, codecs, condNode, Expr, orderNodes, type Cond, type Numeric, type OrderItem } from './expr.ts'
import { columnNode, ListOf, makeRef, REF, Scope, type AnyRef, type Ref, type Selected } from './ref.ts'
import type { AnySchema, EntityKey } from './relations.ts'
import type { KeyOf } from './db.ts'
import type { Codec, Entity, Row } from './schema.ts'
import { refEntity } from './interceptor.ts'
import { query, type Context } from './session.ts'

/** 构建时求值的 lambda：单表查询收到一个表引用，join 之后按 join 顺序收到多个 */
type Fn<R> = (...refs: any[]) => R
type Orders = OrderItem | readonly OrderItem[]

/** 一次显式 join：目标实体、种类、ON 条件（收到此前所有表引用加上新表引用） */
interface JoinSpec {
  readonly key: string
  readonly kind: 'inner' | 'left'
  readonly on: Fn<Cond>
}

interface State {
  readonly key: string
  /** 显式 join，按调用顺序 */
  readonly joins: readonly JoinSpec[]
  readonly where: readonly Fn<Cond>[]
  readonly orderBy: readonly Fn<Orders>[]
  readonly select: Fn<unknown> | undefined
  readonly group: Fn<Record<string, Expr<unknown>>> | undefined
  readonly having: readonly Fn<Cond>[]
  readonly groupOrderBy: readonly Fn<Orders>[]
  readonly groupSelect: Fn<unknown> | undefined
  readonly limit: number | undefined
  readonly offset: number | undefined
  readonly distinct: boolean
  readonly forUpdate: boolean
  /** noInterceptor 关掉的拦截器 */
  readonly disabled: readonly string[]
}

/**
 * join 之后没写 select 时的结果类型：第一次 join 把主表的整行包成 `{ 主表: Row }`，之后每次加一张表。
 * nullable 为 true（left join）时新表的整行可空。
 */
export type JoinedRows<S extends AnySchema, K extends string, Out, Refs extends readonly unknown[], T extends EntityKey<S>, Nullable extends boolean> =
  Flatten<(Refs extends readonly [unknown] ? { [Q in K]: Out } : Out) & { [Q in T]: Nullable extends true ? Row<S['entities'][T]> | null : Row<S['entities'][T]> }>

/** 把交叉类型摊平成一个对象类型，提示和比较都更直观 */
type Flatten<T> = { [P in keyof T]: T[P] }

export interface Page<T> {
  readonly rows: T[]
  readonly total: number
  readonly page: number
  readonly size: number
}

/** 终结方法：各种查询共用 */
abstract class Executable<Out> {
  protected readonly ctx: Context
  protected readonly state: State

  constructor(ctx: Context, state: State) {
    this.ctx = ctx
    this.state = state
  }

  protected abstract with(patch: Partial<State>): this

  limit(n: number): this { return this.with({ limit: n }) }
  offset(n: number): this { return this.with({ offset: n }) }
  distinct(): this { return this.with({ distinct: true }) }

  async toList(): Promise<Out[]> {
    const built = build(this.ctx, this.state)
    return (await run(this.ctx, built.select, built.shape)) as Out[]
  }

  /** 第一行；没有时 undefined */
  async first(): Promise<Out | undefined> {
    return (await this.limit(1).toList())[0]
  }

  /** 恰好一行，否则抛错 */
  async single(): Promise<Out> {
    const rows = await this.limit(2).toList()
    if (rows.length !== 1) throw new Error(`expected exactly one row, got ${rows.length === 0 ? 'none' : 'more than one'}`)
    return rows[0]!
  }

  async count(): Promise<number> {
    const rows = await query(this.ctx, this.countStatement())
    return Number(rows[0]?.['n'] ?? 0)
  }

  async any(): Promise<boolean> {
    const built = build(this.ctx, { ...this.state, limit: 1, offset: undefined }, true)
    return (await query(this.ctx, render(this.ctx, built.select))).length > 0
  }

  /** page 从 1 开始 */
  async toPage(page: number, size: number): Promise<Page<Out>> {
    const total = await this.count()
    const rows = total === 0 ? [] : await this.offset((page - 1) * size).limit(size).toList()
    return { rows, total, page, size }
  }

  toSQL(): Statement {
    return render(this.ctx, build(this.ctx, this.state).select)
  }

  private countStatement(): Statement {
    const plain = { ...this.state, orderBy: [], groupOrderBy: [], limit: undefined, offset: undefined }
    const grouped = this.state.group !== undefined || this.state.distinct
    const built = build(this.ctx, plain, !grouped)
    const n = this.ctx.dialect.quote('n')
    if (!grouped) {
      return render(this.ctx, { ...built.select, columns: [{ e: { k: 'agg', fn: 'count', arg: undefined, distinct: false }, as: 'n' }] })
    }
    const w = new SqlWriter()
    checkAliases(built.select)
    const sql = `SELECT COUNT(*) AS ${n} FROM (${this.ctx.dialect.select(built.select, w)}) eq_count`
    return { sql, params: w.params }
  }
}

/**
 * 单实体出发的查询；导航在 lambda 里随用随 join。
 * ```ts
 * await db.queryable(User)
 *   .where(u => [u.name.like('ts'), age != null && u.age.ge(age), u.posts.any(p => p.title.startsWith('orm'))])
 *   .orderBy(u => [u.createdAt.desc(), u.id])
 *   .select(u => ({ id: u.id, company: u.company.name, posts: u.posts.toList(p => ({ title: p.title })) }))
 *   .toList()
 * ```
 */
export class Queryable<S extends AnySchema, K extends EntityKey<S>, Out = Row<S['entities'][K]>, Refs extends readonly unknown[] = [Ref<S, K>]> extends Executable<Out> {
  protected with(patch: Partial<State>): this {
    return new Queryable(this.ctx, { ...this.state, ...patch }) as this
  }

  where(filter: (...refs: Refs) => Cond): Queryable<S, K, Out, Refs> {
    return this.with({ where: [...this.state.where, filter] })
  }

  orderBy(order: (...refs: Refs) => Orders): Queryable<S, K, Out, Refs> {
    return this.with({ orderBy: [...this.state.orderBy, order] })
  }

  /** 结果的形状：表达式、导航到的整行、toList 数组、嵌套对象都可以；结果类型据此推导 */
  select<X>(shape: (...refs: Refs) => X): Queryable<S, K, Selected<X>, Refs> {
    return new Queryable(this.ctx, { ...this.state, select: shape })
  }

  /** 整行之外再带上导航：一对多是数组，多对一是对象（可空导航为 null） */
  include<X extends Record<string, ListOf<unknown> | AnyRef>>(navigations: (...refs: Refs) => X): Queryable<S, K, Out & Selected<X>, Refs> {
    const previous = this.state.select
    return new Queryable(this.ctx, {
      ...this.state,
      select: (...refs: unknown[]) => ({ ...spreadShape(previous ? previous(...refs) : refs[0]), ...navigations(...(refs as unknown as Refs)) }),
    })
  }

  /** 行锁（SELECT … FOR UPDATE），在事务里用 */
  forUpdate(): Queryable<S, K, Out, Refs> {
    return this.with({ forUpdate: true })
  }

  /** 这条查询不用这些拦截器（按 name，如 'tenant'） */
  noInterceptor(...names: string[]): Queryable<S, K, Out, Refs> {
    return this.with({ disabled: [...this.state.disabled, ...names] })
  }

  /**
   * 内连接另一张表（INNER JOIN）。on 收到此前所有表引用加上新表引用；之后的 where / orderBy / select 也按这个顺序收到它们。
   * 没写 select 时结果是每张表的整行，按实体名分组：`{ User: Row, Post: Row }`。必须在 select 之前调用。
   * ```ts
   * db.queryable(User).innerJoin(Post, (u, p) => p.userId.eq(u.id)).where((u, p) => p.amount.gt('5')).select((u, p) => ({ name: u.name, title: p.title }))
   * ```
   */
  innerJoin<E extends S['entities'][EntityKey<S>]>(
    entity: E,
    on: (...refs: [...Refs, Ref<S, KeyOf<S, E>>]) => Cond,
  ): Queryable<S, K, JoinedRows<S, K, Out, Refs, KeyOf<S, E>, false>, [...Refs, Ref<S, KeyOf<S, E>>]> {
    return this.join('inner', entity, on)
  }

  /** 左连接另一张表（LEFT JOIN）：新表在 select 里的列都可空，没匹配到时整行为 null。其余同 innerJoin */
  leftJoin<E extends S['entities'][EntityKey<S>]>(
    entity: E,
    on: (...refs: [...Refs, Ref<S, KeyOf<S, E>>]) => Cond,
  ): Queryable<S, K, JoinedRows<S, K, Out, Refs, KeyOf<S, E>, true>, [...Refs, Ref<S, KeyOf<S, E>, true>]> {
    return this.join('left', entity, on)
  }

  private join(kind: 'inner' | 'left', entity: Entity, on: Fn<Cond>): never {
    if (this.state.select) throw new Error(`${kind}Join() must be called before select(): the selected shape is already fixed`)
    const key = Object.keys(this.ctx.schema.entities).find((k) => this.ctx.schema.entities[k] === entity)
    if (key === undefined) throw new Error(`entity for table '${entity.table}' is not part of the schema`)
    return new Queryable(this.ctx, { ...this.state, joins: [...this.state.joins, { key, kind, on }] }) as never
  }

  /** 满足条件的行里该值的和；没有行（或全为 NULL）时为 null。decimal 列得到数值文字，不经过浮点 */
  sum<V extends Numeric | null>(value: (...refs: Refs) => Expr<V>): Promise<NonNullable<V> | null> {
    return this.scalar('sum', value)
  }

  /** 平均值；没有行时为 null。整数列得到 number，decimal 列保持 decimal */
  avg<V extends Numeric | null>(value: (...refs: Refs) => Expr<V>): Promise<NonNullable<V> | null> {
    return this.scalar('avg', value)
  }

  /** 最大值；没有行时为 null */
  max<V>(value: (...refs: Refs) => Expr<V>): Promise<NonNullable<V> | null> {
    return this.scalar('max', value)
  }

  /** 最小值；没有行时为 null */
  min<V>(value: (...refs: Refs) => Expr<V>): Promise<NonNullable<V> | null> {
    return this.scalar('min', value)
  }

  /** 去重后的个数（NULL 不计） */
  async countDistinct(value: (...refs: Refs) => Expr<unknown>): Promise<number> {
    const rows = await this.aggregateQuery((...refs) => ({ v: aggregate<number>('count', value(...refs), codecs.int, true) })).toList()
    return Number(rows[0]?.v ?? 0)
  }

  /**
   * 整个查询折成一个聚合值：沿用 where 与拦截器条件，丢掉 orderBy。
   * limit / offset 作用在聚合之后的单行上没有意义，直接报错，免得悄悄返回错误的数字。
   */
  private async scalar(fn: 'sum' | 'avg' | 'max' | 'min', value: (...refs: Refs) => Expr<any>): Promise<any> {
    if (this.state.limit !== undefined || this.state.offset !== undefined) {
      throw new Error(`${fn}() cannot be combined with limit() / offset(); aggregate a paged subquery explicitly instead`)
    }
    const rows = await this.aggregateQuery((...refs) => {
      const e = value(...refs)
      return { v: aggregate<unknown>(fn, e, aggregateCodec(fn, e)) }
    }).toList()
    return rows[0]?.v ?? null
  }

  /** 把 select 换成一个聚合列，并清掉排序 / 分页 / distinct */
  private aggregateQuery<X>(shape: (...refs: Refs) => X): Queryable<S, K, Selected<X>, Refs> {
    return new Queryable(this.ctx, { ...this.state, select: shape, orderBy: [], limit: undefined, offset: undefined, distinct: false })
  }

  /** 分组；不调 select 时结果就是分组键 */
  groupBy<G extends Record<string, Expr<any>>>(keys: (...refs: Refs) => G): GroupedQueryable<S, K, G, Selected<G>, Refs> {
    return new GroupedQueryable(this.ctx, { ...this.state, group: keys as never })
  }
}

/** 分组里的聚合；`g.sum(p => p.amount)`、`g.count(p => p.amount.gt('1000'))` */
export interface Group<S extends AnySchema, K extends EntityKey<S>, G, Refs extends readonly unknown[] = [Ref<S, K>]> {
  readonly key: G
  /** 不带条件是 COUNT(*)；带条件只数满足的行 */
  count(filter?: (...refs: Refs) => Cond): Expr<number>
  countDistinct(value: (...refs: Refs) => Expr<unknown>): Expr<number>
  sum<V extends Numeric | null>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>
  avg<V extends Numeric | null>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>
  max<V>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>
  min<V>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>
}

export class GroupedQueryable<S extends AnySchema, K extends EntityKey<S>, G, Out, Refs extends readonly unknown[] = [Ref<S, K>]> extends Executable<Out> {
  protected with(patch: Partial<State>): this {
    return new GroupedQueryable(this.ctx, { ...this.state, ...patch }) as this
  }

  having(filter: (g: Group<S, K, G, Refs>) => Cond): GroupedQueryable<S, K, G, Out, Refs> {
    return this.with({ having: [...this.state.having, filter] })
  }

  orderBy(order: (g: Group<S, K, G, Refs>) => Orders): GroupedQueryable<S, K, G, Out, Refs> {
    return this.with({ groupOrderBy: [...this.state.groupOrderBy, order] })
  }

  select<X>(shape: (g: Group<S, K, G, Refs>) => X): GroupedQueryable<S, K, G, Selected<X>, Refs> {
    return new GroupedQueryable(this.ctx, { ...this.state, groupSelect: shape })
  }
}

export function newQueryable<S extends AnySchema, K extends EntityKey<S>>(ctx: Context, key: K): Queryable<S, K> {
  return new Queryable(ctx, {
    key, joins: [], where: [], orderBy: [], select: undefined, group: undefined, having: [], groupOrderBy: [], groupSelect: undefined,
    limit: undefined, offset: undefined, distinct: false, forUpdate: false, disabled: [],
  })
}

function spreadShape(shape: unknown): Record<string, unknown> {
  if (shape && typeof shape === 'object' && REF in shape) return refColumns(shape as AnyRef)
  return shape as Record<string, unknown>
}

function refColumns(ref: AnyRef): Record<string, unknown> {
  return Object.fromEntries(Object.keys(ref).map((k) => [k, (ref as unknown as Record<string, unknown>)[k]]))
}

interface Built {
  readonly select: SelectNode
  readonly shape: ShapeCompiler
}

/** 在新的构建现场里求值所有 lambda；bare 为 true 时不求值 select（count / any 用） */
function build(ctx: Context, state: State, bare = false): Built {
  const interceptors = ctx.interceptors.without(state.disabled)
  const scope = new Scope(ctx.schema, { n: 0 }, true, (ref) => interceptors.filters(ref, refEntity(ref)))
  const root = scope.root(state.key)
  // 所有 lambda 按"主表、第一个 join 的表、……"的顺序收到这些表引用
  const refs = joinTables(ctx, scope, root, state.joins)
  const where = [...conds(state.where.map((f) => f(...refs))), ...scope.filters(root)]
  const shape = new ShapeCompiler(ctx)
  let groupBy: Node[] = []
  let having: Node[] = []
  let orderBy: OrderNode[] = state.orderBy.flatMap((o) => orderNodes(o(...refs)))

  if (state.group) {
    const keys = state.group(...refs)
    groupBy = Object.values(keys).map((e) => e.node)
    const g = groupHandle(refs, keys)
    having = conds(state.having.map((f) => f(g)))
    orderBy = [...orderBy, ...state.groupOrderBy.flatMap((o) => orderNodes(o(g)))]
    if (!bare) shape.compile(state.groupSelect ? state.groupSelect(g) : keys)
  } else if (!bare) {
    shape.compile(state.select ? state.select(...refs) : state.joins.length === 0 ? root : joinedRows(state, refs))
  }

  const entity = ctx.schema.entities[state.key]!
  const select: SelectNode = {
    from: { table: entity.table, alias: root[REF].alias },
    joins: scope.joins, where, groupBy, having, orderBy,
    columns: shape.columns, distinct: state.distinct, limit: state.limit, offset: state.offset, forUpdate: state.forUpdate,
  }
  return { select, shape }
}

function conds(list: Cond[]): Node[] {
  return list.map(condNode).filter((n): n is Node => n !== undefined)
}

/**
 * 把显式 join 的表加进语句并返回所有表引用（主表在前）。
 * ON 条件收到此前所有表引用加上新表引用；拦截器给新表的条件也放进 ON，LEFT JOIN 不会因此丢掉主表的行。
 */
function joinTables(ctx: Context, scope: Scope, root: AnyRef, joins: readonly JoinSpec[]): AnyRef[] {
  const refs = [root]
  for (const spec of joins) {
    const target = ctx.schema.entities[spec.key]!
    const alias = scope.nextAlias()
    const ref = makeRef(scope, spec.key, alias, spec.kind === 'left')
    // 先登记再求值 ON：ON 里用导航产生的隐式 join 会排在它后面，引用到的别名已经声明
    const index = scope.joins.push({ table: target.table, alias, kind: spec.kind, on: { k: 'lit', sql: '1 = 1' } }) - 1
    refs.push(ref)
    const on = condNode(spec.on(...refs))
    if (!on) throw new Error(`${spec.kind}Join(${target.table}) needs an ON condition`)
    const extra = scope.filters(ref)
    scope.joins[index] = { table: target.table, alias, kind: spec.kind, on: extra.length === 0 ? on : { k: 'and', items: [on, ...extra] } }
  }
  return refs
}

/** 没写 select 的 join 查询：每张表的整行，按实体名分组；left join 的那张表没匹配时为 null */
function joinedRows(state: State, refs: readonly AnyRef[]): Record<string, AnyRef> {
  const keys = [state.key, ...state.joins.map((j) => j.key)]
  if (new Set(keys).size !== keys.length) {
    throw new Error('the same entity is joined more than once; call select() to name the columns you want')
  }
  return Object.fromEntries(keys.map((k, i) => [k, refs[i]!]))
}

function groupHandle(refs: readonly AnyRef[], key: unknown): Group<any, any, unknown, any> {
  const agg = (fn: 'sum' | 'avg' | 'max' | 'min') => (value: (...refs: any[]) => Expr<unknown>) => {
    const e = value(...refs)
    return aggregate<any>(fn, e, aggregateCodec(fn, e))
  }
  return {
    key,
    count: (filter) => {
      const n = filter ? condNode(filter(...(refs as never[]))) : undefined
      if (!n) return aggregate<number>('count', undefined, codecs.int)
      return new Expr<number>({ k: 'agg', fn: 'count', arg: { k: 'case', when: [[n, { k: 'lit', sql: '1' }]], else: undefined }, distinct: false }, codecs.int)
    },
    countDistinct: (value) => aggregate<number>('count', value(...(refs as never[])), codecs.int, true),
    sum: agg('sum'),
    avg: agg('avg'),
    max: agg('max'),
    min: agg('min'),
  }
}

type Reader = (row: Record<string, unknown>) => unknown

/** toList 等待第二条查询填充的数组：父行的键 → 这些父行上的数组 */
interface PendingList {
  readonly list: ListOf<unknown, boolean>
  readonly slots: Map<string, { readonly key: unknown; readonly arrays: unknown[][] }>
}

/** 把 select 形状拆成扁平的列，同时生成按行重组对象的读取函数 */
class ShapeCompiler {
  readonly columns: { e: Node; as: string }[] = []
  readonly lists: PendingList[] = []
  /** first() 的数组在第二条查询填完后换成第一项或 null */
  readonly fixups: (() => void)[] = []
  read: Reader = () => undefined
  private readonly ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  compile(shape: unknown): void {
    if (shape instanceof ListOf && shape.single) throw new TypeError('first() must be a property of a select object')
    this.read = this.reader(shape)
  }

  /** 不出现在结果里、只给拼装用的列 */
  hidden(e: Node): string {
    const as = `k${this.columns.length}`
    this.columns.push({ e, as })
    return as
  }

  private reader(x: unknown): Reader {
    if (x instanceof Expr) return this.expr(x)
    if (x instanceof ListOf) return this.list(x)
    if (x && typeof x === 'object' && REF in x) return this.ref(x as AnyRef)
    if (Array.isArray(x) || x === null || typeof x !== 'object') {
      throw new TypeError(`select values must be expressions, navigations, toList() or nested objects; got ${Array.isArray(x) ? 'an array' : String(x)}`)
    }
    const entries = Object.entries(x).map(([k, v]) => [k, this.reader(v), v instanceof ListOf && v.single] as const)
    return (row) => {
      const obj: Record<string, unknown> = {}
      for (const [k, read, single] of entries) {
        obj[k] = read(row)
        if (single) this.fixups.push(() => { obj[k] = (obj[k] as unknown[])[0] ?? null })
      }
      return obj
    }
  }

  private expr(e: Expr<unknown>): Reader {
    const as = `c${this.columns.length}`
    this.columns.push({ e: e.node, as })
    return decoder(as, e.codec)
  }

  /** 导航到的整行；可空导航在主键（无主键时所有列）都为 NULL 时整体为 null */
  private ref(ref: AnyRef): Reader {
    const info = ref[REF]
    const entity = this.ctx.schema.entities[info.key]!
    const props = Object.keys(entity.columns)
    const readers = props.map((p) => [p, this.expr((ref as unknown as Record<string, Expr<unknown>>)[p]!)] as const)
    const probe = entity.primaryKey.length > 0 ? entity.primaryKey : props
    return (row) => {
      const obj = Object.fromEntries(readers.map(([p, read]) => [p, read(row)]))
      if (info.nullable && probe.every((p) => obj[p] === null)) return null
      return obj
    }
  }

  private list(list: ListOf<unknown, boolean>): Reader {
    const keyAs = this.hidden(columnNode(list.many.scope, list.many.parent[REF], list.many.relation.from))
    const pending: PendingList = { list, slots: new Map() }
    this.lists.push(pending)
    return (row) => {
      const array: unknown[] = []
      const key = row[keyAs]
      if (key !== null && key !== undefined) {
        const id = String(key)
        let slot = pending.slots.get(id)
        if (!slot) pending.slots.set(id, (slot = { key, arrays: [] }))
        slot.arrays.push(array)
      }
      return array
    }
  }
}

function decoder(as: string, codec: Codec<any> | undefined): Reader {
  return (row) => {
    const raw = row[as]
    if (raw === null || raw === undefined) return null
    return codec ? codec.decode(raw) : raw
  }
}

function render(ctx: Context, select: SelectNode): Statement {
  checkAliases(select)
  const w = new SqlWriter()
  const sql = ctx.dialect.select(select, w)
  return { sql, params: w.params }
}

async function run(ctx: Context, select: SelectNode, shape: ShapeCompiler): Promise<unknown[]> {
  const rows = await query(ctx, render(ctx, select))
  const out = rows.map(shape.read)
  await fillLists(ctx, shape.lists)
  shape.fixups.forEach((f) => f())
  return out
}

/** 一次 IN 查询带的键个数上限 */
const IN_CHUNK = 500

async function fillLists(ctx: Context, lists: readonly PendingList[]): Promise<void> {
  for (const pending of lists) {
    if (pending.slots.size === 0) continue
    const many = pending.list.many
    // 与父查询共用别名计数：filters 里误用父查询的导航时别名对不上，checkAliases 能报出来
    const scope = many.scope.child()
    const root = scope.root(many.relation.target)
    const { where, orderBy } = many.rebuild(root)
    where.push(...scope.filters(root))
    const shape = new ShapeCompiler(ctx)
    shape.compile(pending.list.shape ? pending.list.shape(root) : root)
    const toNode = columnNode(scope, root[REF], many.relation.to)
    const keyAs = shape.hidden(toNode)
    const target = ctx.schema.entities[many.relation.target]!
    const slots = [...pending.slots.values()]
    for (let i = 0; i < slots.length; i += IN_CHUNK) {
      const keys: Node[] = slots.slice(i, i + IN_CHUNK).map((s) => ({ k: 'param', value: s.key, codec: undefined }))
      const select: SelectNode = {
        from: { table: target.table, alias: root[REF].alias },
        joins: scope.joins, where: [{ k: 'in', e: toNode, list: keys, not: false }, ...where],
        groupBy: [], having: [], orderBy, columns: shape.columns, distinct: false, limit: undefined, offset: undefined, forUpdate: false,
      }
      for (const row of await query(ctx, render(ctx, many.take === undefined ? select : perParent(select, toNode, many.take)))) {
        const item = shape.read(row)
        for (const array of pending.slots.get(String(row[keyAs]))?.arrays ?? []) array.push(item)
      }
    }
    await fillLists(ctx, shape.lists)
    shape.fixups.forEach((f) => f())
  }
}

/**
 * 每个父行只取前 take 条：内层按关联列分区编号，外层只留编号 <= take 的行。
 * SELECT eq_w.c0, … FROM (SELECT …, ROW_NUMBER() OVER (PARTITION BY 关联列 ORDER BY …) AS eq_rn FROM … WHERE …) eq_w WHERE eq_w.eq_rn <= take
 */
function perParent(select: SelectNode, key: Node, take: number): SelectNode {
  const rn: Node = { k: 'over', fn: { k: 'lit', sql: 'ROW_NUMBER()' }, partition: [key], order: select.orderBy, frame: undefined }
  const inner: SelectNode = { ...select, orderBy: [], columns: [...select.columns, { e: rn, as: 'eq_rn' }] }
  const col = (name: string): Node => ({ k: 'col', alias: 'eq_w', name })
  return {
    from: { table: '', alias: 'eq_w', sub: inner },
    joins: [], where: [{ k: 'op', op: '<=', l: col('eq_rn'), r: { k: 'lit', sql: String(take) } }],
    groupBy: [], having: [], orderBy: [{ e: col('eq_rn'), desc: false }],
    columns: select.columns.map((c) => ({ e: col(c.as), as: c.as })), distinct: false, limit: undefined, offset: undefined, forUpdate: false,
  }
}
