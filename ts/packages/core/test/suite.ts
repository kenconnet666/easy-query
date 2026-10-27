/**
 * 各方言在实库上跑的同一套用例。open 每次给一个已建表的空库；方言包的测试调用 liveSuite 即可。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { and, createDb, or, touch, type Expr, type Interceptor } from '../src/index.ts'
import { Comment, Company, Post, schema, seed, User, type TestEnv } from './fixture.ts'

export function liveSuite(name: string, open: () => Promise<TestEnv>): void {
  const seeded = async () => seed(await open())

  describe(`${name}: queries`, () => {
    it('reads rows with decoded values', async () => {
      const { db } = await seeded()
      const alice = await db.queryable(User).where((u) => u.name.eq('alice')).single()
      assert.equal(alice.id, 1)
      assert.deepEqual(alice.attrs, { tags: ['vip'] })
      assert.ok(alice.createdAt instanceof Date)
      assert.equal(alice.createdAt.toISOString(), '2026-01-02T03:04:05.006Z')
      assert.equal(await db.queryable(User).where((u) => u.name.eq('nobody')).first(), undefined)
    })

    it('escapes LIKE wildcards in the searched text', async () => {
      const { db } = await seeded()
      const titles = await db.queryable(Post).where((p) => p.title.like('_')).select((p) => ({ t: p.title })).toList()
      assert.deepEqual(titles, [{ t: 'orm_v2' }])
      assert.equal(await db.queryable(Post).where((p) => p.title.endsWith('100%')).count(), 1)
    })

    it('filters through navigations and implicit subqueries', async () => {
      const { db } = await seeded()
      const names = await db.queryable(User)
        .where((u) => [u.company.name.eq('acme'), u.posts.any((p) => p.title.startsWith('orm'))])
        .orderBy((u) => u.id)
        .select((u) => ({ name: u.name }))
        .toList()
      assert.deepEqual(names, [{ name: 'alice' }, { name: 'bob' }])
      assert.equal(await db.queryable(User).where((u) => u.posts.none()).count(), 1)
    })

    it('selects nullable navigations, aggregates and nested objects', async () => {
      const { db } = await seeded()
      const rows = await db.queryable(User)
        .orderBy((u) => u.id)
        .select((u) => ({
          name: u.name,
          company: u.company.name,
          stats: { posts: u.posts.count(), big: u.posts.count((p) => p.amount.gt('100')), max: u.posts.max((p) => p.title) },
        }))
        .toList()
      assert.deepEqual(rows, [
        { name: 'alice', company: 'acme', stats: { posts: 2, big: 1, max: 'sql 100%' } },
        { name: 'bob', company: 'acme', stats: { posts: 2, big: 0, max: 'orm_v2' } },
        { name: 'carol', company: null, stats: { posts: 0, big: 0, max: null } },
      ])
    })

    it('assembles object trees with toList, nested two levels', async () => {
      const { db, statements } = await seeded()
      const rows = await db.queryable(User)
        .where((u) => u.company.name.eq('acme'))
        .orderBy((u) => u.id)
        .select((u) => ({
          name: u.name,
          posts: u.posts.where((p) => p.amount.gt('2')).orderBy((p) => p.id.desc()).toList((p) => ({
            title: p.title,
            author: p.user.name,
            comments: p.comments.orderBy((c) => c.id).toList((c) => ({ body: c.body })),
          })),
        }))
        .toList()
      assert.deepEqual(rows, [
        { name: 'alice', posts: [
          { title: 'sql 100%', author: 'alice', comments: [] },
          { title: 'orm tips', author: 'alice', comments: [{ body: 'nice' }, { body: 'thanks' }] },
        ] },
        { name: 'bob', posts: [{ title: 'hello', author: 'bob', comments: [] }] },
      ])
      assert.equal(statements.length, 3, 'one query per level')
    })

    it('includes navigations on whole rows', async () => {
      const { db } = await seeded()
      const users = await db.queryable(User)
        .where((u) => u.name.in(['bob', 'carol']))
        .orderBy((u) => u.id)
        .include((u) => ({ company: u.company, posts: u.posts.orderBy((p) => p.id).toList() }))
        .toList()
      assert.equal(users[0]!.company?.name, 'acme')
      assert.deepEqual(users[0]!.posts.map((p) => p.title), ['orm_v2', 'hello'])
      assert.equal(users[1]!.company, null)
      assert.deepEqual(users[1]!.posts, [])
    })

    it('groups with conditional aggregates and having', async () => {
      const { db } = await seeded()
      const rows = await db.queryable(Post)
        .groupBy((p) => ({ userId: p.userId }))
        .having((g) => g.count().ge(2))
        .orderBy((g) => g.key.userId)
        .select((g) => ({ ...g.key, n: g.count(), orm: g.count((p) => p.title.startsWith('orm')), total: g.sum((p) => p.amount) }))
        .toList()
      assert.deepEqual(rows.map((r) => [r.userId, r.n, r.orm]), [[1, 2, 1], [2, 2, 1]])
      assert.equal(Number(rows[0]!.total), 2010.5)
      assert.equal(await db.queryable(Post).groupBy((p) => ({ userId: p.userId })).count(), 2)
    })

    it('pages with a total count', async () => {
      const { db } = await seeded()
      const page = await db.queryable(Post).orderBy((p) => p.id).select((p) => ({ id: p.id })).toPage(2, 3)
      assert.deepEqual(page, { rows: [{ id: 4 }], total: 4, page: 2, size: 3 })
    })

    it('reuses builders without leaking state', async () => {
      const { db } = await seeded()
      const base = db.queryable(Post).where((p) => p.title.startsWith('orm'))
      assert.equal(await base.count(), 2)
      assert.equal((await base.where((p) => p.user.name.eq('bob')).toList()).length, 1)
      assert.equal((await base.toList()).length, 2)
      assert.equal(await base.any(), true)
    })

    it('combines and / or / not helpers', async () => {
      const { db } = await seeded()
      const n = await db.queryable(User).where((u) => or(and(u.age.ge(18), u.name.eq('alice')), u.company.id.isNull())).count()
      assert.equal(n, 2)
    })

    it('uses dialect functions', async () => {
      const { db } = await seeded()
      const r = await db.queryable(User).where((u) => u.id.eq(1)).select((u) => ({
        up: u.name.upper(), len: u.name.length(), year: u.createdAt.year(), label: u.name.concat('@', u.company.name.orElse('-')),
      })).single()
      assert.deepEqual(r, { up: 'ALICE', len: 5, year: 2026, label: 'alice@acme' })
    })

    it('rejects outer navigations inside toList filters', async () => {
      const { db } = await seeded()
      await assert.rejects(
        db.queryable(User).select((u) => ({ posts: u.posts.where((p) => p.title.eq(u.name)).toList() })).toList(),
        /not part of this statement/,
      )
    })

    it('runs subqueries through deep navigation', async () => {
      const { db } = await seeded()
      const companies = await db.queryable(Company)
        .where((c) => c.users.any((u) => u.posts.any((p) => p.comments.any())))
        .select((c) => ({ name: c.name }))
        .toList()
      assert.deepEqual(companies, [{ name: 'acme' }])
      assert.equal(await db.queryable(Comment).where((c) => c.post.user.company.name.eq('acme')).count(), 2)
    })
  })

  describe(`${name}: writes`, () => {
    it('updates with expressions and conditions', async () => {
      const { db } = await seeded()
      const n = await db.update(User).set((u) => ({ age: u.age.plus(1), name: 'alice2' })).where((u) => u.name.eq('alice')).execute()
      assert.equal(n, 1)
      const alice = await db.queryable(User).where((u) => u.id.eq(1)).single()
      assert.equal(alice.age, 31)
      assert.equal(alice.name, 'alice2')
    })

    it('updates and deletes through many-navigation subqueries', async () => {
      const { db } = await seeded()
      assert.equal(await db.update(User).set({ age: 99 }).where((u) => u.posts.any((p) => p.amount.gt('1000'))).execute(), 1)
      assert.equal(await db.delete(Post).where((p) => p.title.startsWith('orm')).execute(), 2)
      assert.equal(await db.queryable(Post).count(), 2)
    })

    it('deletes everything only with all()', async () => {
      const { db } = await seeded()
      assert.equal(await db.delete(Comment).all().execute(), 2)
    })

    it('commits and rolls back transactions', async () => {
      const { db } = await seeded()
      await db.transaction(async (tx) => {
        await tx.update(User).set({ age: 1 }).where((u) => u.id.eq(1)).execute()
      })
      await assert.rejects(db.transaction(async (tx) => {
        await tx.update(User).set({ age: 2 }).where((u) => u.id.eq(1)).execute()
        throw new Error('boom')
      }), /boom/)
      assert.equal((await db.queryable(User).where((u) => u.id.eq(1)).single()).age, 1)
    })

    it('serializes concurrent transactions that lock the same row', async () => {
      const { db } = await seeded()
      const bump = () => db.transaction(async (tx) => {
        const { age } = await tx.queryable(User).where((u) => u.id.eq(1)).forUpdate().single()
        await new Promise((r) => setTimeout(r, 5))
        await tx.update(User).set({ age: (age ?? 0) + 1 }).where((u) => u.id.eq(1)).execute()
      })
      await Promise.all([bump(), bump(), bump()])
      assert.equal((await db.queryable(User).where((u) => u.id.eq(1)).single()).age, 33)
    })
  })

  describe(`${name}: upsert and interceptors`, () => {
    it('upserts by merging, defaulting the merged columns, and ignoring', async () => {
      const { db } = await seeded()
      await db.insert(Company).values({ id: 1, name: 'acme2' }).onConflict((c) => c.id).merge((c) => [c.name]).execute()
      await db.insert(Company).values({ id: 2, name: 'globex2' }).onConflict((c) => c.id).merge().execute()
      await db.insert(Company).values({ id: 1, name: 'ignored' }).onConflict((c) => c.id).ignore().execute()
      const names = await db.queryable(Company).orderBy((c) => c.id).select((c) => ({ name: c.name })).toList()
      assert.deepEqual(names, [{ name: 'acme2' }, { name: 'globex2' }])
    })

    it('applies filters to the root, joins, subqueries, toList and writes', async () => {
      const env = await seeded()
      const adults: Interceptor = {
        name: 'adults',
        filter: (ref, entity) => entity.table === 't_user' && (ref as unknown as { age: Expr<number | null> }).age.ge(18),
      }
      const db = createDb({ schema, adapter: env.adapter, interceptors: [adults] })
      assert.equal(await db.queryable(User).count(), 1)
      assert.equal(await db.queryable(User).noInterceptor('adults').count(), 3)
      // LEFT JOIN 的条件进 ON：帖子都在，bob 的帖子作者为 null
      const authors = await db.queryable(Post).orderBy((p) => p.id).select((p) => ({ author: p.user.name })).toList()
      assert.deepEqual(authors.map((a) => a.author), ['alice', 'alice', null, null])
      const companies = await db.queryable(Company).orderBy((c) => c.id).select((c) => ({ n: c.users.count(), users: c.users.toList((u) => ({ name: u.name })) })).toList()
      assert.deepEqual(companies, [{ n: 1, users: [{ name: 'alice' }] }, { n: 0, users: [] }])
      assert.equal(await db.update(User).set({ age: 50 }).all().execute(), 1)
      assert.equal((await env.db.queryable(User).where((u) => u.name.eq('bob')).single()).age, null)
    })

    it('fills values before insert and update', async () => {
      const env = await seeded()
      const defaultAge: Interceptor = {
        name: 'default-age',
        beforeInsert: (row, entity) => { if (entity.table === 't_user' && row['age'] === undefined) row['age'] = 1 },
      }
      const db = createDb({ schema, adapter: env.adapter, interceptors: [defaultAge, touch('title', () => 'touched')] })
      await db.insert(User).values({ name: 'dave', attrs: { tags: [] }, createdAt: new Date() }).execute()
      assert.equal((await db.queryable(User).where((u) => u.name.eq('dave')).single()).age, 1)
      await db.update(Post).set({ amount: '9.00' }).where((p) => p.id.eq(1)).execute()
      assert.equal((await db.queryable(Post).where((p) => p.id.eq(1)).single()).title, 'touched')
    })
  })
}
