/**
 * 类型层面的检查：只参与 tsc，不运行。正例用 Equal 断言推导出的类型，负例用 @ts-expect-error 固定"必须报错"。
 */
import { col, createDb, defineSchema, entity, sql, win, type Adapter, type Insert, type Row } from '@eqts/core'

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
    user: { age: number | null; n: number; total: string | null }
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
}
void results

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
])
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
