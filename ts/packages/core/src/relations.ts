/**
 * 实体之间的关系（导航）。与实体分开定义：A 引用 B、B 又引用 A 时，写在实体的初始化里会让 TS 循环推导报错。
 *
 * ```ts
 * export const schema = defineSchema({ Company, User, Post }, {
 *   User: r => ({
 *     company: r.one('Company', { from: 'companyId', to: 'id' }),   // companyId 可空 → u.company.* 可空
 *     posts: r.many('Post', { from: 'id', to: 'userId' }),
 *   }),
 *   Post: r => ({ user: r.one('User', { from: 'userId', to: 'id' }) }),
 * })
 * ```
 */
import type { Column, Entity } from './schema.ts'

/** 多对一 / 一对一：from 是本表的列，to 是目标表的列。N 为 true 时目标可能不存在，导航出来的列都可空 */
export interface One<T extends string = string, N extends boolean = boolean> {
  readonly kind: 'one'
  readonly target: T
  readonly from: string
  readonly to: string
  readonly nullable: N
}

/** 一对多：目标表里 to 列等于本表 from 列的行 */
export interface Many<T extends string = string> {
  readonly kind: 'many'
  readonly target: T
  readonly from: string
  readonly to: string
}

export type Relation = One | Many

type ColumnKey<E extends Entity> = keyof E['columns'] & string
type IsNullable<C> = C extends Column<any, infer N, any> ? N : never

/** 给某个实体定义关系时拿到的帮助对象：from 只能是本实体的列，to 只能是目标实体的列 */
export interface RelationBuilder<E extends Record<string, Entity>, S extends keyof E> {
  /**
   * 多对一 / 一对一。from 列可空时目标可空；from 列非空但目标仍可能不存在（例如从主键指向对方的外键）时传 `{ optional: true }`
   */
  one<T extends keyof E & string, F extends ColumnKey<E[S]>, O extends boolean = false>(
    target: T,
    on: { from: F; to: ColumnKey<E[T]> },
    options?: { optional?: O },
  ): One<T, O extends true ? true : IsNullable<E[S]['columns'][F]>>
  many<T extends keyof E & string>(target: T, on: { from: ColumnKey<E[S]>; to: ColumnKey<E[T]> }): Many<T>
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
    for (const [name, rel] of Object.entries(defined)) {
      const source = entities[key]!
      if (!(rel.from in source.columns)) throw new Error(`relation ${key}.${name}: ${key} has no column '${rel.from}'`)
      const target = entities[rel.target]
      if (!target) throw new Error(`relation ${key}.${name}: unknown entity '${rel.target}'`)
      if (!(rel.to in target.columns)) throw new Error(`relation ${key}.${name}: ${rel.target} has no column '${rel.to}'`)
      if (name in source.columns) throw new Error(`relation ${key}.${name} has the same name as a column`)
    }
    resolved[key] = defined
  }
  return { entities, relations: resolved as ResolvedRelations<E, R> }
}

function builderFor<E extends Record<string, Entity>>(entities: E, source: string): RelationBuilder<E, string> {
  return {
    one(target, on, options) {
      const nullable = options?.optional === true || entities[source]!.columns[on.from]!.options.nullable
      return { kind: 'one', target, from: on.from, to: on.to, nullable } as never
    },
    many(target, on) {
      return { kind: 'many', target, from: on.from, to: on.to }
    },
  }
}
