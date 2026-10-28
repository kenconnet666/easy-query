# TS：视图 `defineView`（可复用、可嵌套的投影）

把"这个实体要选哪些列、带哪些导航"写成一个有名字的函数，到处复用，对应 Java 版的 DTO / VO（`selectAutoInclude`）。TS 里不需要再写一遍 DTO 类：结果类型由形状自动推导。

```ts
const PostCard = defineView(schema, Post, p => ({ title: p.title, author: p.user.name }))
const UserCard = defineView(schema, User, u => ({
  id: u.id,
  company: u.company.name,
  posts: u.posts.orderBy(p => p.id).toList(PostCard),        // 嵌套另一个视图
}))
type UserCard = ViewOf<typeof UserCard>   // { id: number; company: string | null; posts: { title: string; author: string }[] }

await db.queryable(User).where(...).select(UserCard).toList()
await db.queryable(Post).select(p => ({ ...PostCard(p), id: p.id })).toList()    // 在别的 select 里展开
```

- 视图就是一个函数 `(ref) => 形状`，任何接受 `r => 形状` 的地方（`select`、`toList`、`first`）都能直接传。
- `defineView(schema, 实体, 形状)` 的 schema 只用来推导类型，运行时不读它；视图属于它的实体，用在别的实体的查询上编译不过。
- 形状里可以用导航、一对多的 `toList / first / count / sum`、窗口函数、别的视图。
- 限制：可空的多对一导航（如 `u.company`）给出的引用是可空的，不能直接传给要求非空引用的视图；直接选列，或在形状里展开。

SQLite、MySQL 8.0.18 / 8.4、PG 17 实测；HANA 随 CI。
