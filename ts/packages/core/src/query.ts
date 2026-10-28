/**
 * 查询构建器。方法只记下 lambda，执行（toList、count …）时才在新的构建现场里求值、生成语法树，
 * 所以构建器不可变、可以复用：`const base = db.queryable(User).where(...)`，再分别 `base.count()`、`base.limit(10).toList()`。
 */
import { checkAliases, type CteNode, type Node, type OrderNode, type SelectNode } from './ast.ts'
import { SqlWriter, type Statement } from './dialect.ts'
import { aggregate, aggregateCodec, codecs, condNode, Expr, orderNodes, SUBQUERY, type Cond, type Numeric, type OrderItem, type Subquery } from './expr.ts'
import { columnNode, linkColumns, ListOf, makeRef, REF, Scope, type AnyRef, type Ref, type Selected } from './ref.ts'
import type { AnySchema, EntityKey, Schema } from './relations.ts'
import type { KeyOf } from './db.ts'
import { Column, type Codec, type DerivedEntity, type Entity, type Row } from './schema.ts'
import { refEntity } from './interceptor.ts'
import { query, streamRows, type Context } from './session.ts'

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
  readonly lockWait: 'nowait' | 'skip' | undefined
  readonly groupMode: 'rollup' | 'cube' | undefined
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

/** rollup / cube 之后分组键可空 */
export type NullableKeys<G> = { [P in keyof G]: G[P] extends Expr<infer T> ? Expr<T | null> : G[P] }

export interface Page<T> {
  readonly rows: T[]
  readonly total: number
  readonly page: number
  readonly size: number
}

/** 所有查询（普通的、分组的）共用的类型：Db.with、union 等接受它 */
export type Query<Out> = Executable<Out>

/** 终结方法：各种查询共用 */
abstract class Executable<Out> implements Subquery<Out> {
  /** 类型标记：每行产生的值的类型（Subquery 用它推导 in(...) 能接受什么） */
  declare readonly __row: Out
  protected readonly ctx: Context
  protected readonly state: State

  constructor(ctx: Context, state: State) {
    this.ctx = ctx
    this.state = state
  }

  protected abstract with(patch: Partial<State>): this

  /** 作为子查询的语法树：in(...) 要求只选一列 */
  [SUBQUERY](): SelectNode {
    const { select } = build(this.ctx, this.state)
    if (select.columns.length !== 1) {
      throw new Error(`a subquery used as a value or in in(...) must select exactly one column, got ${select.columns.length}`)
    }
    return select
  }

  /**
   * 把这条查询的结果当作一张派生表继续查询（`FROM (子查询) 别名`）：对窗口函数的结果再过滤（对应 QUALIFY）、
   * 对分组结果再分页、先 limit 再排序，都靠它。select 必须只由表达式组成（或不写 select，即整行）。
   * 派生表只有它自己的列，不能再 join 别的实体。
   * ```ts
   * db.queryable(Post).select(p => ({ id: p.id, rn: win.rowNumber(w => w.partitionBy(p.userId).orderBy(p.id.desc())) }))
   *   .asTable().where(t => t.rn.le(1)).toList()
   * ```
   */
  asTable(): Queryable<DerivedSchema<'derived', Out>, 'derived'> {
    const built = build(this.ctx, this.state)
    assertDerivable(built.shape, 'asTable()')
    return queryOver(this.ctx, makeDerived('derived', 'subquery', built.select, built.shape.named, false)) as never
  }

  /** UNION（去重）。两边选出的列名必须一致（顺序可以不同）；结果是一张派生表，可以继续 where / orderBy / limit / toPage */
  union(other: Executable<Out>): Queryable<DerivedSchema<'derived', Out>, 'derived'> {
    return this.compound(false, other)
  }

  /** UNION ALL（不去重） */
  unionAll(other: Executable<Out>): Queryable<DerivedSchema<'derived', Out>, 'derived'> {
    return this.compound(true, other)
  }

  private compound(all: boolean, other: Executable<Out>): never {
    const a = build(this.ctx, this.state)
    const b = other.buildTree()
    assertDerivable(a.shape, 'union()')
    const keys = [...a.shape.named.keys()]
    const first = alignMember(a, keys, 'union() first query')
    const second = alignMember(b, keys, 'union() second query')
    const q: SelectNode = {
      ...first,
      ctes: mergeCtes(a.select.ctes, b.select.ctes),
      unions: [...(a.select.unions ?? []), { all, q: { ...second, ctes: undefined } }],
    }
    return queryOver(this.ctx, makeDerived('derived', 'subquery', q, a.shape.named, false)) as never
  }

  /** 内部：构建语法树与形状（Db.with / withRecursive、union 用） */
  buildTree(): Built {
    return build(this.ctx, this.state)
  }

  limit(n: number): this { return this.with({ limit: n }) }
  offset(n: number): this { return this.with({ offset: n }) }
  distinct(): this { return this.with({ distinct: true }) }

  /**
   * 流式读取：`for await (const row of query.stream())`，不把整个结果集读进内存。
   * MySQL（mysql2 流）、PG（游标）、SQLite（iterate）是真正的流式；驱动不支持的库退化成一次读完再产出。
   * 不能和 toList() 导航（对象树）一起用——对象树需要先拿到所有父行。想要边读边处理时，注意中途 break 会释放连接。
   */
  async *stream(options: { batchSize?: number } = {}): AsyncGenerator<Out> {
    const built = build(this.ctx, this.state)
    if (built.shape.lists.length > 0) throw new Error('stream() cannot be combined with toList() navigations; use toList() to build object trees')
    for await (const batch of streamRows(this.ctx, render(this.ctx, built.select), options.batchSize ?? 500)) {
      for (const row of batch) yield built.shape.read(row) as Out
    }
  }

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

  /** 拿不到锁立即报错，不在锁上排队（FOR UPDATE NOWAIT）；在事务里用。SQLite 没有行锁，是空操作 */
  forUpdateNoWait(): Queryable<S, K, Out, Refs> {
    return this.with({ forUpdate: true, lockWait: 'nowait' })
  }

  /** 跳过被别人锁住的行（FOR UPDATE SKIP LOCKED）：多个消费者抢任务，各拿各的。在事务里用 */
  forUpdateSkipLocked(): Queryable<S, K, Out, Refs> {
    return this.with({ forUpdate: true, lockWait: 'skip' })
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
  /** rollup / cube 里这一行是不是这个键的小计行：是为 1，否则 0（区分"小计行的 NULL"和"数据本身的 NULL"） */
  grouping(value: (...refs: Refs) => Expr<unknown>): Expr<number>
  sum<V extends Numeric | null>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>
  avg<V extends Numeric | null>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>
  max<V>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>
  min<V>(value: (...refs: Refs) => Expr<V>): Expr<NonNullable<V> | null>
}

export class GroupedQueryable<S extends AnySchema, K extends EntityKey<S>, G, Out, Refs extends readonly unknown[] = [Ref<S, K>]> extends Executable<Out> {
  protected with(patch: Partial<State>): this {
    return new GroupedQueryable(this.ctx, { ...this.state, ...patch }) as this
  }

  /**
   * 逐级小计加总计：按 (a, b) 分组时，除了每个 (a, b) 一行，还有每个 a 的小计行（b 为 NULL）和总计行（a、b 都为 NULL）。
   * 键在结果里变成可空；用 `g.grouping(...)` 区分"真的是 NULL"还是"小计行"。MySQL 为 WITH ROLLUP，SQLite 不支持。
   */
  rollup(): GroupedQueryable<S, K, NullableKeys<G>, Selected<NullableKeys<G>>, Refs> {
    return new GroupedQueryable(this.ctx, { ...this.state, groupMode: 'rollup' })
  }

  /** 所有键组合的小计（2 的 n 次方种）。MySQL、SQLite 不支持 */
  cube(): GroupedQueryable<S, K, NullableKeys<G>, Selected<NullableKeys<G>>, Refs> {
    return new GroupedQueryable(this.ctx, { ...this.state, groupMode: 'cube' })
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

/** 一条查询的结果对应的单实体 schema：外层查询靠它拿到类型化的列 */
export type DerivedSchema<Name extends string, Out> = Schema<{ [P in Name]: DerivedEntity<Name, Out> }, { [P in Name]: {} }>

/** 子查询里没有列编码的表达式（原生片段等）：原样读 */
const rawCodec: Codec<any> = { kind: 'raw', decode: (v) => v, encode: (v) => v }

/** 把一条查询的输出列变成一个派生实体：列名取 select 的键，列在 SQL 里的名字是子查询的输出别名 */
function makeDerived(name: string, kind: 'subquery' | 'cte', q: SelectNode, named: ReadonlyMap<string, { readonly alias: string; readonly codec: Codec<any> | undefined }>, recursive: boolean): Entity {
  const columns: Record<string, Column<any, boolean, boolean>> = {}
  const columnNames: Record<string, string> = {}
  for (const [key, { alias, codec }] of named) {
    columns[key] = new Column(codec ?? rawCodec, { nullable: false, primaryKey: false, generated: false, hasDefault: false })
    columnNames[key] = alias
  }
  return {
    kind: 'entity', name, table: kind === 'cte' ? name : '', columns, columnNames, primaryKey: [],
    derived: { kind, q, recursive, columns: [...named.values()].map((v) => v.alias) },
  }
}

/** 在一个只含派生实体的 schema 上开始查询 */
function queryOver(ctx: Context, entity: Entity): Queryable<AnySchema, string> {
  const schema: AnySchema = { entities: { [entity.name]: entity }, relations: { [entity.name]: {} } }
  return newQueryable({ ...ctx, schema }, entity.name)
}

function assertDerivable(shape: ShapeCompiler, what: string): void {
  if (!shape.flat || shape.named.size === 0) {
    throw new Error(`${what} needs a select made of plain expressions (or no select, i.e. whole rows); toList(), nested objects and joined rows cannot become a table`)
  }
}

/**
 * 复合查询 / 递归 CTE 的一个成员：按第一个成员的列名对齐（顺序可以不同），输出别名统一成 c0、c1 …。
 * 成员不能带 orderBy / limit / offset（要的话先 asTable()），否则 SQL 的语义含糊且 SQLite 不允许成员加括号。
 */
function alignMember(built: Built, keys: readonly string[], what: string): SelectNode {
  assertDerivable(built.shape, what)
  const named = built.shape.named
  if (named.size !== keys.length || keys.some((k) => !named.has(k))) {
    throw new Error(`${what} must select the same columns as the first query: ${keys.join(', ')}`)
  }
  const q = built.select
  if (q.orderBy.length > 0 || q.limit !== undefined || q.offset !== undefined) {
    throw new Error(`${what} cannot use orderBy / limit / offset; wrap it with asTable() first`)
  }
  return { ...q, columns: keys.map((k, i) => ({ e: q.columns.find((c) => c.as === named.get(k)!.alias)!.e, as: `c${i}` })) }
}

/** 合并两组 CTE，名字相同的只留第一个 */
function mergeCtes(a: readonly CteNode[] | undefined, b: readonly CteNode[] | undefined): CteNode[] | undefined {
  const all = [...(a ?? []), ...(b ?? [])]
  const unique = all.filter((c, i) => all.findIndex((x) => x.name === c.name) === i)
  return unique.length > 0 ? unique : undefined
}

/** 非递归 CTE：`WITH name AS (query)`，之后的查询把 name 当作一个实体 */
export function cteEntity(query: Query<any>, name: string): Entity {
  const built = query.buildTree()
  assertDerivable(built.shape, `with('${name}')`)
  return makeDerived(name, 'cte', built.select, built.shape.named, false)
}

/**
 * 递归 CTE：`WITH RECURSIVE name AS (anchor UNION [ALL] step)`。step 通过回调拿到 name 对应的实体，
 * 用它构建递归的那一部分；两部分按列名对齐。
 */
export function recursiveCteEntity(anchor: Query<any>, name: string, all: boolean, step: (self: Entity) => Query<any>): Entity {
  const a = anchor.buildTree()
  assertDerivable(a.shape, `withRecursive('${name}') anchor`)
  const keys = [...a.shape.named.keys()]
  // 先用锚点占位，递归部分要引用这个实体；构建完再换成完整的 anchor UNION step
  const entity = makeDerived(name, 'cte', a.select, a.shape.named, true)
  const b = step(entity).buildTree()
  const member = alignMember(b, keys, `withRecursive('${name}') recursive part`)
  entity.derived!.q = {
    ...alignMember(a, keys, `withRecursive('${name}') anchor`),
    // 递归部分构建时登记的"自己"只是占位，不能当成依赖带出去
    ctes: mergeCtes(a.select.ctes, b.select.ctes?.filter((c) => c.name !== name)),
    unions: [{ all, q: { ...member, ctes: undefined } }],
  }
  return entity
}

export function newQueryable<S extends AnySchema, K extends EntityKey<S>>(ctx: Context, key: K): Queryable<S, K> {
  return new Queryable(ctx, {
    key, joins: [], where: [], orderBy: [], select: undefined, group: undefined, having: [], groupOrderBy: [], groupSelect: undefined,
    limit: undefined, offset: undefined, distinct: false, forUpdate: false, lockWait: undefined, groupMode: undefined, disabled: [],
  })
}

function spreadShape(shape: unknown): Record<string, unknown> {
  if (shape && typeof shape === 'object' && REF in shape) return refColumns(shape as AnyRef)
  return shape as Record<string, unknown>
}

function refColumns(ref: AnyRef): Record<string, unknown> {
  return Object.fromEntries(Object.keys(ref).map((k) => [k, (ref as unknown as Record<string, unknown>)[k]]))
}

/** 构建结果：语法树 + 读取结果行的形状。导出给 Db.with / withRecursive 内部使用 */
export interface Built {
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
    from: scope.tableRef(entity, root[REF].alias),
    joins: scope.joins, where, groupBy, having, orderBy,
    columns: shape.columns, distinct: state.distinct, limit: state.limit, offset: state.offset, forUpdate: state.forUpdate,
    lockWait: state.lockWait, groupMode: state.group ? state.groupMode : undefined,
    ctes: scope.ctes.size > 0 ? [...scope.ctes.values()] : undefined,
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
    const index = scope.joins.push({ ...scope.tableRef(target, alias), kind: spec.kind, on: { k: 'lit', sql: '1 = 1' } }) - 1
    refs.push(ref)
    const on = condNode(spec.on(...refs))
    if (!on) throw new Error(`${spec.kind}Join(${target.table}) needs an ON condition`)
    const extra = scope.filters(ref)
    scope.joins[index] = { ...scope.tableRef(target, alias), kind: spec.kind, on: extra.length === 0 ? on : { k: 'and', items: [on, ...extra] } }
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
    grouping: (value) => new Expr<number>({ k: 'fn', name: 'grouping', args: [value(...(refs as never[])).node] }, codecs.int),
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
  /** 父行的关联键（复合外键是多列，id 是各列拼成的文字）→ 这些父行上的数组 */
  readonly slots: Map<string, { readonly keys: readonly unknown[]; readonly arrays: unknown[][] }>
}

/** 把 select 形状拆成扁平的列，同时生成按行重组对象的读取函数 */
class ShapeCompiler {
  readonly columns: { e: Node; as: string }[] = []
  readonly lists: PendingList[] = []
  /** first() 的数组在第二条查询填完后换成第一项或 null */
  readonly fixups: (() => void)[] = []
  read: Reader = () => undefined
  /** 顶层 select 形状里"列名 → 输出别名与解码"，派生表（子查询 / CTE / union）靠它给外层查询提供列 */
  readonly named = new Map<string, { readonly alias: string; readonly codec: Codec<any> | undefined }>()
  /** 顶层形状是不是只由表达式（或一整行）组成；含 toList、嵌套对象的形状没法当成一张表 */
  flat = true
  private root: unknown
  private readonly ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  compile(shape: unknown): void {
    if (shape instanceof ListOf && shape.single) throw new TypeError('first() must be a property of a select object')
    this.root = shape
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
    const isRoot = x === this.root
    const entries = Object.entries(x).map(([k, v]) => {
      const read = this.reader(v)
      if (isRoot) {
        if (v instanceof Expr) this.named.set(k, { alias: this.columns.at(-1)!.as, codec: v.codec })
        else this.flat = false
      }
      return [k, read, v instanceof ListOf && v.single] as const
    })
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
    const isRoot = ref === this.root
    const readers = props.map((p) => {
      const e = (ref as unknown as Record<string, Expr<unknown>>)[p]!
      const read = this.expr(e)
      if (isRoot) this.named.set(p, { alias: this.columns.at(-1)!.as, codec: e.codec })
      return [p, read] as const
    })
    const probe = entity.primaryKey.length > 0 ? entity.primaryKey : props
    return (row) => {
      const obj = Object.fromEntries(readers.map(([p, read]) => [p, read(row)]))
      if (info.nullable && probe.every((p) => obj[p] === null)) return null
      return obj
    }
  }

  private list(list: ListOf<unknown, boolean>): Reader {
    // 父行上关联键的每一列都要带出来（复合外键有多列）
    const keyAs = list.many.relation.from.map((c) => this.hidden(columnNode(list.many.scope, list.many.parent[REF], c)))
    const pending: PendingList = { list, slots: new Map() }
    this.lists.push(pending)
    return (row) => {
      const array: unknown[] = []
      const keys = keyAs.map((as) => row[as])
      // 关联键里有 NULL 的父行不会有孩子
      if (keys.every((key) => key !== null && key !== undefined)) {
        const id = slotId(keys)
        let slot = pending.slots.get(id)
        if (!slot) pending.slots.set(id, (slot = { keys, arrays: [] }))
        slot.arrays.push(array)
      }
      return array
    }
  }
}

/** 关联键 → Map 的键：各列转成文字再用不会出现在数据里的分隔符拼起来 */
function slotId(keys: readonly unknown[]): string {
  return keys.map(String).join('')
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
    // CTE 单独统计：第二条查询是独立的语句，只带它自己用到的 WITH
    const scope = many.scope.detached()
    const root = scope.root(many.relation.target)
    const { where, orderBy } = many.rebuild(root)
    where.push(...scope.filters(root))
    const shape = new ShapeCompiler(ctx)
    shape.compile(pending.list.shape ? pending.list.shape(root) : root)
    // 孩子一侧的关联列（多对多时已经把中间表 join 进 scope）
    const toNodes = linkColumns(scope, many.relation, root)
    const keyAs = toNodes.map((n) => shape.hidden(n))
    const target = ctx.schema.entities[many.relation.target]!
    const slots = [...pending.slots.values()]
    // 参数个数 = 键个数 × 列数，复合外键时每块少放一些
    const chunk = Math.max(1, Math.floor(IN_CHUNK / toNodes.length))
    for (let i = 0; i < slots.length; i += chunk) {
      const select: SelectNode = {
        from: scope.tableRef(target, root[REF].alias),
        ctes: scope.ctes.size > 0 ? [...scope.ctes.values()] : undefined,
        joins: scope.joins, where: [matchKeys(toNodes, slots.slice(i, i + chunk).map((s) => s.keys)), ...where],
        groupBy: [], having: [], orderBy, columns: shape.columns, distinct: false, limit: undefined, offset: undefined, forUpdate: false,
      }
      for (const row of await query(ctx, render(ctx, many.take === undefined ? select : perParent(select, toNodes, many.take)))) {
        const item = shape.read(row)
        for (const array of pending.slots.get(slotId(keyAs.map((as) => row[as])))?.arrays ?? []) array.push(item)
      }
    }
    await fillLists(ctx, shape.lists)
    shape.fixups.forEach((f) => f())
  }
}

/**
 * 孩子的关联列等于其中某组父键：单列用 IN；复合外键写成 (a = ? AND b = ?) OR …（行值 IN 各库支持不一，这样处处可用）。
 */
function matchKeys(columns: readonly Node[], keys: readonly (readonly unknown[])[]): Node {
  const param = (value: unknown): Node => ({ k: 'param', value, codec: undefined })
  if (columns.length === 1) return { k: 'in', e: columns[0]!, list: keys.map((key) => param(key[0])), not: false }
  const one = (key: readonly unknown[]): Node => ({ k: 'and', items: columns.map((l, i): Node => ({ k: 'op', op: '=', l, r: param(key[i]) })) })
  return { k: 'or', items: keys.map(one) }
}

/**
 * 每个父行只取前 take 条：内层按关联列分区编号，外层只留编号 <= take 的行。
 * SELECT eq_w.c0, … FROM (SELECT …, ROW_NUMBER() OVER (PARTITION BY 关联列 ORDER BY …) AS eq_rn FROM … WHERE …) eq_w WHERE eq_w.eq_rn <= take
 */
function perParent(select: SelectNode, keys: readonly Node[], take: number): SelectNode {
  const rn: Node = { k: 'over', fn: { k: 'lit', sql: 'ROW_NUMBER()' }, partition: keys, order: select.orderBy, frame: undefined }
  const inner: SelectNode = { ...select, orderBy: [], columns: [...select.columns, { e: rn, as: 'eq_rn' }] }
  const col = (name: string): Node => ({ k: 'col', alias: 'eq_w', name })
  return {
    from: { table: '', alias: 'eq_w', sub: inner },
    joins: [], where: [{ k: 'op', op: '<=', l: col('eq_rn'), r: { k: 'lit', sql: String(take) } }],
    groupBy: [], having: [], orderBy: [{ e: col('eq_rn'), desc: false }],
    columns: select.columns.map((c) => ({ e: col(c.as), as: c.as })), distinct: false, limit: undefined, offset: undefined, forUpdate: false,
  }
}
