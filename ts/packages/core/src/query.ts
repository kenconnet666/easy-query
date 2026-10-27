/**
 * 查询构建器。方法只记下 lambda，执行（toList、count …）时才在新的构建现场里求值、生成语法树，
 * 所以构建器不可变、可以复用：`const base = db.queryable(User).where(...)`，再分别 `base.count()`、`base.limit(10).toList()`。
 */
import { checkAliases, type Node, type OrderNode, type SelectNode } from './ast.ts'
import { SqlWriter, type Statement } from './dialect.ts'
import { aggregate, aggregateCodec, codecs, condNode, Expr, orderNodes, type Cond, type OrderItem } from './expr.ts'
import { columnNode, ListOf, REF, Scope, type AnyRef, type Ref, type Selected } from './ref.ts'
import type { AnySchema, EntityKey } from './relations.ts'
import type { Codec, Row } from './schema.ts'
import { refEntity } from './interceptor.ts'
import { query, type Context } from './session.ts'

type Fn<A, R> = (a: A) => R
type Orders = OrderItem | readonly OrderItem[]

interface State {
  readonly key: string
  readonly where: readonly Fn<any, Cond>[]
  readonly orderBy: readonly Fn<any, Orders>[]
  readonly select: Fn<any, unknown> | undefined
  readonly group: Fn<any, Record<string, Expr<unknown>>> | undefined
  readonly having: readonly Fn<any, Cond>[]
  readonly groupOrderBy: readonly Fn<any, Orders>[]
  readonly groupSelect: Fn<any, unknown> | undefined
  readonly limit: number | undefined
  readonly offset: number | undefined
  readonly distinct: boolean
  readonly forUpdate: boolean
  /** noInterceptor 关掉的拦截器 */
  readonly disabled: readonly string[]
}

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
export class Queryable<S extends AnySchema, K extends EntityKey<S>, Out = Row<S['entities'][K]>> extends Executable<Out> {
  protected with(patch: Partial<State>): this {
    return new Queryable(this.ctx, { ...this.state, ...patch }) as this
  }

  where(filter: (r: Ref<S, K>) => Cond): Queryable<S, K, Out> {
    return this.with({ where: [...this.state.where, filter] })
  }

  orderBy(order: (r: Ref<S, K>) => Orders): Queryable<S, K, Out> {
    return this.with({ orderBy: [...this.state.orderBy, order] })
  }

  /** 结果的形状：表达式、导航到的整行、toList 数组、嵌套对象都可以；结果类型据此推导 */
  select<X>(shape: (r: Ref<S, K>) => X): Queryable<S, K, Selected<X>> {
    return new Queryable(this.ctx, { ...this.state, select: shape })
  }

  /** 整行之外再带上导航：一对多是数组，多对一是对象（可空导航为 null） */
  include<X extends Record<string, ListOf<unknown> | AnyRef>>(navigations: (r: Ref<S, K>) => X): Queryable<S, K, Out & Selected<X>> {
    const previous = this.state.select
    return new Queryable(this.ctx, {
      ...this.state,
      select: (r: AnyRef) => ({ ...spreadShape(previous ? previous(r) : r), ...navigations(r as never) }),
    })
  }

  /** 行锁（SELECT … FOR UPDATE），在事务里用 */
  forUpdate(): Queryable<S, K, Out> {
    return this.with({ forUpdate: true })
  }

  /** 这条查询不用这些拦截器（按 name，如 'tenant'） */
  noInterceptor(...names: string[]): Queryable<S, K, Out> {
    return this.with({ disabled: [...this.state.disabled, ...names] })
  }

  /** 分组；不调 select 时结果就是分组键 */
  groupBy<G extends Record<string, Expr<any>>>(keys: (r: Ref<S, K>) => G): GroupedQueryable<S, K, G, Selected<G>> {
    return new GroupedQueryable(this.ctx, { ...this.state, group: keys as never })
  }
}

/** 分组里的聚合；`g.sum(p => p.amount)`、`g.count(p => p.amount.gt('1000'))` */
export interface Group<S extends AnySchema, K extends EntityKey<S>, G> {
  readonly key: G
  /** 不带条件是 COUNT(*)；带条件只数满足的行 */
  count(filter?: (r: Ref<S, K>) => Cond): Expr<number>
  countDistinct(value: (r: Ref<S, K>) => Expr<unknown>): Expr<number>
  sum<V extends number | bigint | string | null>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null>
  avg<V extends number | bigint | string | null>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null>
  max<V>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null>
  min<V>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null>
}

export class GroupedQueryable<S extends AnySchema, K extends EntityKey<S>, G, Out> extends Executable<Out> {
  protected with(patch: Partial<State>): this {
    return new GroupedQueryable(this.ctx, { ...this.state, ...patch }) as this
  }

  having(filter: (g: Group<S, K, G>) => Cond): GroupedQueryable<S, K, G, Out> {
    return this.with({ having: [...this.state.having, filter] })
  }

  orderBy(order: (g: Group<S, K, G>) => Orders): GroupedQueryable<S, K, G, Out> {
    return this.with({ groupOrderBy: [...this.state.groupOrderBy, order] })
  }

  select<X>(shape: (g: Group<S, K, G>) => X): GroupedQueryable<S, K, G, Selected<X>> {
    return new GroupedQueryable(this.ctx, { ...this.state, groupSelect: shape })
  }
}

export function newQueryable<S extends AnySchema, K extends EntityKey<S>>(ctx: Context, key: K): Queryable<S, K> {
  return new Queryable(ctx, {
    key, where: [], orderBy: [], select: undefined, group: undefined, having: [], groupOrderBy: [], groupSelect: undefined,
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
  const where = [...conds(state.where.map((f) => f(root))), ...scope.filters(root)]
  const shape = new ShapeCompiler(ctx)
  let groupBy: Node[] = []
  let having: Node[] = []
  let orderBy: OrderNode[] = state.orderBy.flatMap((o) => orderNodes(o(root)))

  if (state.group) {
    const keys = state.group(root)
    groupBy = Object.values(keys).map((e) => e.node)
    const g = groupHandle(root, keys)
    having = conds(state.having.map((f) => f(g)))
    orderBy = [...orderBy, ...state.groupOrderBy.flatMap((o) => orderNodes(o(g)))]
    if (!bare) shape.compile(state.groupSelect ? state.groupSelect(g) : keys)
  } else if (!bare) {
    shape.compile(state.select ? state.select(root) : root)
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

function groupHandle(root: AnyRef, key: unknown): Group<any, any, unknown> {
  const agg = (fn: 'sum' | 'avg' | 'max' | 'min') => (value: (r: any) => Expr<unknown>) => {
    const e = value(root)
    return aggregate<any>(fn, e, aggregateCodec(fn, e))
  }
  return {
    key,
    count: (filter) => {
      const n = filter ? condNode(filter(root as never)) : undefined
      if (!n) return aggregate<number>('count', undefined, codecs.int)
      return new Expr<number>({ k: 'agg', fn: 'count', arg: { k: 'case', when: [[n, { k: 'lit', sql: '1' }]], else: undefined }, distinct: false }, codecs.int)
    },
    countDistinct: (value) => aggregate<number>('count', value(root as never), codecs.int, true),
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
