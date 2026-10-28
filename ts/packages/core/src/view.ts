/**
 * 视图（可复用的投影）：把"这个实体要选哪些列、带哪些导航"写成一个有名字的函数，到处复用、可以嵌套，
 * 对应 Java 版的 DTO / VO。结果类型自动推导，不需要再写一遍 DTO 类：
 * ```ts
 * const PostCard = defineView(schema, Post, p => ({ title: p.title, author: p.user.name }))
 * const UserCard = defineView(schema, User, u => ({
 *   id: u.id,
 *   company: u.company.name,
 *   posts: u.posts.orderBy(p => p.id).toList(PostCard),      // 嵌套另一个视图
 * }))
 * type UserCard = ViewOf<typeof UserCard>                      // { id: number; company: string | null; posts: { title: string; author: string }[] }
 *
 * await db.queryable(User).where(...).select(UserCard).toList()
 * await db.queryable(Post).select(p => ({ ...PostCard(p), id: p.id })).toList()   // 也可以在别的 select 里展开
 * ```
 * 视图就是一个函数，所以任何接受 `r => 形状` 的地方（select、toList、first）都能直接传它。
 */
import type { Entity } from './schema.ts'
import type { KeyOf } from './db.ts'
import type { Ref, Selected } from './ref.ts'
import type { AnySchema } from './relations.ts'

/** 视图：收到该实体的表引用，返回 select 的形状。`entity` 记着它属于哪个实体 */
export interface View<S extends AnySchema, E extends Entity, X> {
  (ref: Ref<S, KeyOf<S, E>>): X
  readonly entity: E
}

/** 视图 select 出来的结果类型 */
export type ViewOf<V extends { (ref: never): unknown }> = Selected<ReturnType<V>>

/**
 * 定义视图。schema 只用来推导类型（列、导航），运行时不需要它；形状函数里可以随便用导航、一对多的 toList / first / count、别的视图。
 * 对可空的多对一导航（如 `u.company`），视图收到的引用是可空的：不能直接传给要求非空引用的视图，请直接选列或在形状里展开。
 */
export function defineView<S extends AnySchema, E extends S['entities'][keyof S['entities'] & string], X>(
  _schema: S,
  entity: E,
  shape: (ref: Ref<S, KeyOf<S, E>>) => X,
): View<S, E, X> {
  return Object.assign((ref: Ref<S, KeyOf<S, E>>) => shape(ref), { entity })
}
