/**
 * 类型层面的检查：只参与 tsc，不运行。正例用 Equal 断言推导出的类型，负例用 @ts-expect-error 固定"必须报错"。
 */
import { col, createDb, defineSchema, defineView, entity, sql, win, type Adapter, type Insert, type Row, type ViewOf } from '@eqts/core'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expect<T extends true>(): T | void {}

const Company = entity('t_company', { id: col.bigint().primaryKey().generated(), name: col.string() })
const User = entity('t_user', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(),
  age: col.int().nullable(),
  companyId: col.bigint().nullable(),
  attrs: col.json<{ tags: string[] }>().defaulted(),
  createdAt: col.datetime(),
})
const Post = entity('t_post', { id: col.bigint().primaryKey().generated(), userId: col.bigint(), title: col.string(), amount: col.decimal(12, 2) })
const Unrelated = entity('t_unrelated', { id: col.int() })

const schema = defineSchema({ Company, User, Post }, {
  User: (r) => ({ company: r.one('Company', { from: 'companyId', to: 'id' }), posts: r.many('Post', { from: 'id', to: 'userId' }) }),
  Post: (r) => ({ user: r.one('User', { from: 'userId', to: 'id' }) }),
})

declare const adapter: Adapter
const db = createDb({ schema, adapter })

// 行与插入的形状
expect<Equal<Row<typeof User>, { id: number; name: string; age: number | null; companyId: number | null; attrs: { tags: string[] }; createdAt: Date }>>()
expect<Equal<keyof Insert<typeof User>, 'id' | 'name' | 'age' | 'companyId' | 'attrs' | 'createdAt'>>()
db.insert(User).values({ name: 'a', createdAt: new Date() })
// @ts-expect-error 缺必填列 createdAt
db.insert(User).values({ name: 'a' })
// @ts-expect-error 列类型不对
db.insert(User).values({ name: 1, createdAt: new Date() })

// 查询结果的推导
async function results() {
  const rows = await db.queryable(User)
    .where((u) => [u.name.like('a'), u.posts.any((p) => p.title.eq('x'))])
    .select((u) => ({
      id: u.id,
      company: u.company.name,
      user: { age: u.age, n: u.posts.count(), total: u.posts.sum((p) => p.amount) },
      posts: u.posts.toList((p) => ({ title: p.title, author: p.user.name })),
      len: sql<number>`LENGTH(${u.name})`,
    }))
    .toList()
  expect<Equal<typeof rows, {
    id: number
    company: string | null
    user: { age: number | null; n: number; total: `${number}` | null }
    posts: { title: string; author: string }[]
    len: number
  }[]>>()

  const included = await db.queryable(User).include((u) => ({ company: u.company, posts: u.posts.toList() })).first()
  expect<Equal<NonNullable<typeof included>['company'], Row<typeof Company> | null>>()
  expect<Equal<NonNullable<typeof included>['posts'], Row<typeof Post>[]>>()

  // 非空外键的多对一导航不带 null
  const authors = await db.queryable(Post).select((p) => ({ author: p.user.name, company: p.user.company.name })).toList()
  expect<Equal<typeof authors, { author: string; company: string | null }[]>>()

  const groups = await db.queryable(Post).groupBy((p) => ({ userId: p.userId })).select((g) => ({ ...g.key, n: g.count(), max: g.max((p) => p.title) })).toList()
  expect<Equal<typeof groups, { userId: number; n: number; max: string | null }[]>>()

  const latest = await db.queryable(User).select((u) => ({
    first: u.posts.orderBy((p) => p.id.desc()).first((p) => ({ title: p.title })),
    top: u.posts.limit(3).toList(),
    rn: win.rowNumber((w) => w.partitionBy(u.companyId)),
    running: win.sum(u.age, (w) => w.orderBy(u.id).rows('unboundedPreceding', 'currentRow')),
  })).toList()
  expect<Equal<typeof latest, { first: { title: string } | null; top: Row<typeof Post>[]; rn: number; running: number | null }[]>>()

  const keys = await db.queryable(Post).groupBy((p) => ({ userId: p.userId })).toList()
  expect<Equal<typeof keys, { userId: number }[]>>()

  // 根查询聚合：decimal 列的和是数值文字，整数列是 number，没有行时都是 null
  const total = await db.queryable(Post).sum((p) => p.amount)
  expect<Equal<typeof total, `${number}` | null>>()
  const oldest = await db.queryable(User).max((u) => u.createdAt)
  expect<Equal<typeof oldest, Date | null>>()
  const ageSum = await db.queryable(User).sum((u) => u.age)
  expect<Equal<typeof ageSum, number | null>>()
  const distinctUsers = await db.queryable(Post).countDistinct((p) => p.userId)
  expect<Equal<typeof distinctUsers, number>>()
}
void results

// 显式 join：lambda 按 join 顺序收到各表引用；left join 的那张表列可空；没写 select 时按实体名分组
async function joins() {
  const inner = await db.queryable(User).innerJoin(Post, (u, p) => p.userId.eq(u.id)).select((u, p) => ({ name: u.name, title: p.title })).toList()
  expect<Equal<typeof inner, { name: string; title: string }[]>>()

  const left = await db.queryable(User).leftJoin(Post, (u, p) => p.userId.eq(u.id)).select((u, p) => ({ name: u.name, title: p.title })).toList()
  expect<Equal<typeof left, { name: string; title: string | null }[]>>()

  const rows = await db.queryable(User).innerJoin(Post, (u, p) => p.userId.eq(u.id)).leftJoin(Company, (u, _p, c) => c.id.eq(u.companyId)).toList()
  expect<Equal<typeof rows, { User: Row<typeof User>; Post: Row<typeof Post>; Company: Row<typeof Company> | null }[]>>()

  // join 之后 where / orderBy / groupBy 都按顺序收到各表引用
  const grouped = await db.queryable(User).innerJoin(Post, (u, p) => p.userId.eq(u.id))
    .where((u, p) => [u.age.ge(18), p.amount.gt('5')])
    .groupBy((u) => ({ name: u.name }))
    .select((g) => ({ name: g.key.name, total: g.sum((_u, p) => p.amount) }))
    .toList()
  expect<Equal<typeof grouped, { name: string; total: `${number}` | null }[]>>()

  const total = await db.queryable(User).innerJoin(Post, (u, p) => p.userId.eq(u.id)).sum((_u, p) => p.amount)
  expect<Equal<typeof total, `${number}` | null>>()
}
void joins

// @ts-expect-error join 的 on 里新表没有这个列
db.queryable(User).innerJoin(Post, (u, p) => p.nope.eq(u.id))
// @ts-expect-error 实体不在 schema 里
db.queryable(User).innerJoin(Unrelated, (u, x) => x.id.eq(u.id))

// decimal 列可以做算术（数值文字或 number），结果仍是 decimal；普通字符串列不行
db.update(Post).set((p) => ({ amount: p.amount.times(2) })).where((p) => p.amount.plus('1.5').gt('3'))
db.queryable(Post).select((p) => ({ doubled: p.amount.times(2), shifted: p.amount.minus(p.amount) }))

// 负例
db.queryable(User).where((u) => [
  // @ts-expect-error 数字列不能和字符串比
  u.age.eq('1'),
  // @ts-expect-error like 只能用在字符串列
  u.age.like('1'),
  // @ts-expect-error 不存在的列
  u.nope.eq(1),
  // @ts-expect-error 一对多导航不能直接取列
  u.posts.title.eq('x'),
  // @ts-expect-error 年份只能从日期取（date 列是文字，所以字符串列也允许）
  u.age.year().eq(2026),
  // @ts-expect-error 普通字符串列不能做算术（decimal 列才是数值文字）
  u.name.plus(1).eq('x'),
])
// @ts-expect-error sum 只接受数值列
db.queryable(User).sum((u) => u.name)
// @ts-expect-error 实体不在 schema 里
db.queryable(Unrelated)
db.update(User).set({
  // @ts-expect-error set 的值类型不对
  age: 'x',
})

defineSchema({ Company, User }, {
  // @ts-expect-error from 必须是本实体的列
  User: (r) => ({ company: r.one('Company', { from: 'nope', to: 'id' }) }),
})
defineSchema({ Company, User }, {
  // @ts-expect-error 目标实体不存在
  User: (r) => ({ company: r.one('Nope', { from: 'companyId', to: 'id' }) }),
})

// 列修饰器：品牌类型、枚举、客户端默认值让插入时可省
type UserId = number & { readonly __brand: 'UserId' }
const Tagged = entity('t_tagged', {
  id: col.bigint().primaryKey().generated().$type<UserId>(),
  kind: col.enum(['a', 'b'] as const),
  token: col.string().$default(() => 'x'),
  gone: col.boolean().softDelete(),
  version: col.int().version(),
})
expect<Equal<Row<typeof Tagged>['id'], UserId>>()
expect<Equal<Row<typeof Tagged>['kind'], 'a' | 'b'>>()
// token、gone、version 插入时可省；kind 必填
expect<Equal<keyof Insert<typeof Tagged>, 'id' | 'kind' | 'token' | 'gone' | 'version'>>()
const taggedDb = createDb({ schema: defineSchema({ Tagged }), adapter })
taggedDb.insert(Tagged).values({ kind: 'a' })
// @ts-expect-error 枚举之外的值
taggedDb.insert(Tagged).values({ kind: 'c' })
// @ts-expect-error kind 必填
taggedDb.insert(Tagged).values({})

// 视图：可复用、可嵌套的投影，结果类型自动推导
const PostCard = defineView(schema, Post, (p) => ({ title: p.title, author: p.user.name }))
const UserCard = defineView(schema, User, (u) => ({ id: u.id, company: u.company.name, posts: u.posts.toList(PostCard) }))
async function views() {
  const rows = await db.queryable(User).select(UserCard).toList()
  type Card = { id: number; company: string | null; posts: { title: string; author: string }[] }
  expect<Equal<typeof rows, Card[]>>()
  expect<Equal<ViewOf<typeof UserCard>, Card>>()
  // 在别的 select 里展开视图
  const posts = await db.queryable(Post).select((p) => ({ ...PostCard(p), id: p.id })).toList()
  expect<Equal<typeof posts, { title: string; author: string; id: number }[]>>()
}
void views
// @ts-expect-error 视图属于 User，不能用在 Post 的查询上
db.queryable(Post).select(UserCard)
