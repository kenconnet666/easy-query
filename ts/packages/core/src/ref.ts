/**
 * lambda 里拿到的表引用：`u.name` 是列，`u.company` 是多对一导航（第一次访问时加一个 LEFT JOIN），
 * `u.posts` 是一对多导航（any / count / sum 渲染为关联子查询，toList 在结果里拼成数组）。
 */
import type { Join, Node, OrderNode, SelectNode } from './ast.ts'
import { aggregate, aggregateCodec, codecs, condNode, Expr, orderNodes, pred, type Cond, type OrderItem, type Pred } from './expr.ts'
import type { AnySchema, EntityKey, Many, One, Relation } from './relations.ts'
import type { Row, ValueOf } from './schema.ts'

export const REF: unique symbol = Symbol('eqts.ref')

type Ents<S extends AnySchema> = S['entities']
type Cols<S extends AnySchema, K extends EntityKey<S>> = Ents<S>[K]['columns']
type Rels<S extends AnySchema, K extends EntityKey<S>> = S['relations'][K]

/** 表引用的类型。N 为 true 表示经过了可空的导航，列都带上 null */
export type Ref<S extends AnySchema, K extends EntityKey<S>, N extends boolean = false> = {
  readonly [C in keyof Cols<S, K>]: Expr<N extends true ? ValueOf<Cols<S, K>[C]> | null : ValueOf<Cols<S, K>[C]>>
} & {
  readonly [R in keyof Rels<S, K>]: Rels<S, K>[R] extends One<infer T extends EntityKey<S>, infer TN>
    ? Ref<S, T, N extends true ? true : TN>
    : Rels<S, K>[R] extends Many<infer T extends EntityKey<S>>
      ? ManyRef<S, T>
      : never
} & { readonly [REF]: RefInfo<S, K, N> }

export interface RefInfo<S extends AnySchema = AnySchema, K extends EntityKey<S> = EntityKey<S>, N extends boolean = boolean> {
  readonly schema: S
  readonly key: K
  readonly alias: string
  readonly nullable: N
}

export type AnyRef = { readonly [REF]: RefInfo }

/** 一条 SELECT 的构建现场：别名计数（整条语句共用）与本层的 join */
export class Scope {
  readonly schema: AnySchema
  readonly joins: Join[] = []
  readonly allowJoins: boolean
  /** 拦截器给每个表引用附加的条件（主表、JOIN、子查询都用） */
  readonly filters: (ref: AnyRef) => Node[]
  private readonly counter: { n: number }

  constructor(schema: AnySchema, counter: { n: number } = { n: 0 }, allowJoins = true, filters: (ref: AnyRef) => Node[] = () => []) {
    this.schema = schema
    this.counter = counter
    this.allowJoins = allowJoins
    this.filters = filters
  }

  nextAlias(): string {
    return `t${this.counter.n++}`
  }

  /** 子查询用的现场：别名不与外层重复 */
  child(): Scope {
    return new Scope(this.schema, this.counter, true, this.filters)
  }

  /** 实体的根引用 */
  root(key: string): AnyRef {
    return makeRef(this, key, this.nextAlias(), false)
  }
}

export function makeRef(scope: Scope, key: string, alias: string, nullable: boolean): AnyRef {
  const entity = scope.schema.entities[key]
  if (!entity) throw new Error(`entity '${key}' is not part of the schema`)
  const ref: Record<string | symbol, unknown> = {}
  Object.defineProperty(ref, REF, { value: { schema: scope.schema, key, alias, nullable } satisfies RefInfo })
  for (const [prop, column] of Object.entries(entity.columns)) {
    Object.defineProperty(ref, prop, { enumerable: true, value: new Expr({ k: 'col', alias, name: entity.columnNames[prop]! }, column.codec) })
  }
  const relations: Record<string, Relation> = scope.schema.relations[key] ?? {}
  for (const [prop, rel] of Object.entries(relations)) {
    let cached: unknown
    Object.defineProperty(ref, prop, {
      get: () => (cached ??= rel.kind === 'one' ? joinOne(scope, ref as AnyRef, prop, rel, nullable) : new ManyRef(scope, ref as AnyRef, rel)),
    })
  }
  return ref as AnyRef
}

function joinOne(scope: Scope, parent: AnyRef, prop: string, rel: One, parentNullable: boolean): AnyRef {
  const info = parent[REF]
  if (!scope.allowJoins) {
    throw new Error(`navigation ${info.key}.${prop} needs a JOIN, which update/delete do not support; use a many-navigation any() or a subquery instead`)
  }
  const target = scope.schema.entities[rel.target]!
  const alias = scope.nextAlias()
  const ref = makeRef(scope, rel.target, alias, parentNullable || rel.nullable)
  const on: Node = { k: 'op', op: '=', l: { k: 'col', alias, name: target.columnNames[rel.to]! }, r: columnNode(scope, info, rel.from) }
  // 拦截器的条件放进 ON：LEFT JOIN 不会因此把主表的行过滤掉
  const extra = scope.filters(ref)
  scope.joins.push({ table: target.table, alias, on: extra.length === 0 ? on : { k: 'and', items: [on, ...extra] } })
  return ref
}

export function columnNode(scope: Scope, info: RefInfo, prop: string): Node {
  return { k: 'col', alias: info.alias, name: scope.schema.entities[info.key]!.columnNames[prop]! }
}

export function refColumn(ref: AnyRef, prop: string): Expr<unknown> {
  return (ref as unknown as Record<string, Expr<unknown>>)[prop]!
}

/**
 * 一对多导航。可以先 where / orderBy 再聚合；聚合与 any / none 是关联子查询，toList 只能用在 select 里（第二条查询按 IN 拉取后拼装）。
 */
export class ManyRef<S extends AnySchema, K extends EntityKey<S>> {
  declare readonly __target: K
  readonly scope: Scope
  readonly parent: AnyRef
  readonly relation: Many
  readonly filters: readonly ((r: any) => Cond)[]
  readonly orders: readonly ((r: any) => OrderItem | readonly OrderItem[])[]

  constructor(scope: Scope, parent: AnyRef, relation: Many, filters: readonly ((r: any) => Cond)[] = [], orders: readonly ((r: any) => OrderItem | readonly OrderItem[])[] = []) {
    this.scope = scope
    this.parent = parent
    this.relation = relation
    this.filters = filters
    this.orders = orders
  }

  where(filter: (r: Ref<S, K>) => Cond): ManyRef<S, K> {
    return new ManyRef(this.scope, this.parent, this.relation, [...this.filters, filter], this.orders)
  }

  /** 只影响 toList 的顺序 */
  orderBy(order: (r: Ref<S, K>) => OrderItem | readonly OrderItem[]): ManyRef<S, K> {
    return new ManyRef(this.scope, this.parent, this.relation, this.filters, [...this.orders, order])
  }

  /** 存在满足条件的行（EXISTS） */
  any(filter?: (r: Ref<S, K>) => Cond): Pred {
    return pred({ k: 'exists', q: this.subquery(filter, () => []), not: false })
  }

  /** 不存在满足条件的行（NOT EXISTS） */
  none(filter?: (r: Ref<S, K>) => Cond): Pred {
    return pred({ k: 'exists', q: this.subquery(filter, () => []), not: true })
  }

  count(filter?: (r: Ref<S, K>) => Cond): Expr<number> {
    return new Expr({ k: 'sub', q: this.subquery(filter, () => [{ e: { k: 'agg', fn: 'count', arg: undefined, distinct: false }, as: 'v' }]) }, codecs.int)
  }

  sum<V extends number | bigint | string | null>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> { return this.aggregate('sum', value) }
  avg<V extends number | bigint | string | null>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> { return this.aggregate('avg', value) }
  max<V>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> { return this.aggregate('max', value) }
  min<V>(value: (r: Ref<S, K>) => Expr<V>): Expr<NonNullable<V> | null> { return this.aggregate('min', value) }

  /** 关联的行拼成数组；不传 shape 时是整行 */
  toList(): ListOf<Row<S['entities'][K]>>
  toList<X>(shape: (r: Ref<S, K>) => X): ListOf<Selected<X>>
  toList(shape?: (r: any) => unknown): ListOf<unknown> {
    return new ListOf(this, shape)
  }

  private aggregate(fn: 'sum' | 'avg' | 'max' | 'min', value: (r: any) => Expr<unknown>): Expr<any> {
    let codec
    const q = this.subquery(undefined, (r) => {
      const e = value(r)
      codec = aggregateCodec(fn, e)
      return [{ e: aggregate(fn, e, undefined).node, as: 'v' }]
    })
    return new Expr({ k: 'sub', q }, codec)
  }

  private subquery(filter: ((r: any) => Cond) | undefined, columns: (r: AnyRef) => { e: Node; as: string }[]): SelectNode {
    const scope = this.scope.child()
    const target = scope.schema.entities[this.relation.target]!
    const root = scope.root(this.relation.target)
    const alias = root[REF].alias
    const where: Node[] = [{ k: 'op', op: '=', l: { k: 'col', alias, name: target.columnNames[this.relation.to]! }, r: columnNode(scope, this.parent[REF], this.relation.from) }]
    where.push(...scope.filters(root))
    for (const f of filter ? [...this.filters, filter] : this.filters) {
      const n = condNode(f(root))
      if (n) where.push(n)
    }
    const cols = columns(root)
    return { from: { table: target.table, alias }, joins: scope.joins, where, groupBy: [], having: [], orderBy: [], columns: cols, distinct: false, limit: undefined, offset: undefined, forUpdate: false }
  }

  /** toList 的子查询用：在新语句里重新求值 filters / orders */
  rebuild(root: AnyRef): { where: Node[]; orderBy: OrderNode[] } {
    const where: Node[] = []
    for (const f of this.filters) {
      const n = condNode(f(root))
      if (n) where.push(n)
    }
    return { where, orderBy: this.orders.flatMap((o) => orderNodes(o(root))) }
  }
}

/** select 里的一对多数组 */
export class ListOf<R> {
  declare readonly __row: R
  readonly many: ManyRef<any, any>
  readonly shape: ((r: any) => unknown) | undefined

  constructor(many: ManyRef<any, any>, shape: ((r: any) => unknown) | undefined) {
    this.many = many
    this.shape = shape
  }
}

/** select 形状对应的结果类型 */
export type Selected<X> = X extends Expr<infer T>
  ? T
  : X extends ListOf<infer R>
    ? R[]
    : X extends { readonly [REF]: RefInfo<infer S, infer K, infer N> }
      ? N extends true ? Row<S['entities'][K]> | null : Row<S['entities'][K]>
      : X extends readonly unknown[]
        ? never
        : X extends object
          ? { -readonly [P in keyof X]: Selected<X[P]> }
          : never
