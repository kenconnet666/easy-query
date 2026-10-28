/**
 * 各方言共用的测试实体与种子数据。建表语句各方言自己写（类型不同），列名一致。
 */
import { col, defineSchema, entity, type Adapter, type Db, type Statement } from '@eqts/core'
import { calendarDate, calendarDateTime, timeOfDay, zonedDateTime } from '@eqts/date'
import { decimalJs } from '@eqts/decimal'

export const Company = entity('t_company', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(),
})

export const User = entity('t_user', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(),
  age: col.int().nullable(),
  companyId: col.bigint().nullable(),
  attrs: col.json<{ tags: string[] }>().defaulted(),
  createdAt: col.datetime(),
})

export const Post = entity('t_post', {
  id: col.bigint().primaryKey().generated(),
  userId: col.bigint(),
  title: col.string(),
  amount: col.decimal(12, 2),
})

export const Comment = entity('t_comment', {
  id: col.bigint().primaryKey().generated(),
  postId: col.bigint(),
  body: col.string(),
})

/**
 * 扩展列类型的往返：decimal.js、64 位整数、@internationalized/date 的四种类型。
 * 只有开了 extensionTypes 的实库套件会建这张表（HANA 暂未验证）。
 */
export const Ext = entity('t_ext', {
  id: col.bigint().primaryKey().generated(),
  amount: decimalJs(12, 2),
  big: col.bigint({ mode: 'bigint' }),
  day: calendarDate(),
  startsAt: calendarDateTime(),
  at: zonedDateTime('Asia/Shanghai'),
  clock: timeOfDay(),
  raw: col.bytes(),
})

export const schema = defineSchema({ Company, User, Post, Comment, Ext }, {
  Company: (r) => ({ users: r.many('User', { from: 'id', to: 'companyId' }) }),
  User: (r) => ({
    company: r.one('Company', { from: 'companyId', to: 'id' }),
    posts: r.many('Post', { from: 'id', to: 'userId' }),
  }),
  Post: (r) => ({
    user: r.one('User', { from: 'userId', to: 'id' }),
    comments: r.many('Comment', { from: 'id', to: 'postId' }),
  }),
  Comment: (r) => ({ post: r.one('Post', { from: 'postId', to: 'id' }) }),
})

export type TestDb = Db<typeof schema>

/** 一个空库（已建表）+ 执行过的语句 */
export interface TestEnv {
  readonly db: TestDb
  readonly statements: Statement[]
  /** 同一个连接，用来另建带拦截器的 db */
  readonly adapter: Adapter
}

/** 两家公司、三个用户（一个无公司）、四篇帖子、两条评论；返回后清空语句记录 */
export async function seed(env: TestEnv): Promise<TestEnv> {
  const { db } = env
  const acme = Number(await db.insert(Company).values({ name: 'acme' }).returnId())
  await db.insert(Company).values({ name: 'globex' }).execute()
  const t = new Date('2026-01-02T03:04:05.006Z')
  const alice = Number(await db.insert(User).values({ name: 'alice', age: 30, companyId: acme, attrs: { tags: ['vip'] }, createdAt: t }).returnId())
  const bob = Number(await db.insert(User).values({ name: 'bob', age: null, companyId: acme, attrs: { tags: [] }, createdAt: t }).returnId())
  await db.insert(User).values({ name: 'carol', age: 17, companyId: null, attrs: { tags: [] }, createdAt: t }).execute()
  await db.insert(Post).values([
    { userId: alice, title: 'orm tips', amount: '10.50' },
    { userId: alice, title: 'sql 100%', amount: '2000.00' },
    { userId: bob, title: 'orm_v2', amount: '1.25' },
    { userId: bob, title: 'hello', amount: '3.00' },
  ]).execute()
  await db.insert(Comment).values([{ postId: 1, body: 'nice' }, { postId: 1, body: 'thanks' }]).execute()
  env.statements.length = 0
  return env
}
