/**
 * 实体之间的关系（导航）。与实体分开定义：A 引用 B、B 又引用 A 时，写在实体的初始化里会让 TS 循环推导报错。
 *
 * ```ts
 * export const schema = defineSchema({ Company, User, Post, Role, UserRole }, {
 *   User: r => ({
 *     company: r.one('Company', { from: 'companyId', to: 'id' }),   // companyId 可空 → u.company.* 可空
 *     posts: r.many('Post', { from: 'id', to: 'userId' }),
 *     roles: r.manyToMany('Role', { through: 'UserRole', throughFrom: 'userId', throughTo: 'roleId' }),   // 经中间表
 *   }),
 *   Post: r => ({ user: r.one('User', { from: 'userId', to: 'id' }) }),
 * })
 * ```
 * 复合外键把 from / to 写成列的数组：`{ from: ['tenantId', 'userId'], to: ['tenantId', 'id'] }`，两边个数必须相同。
 */
import type { Column, Entity } from './schema.ts'

/** 多对一 / 一对一：from 是本表的列，to 是目标表的列（按位置一一对应）。N 为 true 时目标可能不存在，导航出来的列都可空 */
export interface One<T extends string = string, N extends boolean = boolean> {
  readonly kind: 'one'
  readonly target: T
  readonly from: readonly string[]
  readonly to: readonly string[]
  readonly nullable: N
}

/** 多对多经过的中间表：from 列引用本表，to 列引用目标表（都是中间表上的列） */
export interface Through {
  /** 中间表实体在 schema 里的键 */
  readonly entity: string
  readonly from: readonly string[]
  readonly to: readonly string[]
}

/**
 * 一对多：目标表里 to 列等于本表 from 列的行；多对多时 from / to 是本表与目标表上的列（默认各自的主键），
 * 再经 through 的中间表把两边连起来。
 */
export interface Many<T extends string = string> {
  readonly kind: 'many'
  readonly target: T
  readonly from: readonly string[]
  readonly to: readonly string[]
  readonly through?: Through
}

export type Relation = One | Many

type ColumnKey<E extends Entity> = keyof E['columns'] & string
/** 一个列名，或复合外键的列名数组 */
type OneOrMany<K extends string> = K | readonly K[]
/** 任何一个 from 列可空，导航的目标就可能不存在 */
type AnyNullable<E extends Entity, F extends string> = true extends { [K in F]: E['columns'][K] extends Column<any, infer N, any> ? N : never }[F] ? true : false

/** 给某个实体定义关系时拿到的帮助对象：from 只能是本实体的列，to 只能是目标实体的列 */
export interface RelationBuilder<E extends Record<string, Entity>, S extends keyof E> {
  /**
   * 多对一 / 一对一。from 列可空时目标可空；from 列非空但目标仍可能不存在（例如从主键指向对方的外键）时传 `{ optional: true }`。
   * 复合外键：from / to 写成数组。
   */
  one<T extends keyof E & string, F extends ColumnKey<E[S]>, O extends boolean = false>(
    target: T,
    on: { from: OneOrMany<F>; to: OneOrMany<ColumnKey<E[T]>> },
    options?: { optional?: O },
  ): One<T, O extends true ? true : AnyNullable<E[S], F>>
  many<T extends keyof E & string>(target: T, on: { from: OneOrMany<ColumnKey<E[S]>>; to: OneOrMany<ColumnKey<E[T]>> }): Many<T>
  /**
   * 多对多：经中间表 through 连接两边。throughFrom 是中间表上引用本表的列，throughTo 是引用目标表的列；
   * from / to 是本表与目标表上被引用的列，省略时用各自的主键。中间表的实体也要在 schema 里。
   */
  manyToMany<T extends keyof E & string, M extends keyof E & string>(
    target: T,
    on: {
      through: M
      throughFrom: OneOrMany<ColumnKey<E[M]>>
      throughTo: OneOrMany<ColumnKey<E[M]>>
      from?: OneOrMany<ColumnKey<E[S]>>
      to?: OneOrMany<ColumnKey<E[T]>>
    },
  ): Many<T>
}

/** 实体与关系的整体；查询从这里取导航 */
export interface Schema<E extends Record<string, Entity> = Record<string, Entity>, R = Record<string, Record<string, Relation>>> {
  readonly entities: E
  readonly relations: R
}

export type AnySchema = Schema<Record<string, Entity>, Record<string, Record<string, Relation>>>
export type EntityKey<S extends AnySchema> = keyof S['entities'] & string

/** 没定义关系的实体补成 {} */
type ResolvedRelations<E extends Record<string, Entity>, R> = { [K in keyof E]: K extends keyof R ? R[K] : {} }

/**
 * 汇总实体与关系。relations 的每个函数拿到本实体专用的 RelationBuilder；关系类型从返回值反推（反向映射类型推导），不用手写。
 */
export function defineSchema<const E extends Record<string, Entity>, R extends { [S in keyof E]?: Record<string, Relation> } = {}>(
  entities: E,
  relations?: { [S in keyof R]: (r: RelationBuilder<E, S & keyof E>) => R[S] },
): Schema<E, ResolvedRelations<E, R>> {
  const resolved: Record<string, Record<string, Relation>> = {}
  for (const key of Object.keys(entities)) {
    const define = (relations as Record<string, ((r: RelationBuilder<E, string>) => Record<string, Relation>) | undefined> | undefined)?.[key]
    const defined = define ? define(builderFor(entities, key)) : {}
    for (const [name, rel] of Object.entries(defined)) check(entities, key, name, rel)
    resolved[key] = defined
  }
  return { entities, relations: resolved as ResolvedRelations<E, R> }
}

/** 定义时就把写错的列名、个数对不上的复合外键报出来，而不是等到第一次查询 */
function check(entities: Record<string, Entity>, key: string, name: string, rel: Relation): void {
  const where = `relation ${key}.${name}`
  const source = entities[key]!
  const target = entities[rel.target]
  if (!target) throw new Error(`${where}: unknown entity '${rel.target}'`)
  if (name in source.columns) throw new Error(`${where} has the same name as a column`)
  const columns = (entity: Entity, entityKey: string, names: readonly string[], what: string) => {
    if (names.length === 0) throw new Error(`${where}: ${what} must name at least one column`)
    for (const c of names) if (!(c in entity.columns)) throw new Error(`${where}: ${entityKey} has no column '${c}'`)
  }
  columns(source, key, rel.from, 'from')
  columns(target, rel.target, rel.to, 'to')
  if (rel.from.length !== rel.to.length) throw new Error(`${where}: from (${rel.from.length} columns) and to (${rel.to.length} columns) must match`)
  if (rel.kind === 'many' && rel.through) {
    const through = entities[rel.through.entity]
    if (!through) throw new Error(`${where}: unknown through entity '${rel.through.entity}'`)
    columns(through, rel.through.entity, rel.through.from, 'throughFrom')
    columns(through, rel.through.entity, rel.through.to, 'throughTo')
    if (rel.through.from.length !== rel.from.length) throw new Error(`${where}: throughFrom must have as many columns as from`)
    if (rel.through.to.length !== rel.to.length) throw new Error(`${where}: throughTo must have as many columns as to`)
  }
}

const list = (v: string | readonly string[]): readonly string[] => (typeof v === 'string' ? [v] : v)

function builderFor<E extends Record<string, Entity>>(entities: E, source: string): RelationBuilder<E, string> {
  const primaryKey = (entity: Entity, what: string): readonly string[] => {
    if (entity.primaryKey.length === 0) throw new Error(`manyToMany on ${what} needs from / to or a primary key on ${entity.table}`)
    return entity.primaryKey
  }
  return {
    one(target, on, options) {
      const from = list(on.from)
      const nullable = options?.optional === true || from.some((c) => entities[source]!.columns[c]?.options.nullable)
      return { kind: 'one', target, from, to: list(on.to), nullable } as never
    },
    many(target, on) {
      return { kind: 'many', target, from: list(on.from), to: list(on.to) }
    },
    manyToMany(target, on) {
      const targetEntity = entities[target]
      return {
        kind: 'many',
        target,
        from: on.from ? list(on.from) : primaryKey(entities[source]!, source),
        to: on.to ? list(on.to) : targetEntity ? primaryKey(targetEntity, target) : [],
        through: { entity: on.through, from: list(on.throughFrom), to: list(on.throughTo) },
      }
    },
  }
}
