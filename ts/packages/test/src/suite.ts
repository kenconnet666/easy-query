/**
 * 各方言在实库上跑的同一套用例。open 每次给一个已建表的空库；方言包的测试调用 liveSuite 即可。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { and, caseWhen, createDb, or, touch, win, type Expr, type ExecutionEvent, type Interceptor } from '@eqts/core'
import { CalendarDateTime, fromDate, parseDate, Time } from '@internationalized/date'
import { Decimal } from 'decimal.js'
import { Comment, Company, Ext, Post, schema, seed, User, type TestEnv } from './fixture.ts'

export interface LiveSuiteOptions {
  /** 库里建了 t_ext 表，可以跑 decimal.js / bigint / @internationalized/date 的往返用例 */
  readonly extensionTypes?: boolean
}

export function liveSuite(name: string, open: () => Promise<TestEnv>, options: LiveSuiteOptions = {}): void {
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

    it('updates a whole row by primary key', async () => {
      const { db } = await seeded()
      const alice = await db.queryable(User).where((u) => u.name.eq('alice')).single()
      assert.equal(await db.update(User).entity({ ...alice, name: 'alice2', attrs: { tags: ['x'] } }).execute(), 1)
      const after = await db.queryable(User).where((u) => u.id.eq(alice.id)).single()
      assert.equal(after.name, 'alice2')
      assert.deepEqual(after.attrs, { tags: ['x'] })
      assert.equal(after.createdAt.toISOString(), alice.createdAt.toISOString())
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

  describe(`${name}: windows and per-parent limits`, () => {
    it('computes row numbers, running totals, lag and global counts', async () => {
      const { db } = await seeded()
      const rows = await db.queryable(Post).orderBy((p) => p.id).select((p) => ({
        id: p.id,
        rn: win.rowNumber((w) => w.partitionBy(p.userId).orderBy(p.id.desc())),
        running: win.sum(p.amount, (w) => w.partitionBy(p.userId).orderBy(p.id).rows('unboundedPreceding', 'currentRow')),
        prev: win.lag(p.title, (w) => w.orderBy(p.id)),
        total: win.count(),
      })).toList()
      assert.deepEqual(rows.map((r) => [r.id, r.rn, Number(r.running), r.prev, r.total]), [
        [1, 2, 10.5, null, 4], [2, 1, 2010.5, 'orm tips', 4], [3, 2, 1.25, 'sql 100%', 4], [4, 1, 4.25, 'orm_v2', 4],
      ])
    })

    it('takes the first row and the top n per parent', async () => {
      const { db } = await seeded()
      const rows = await db.queryable(User).orderBy((u) => u.id).select((u) => ({
        name: u.name,
        latest: u.posts.orderBy((p) => p.id.desc()).first((p) => ({ title: p.title })),
        top: u.posts.orderBy((p) => p.amount.desc()).limit(1).toList((p) => ({ title: p.title })),
      })).toList()
      assert.deepEqual(rows, [
        { name: 'alice', latest: { title: 'sql 100%' }, top: [{ title: 'sql 100%' }] },
        { name: 'bob', latest: { title: 'hello' }, top: [{ title: 'hello' }] },
        { name: 'carol', latest: null, top: [] },
      ])
    })
  })

  describe(`${name}: functions and CASE`, () => {
    it('runs string functions', async () => {
      const { db } = await seeded()
      // 第 1 篇帖子的标题是 'orm tips'
      const row = await db.queryable(Post).where((p) => p.id.eq(1)).select((p) => ({
        head: p.title.substring(0, 3),
        tail: p.title.substring(4),
        replaced: p.title.replace('orm', 'ORM'),
        found: p.title.indexOf('tips'),
        missing: p.title.indexOf('zzz'),
        left: p.title.left(3),
        right: p.title.right(4),
        rightAll: p.title.right(100),
      })).single()
      assert.deepEqual(row, { head: 'orm', tail: 'tips', replaced: 'ORM tips', found: 4, missing: -1, left: 'orm', right: 'tips', rightAll: 'orm tips' })
    })

    it('runs math functions', async () => {
      const { db } = await seeded()
      // 第 3 篇帖子金额 1.25；alice 30 岁
      const post = await db.queryable(Post).where((p) => p.id.eq(3)).select((p) => ({
        rounded: p.amount.round(1), floor: p.amount.floor(), ceil: p.amount.ceil(), abs: p.amount.minus(5).abs(),
      })).single()
      assert.deepEqual([Number(post.rounded), Number(post.floor), Number(post.ceil), Number(post.abs)], [1.3, 1, 2, 3.75])
      const user = await db.queryable(User).where((u) => u.name.eq('alice')).select((u) => ({ mod: u.age.mod(7), diff: u.age.minus(40).abs() })).single()
      assert.deepEqual([Number(user.mod), Number(user.diff)], [2, 10])
    })

    it('adds days and months and diffs dates', async () => {
      const { db } = await seeded()
      // created_at = 2026-01-02 03:04:05
      const row = await db.queryable(User).where((u) => u.name.eq('alice')).select((u) => ({
        plus30: u.createdAt.addDays(30).month(),
        plus30Day: u.createdAt.addDays(30).day(),
        minus2: u.createdAt.addDays(-2).year(),
        plus11m: u.createdAt.addMonths(11).month(),
        plus12m: u.createdAt.addMonths(12).year(),
        diff: u.createdAt.diffDays(new Date('2025-12-31T00:00:00Z')),
      })).single()
      assert.deepEqual(row, { plus30: 2, plus30Day: 1, minus2: 2025, plus11m: 12, plus12m: 2027, diff: 2 })
    })

    it('casts and nullIfs', async () => {
      const { db } = await seeded()
      const row = await db.queryable(User).where((u) => u.name.eq('alice')).select((u) => ({
        text: u.age.cast('string'),
        double: u.age.cast('double'),
        decimal: u.age.cast('decimal', 10, 2),
        nulled: u.age.nullIf(30),
        kept: u.age.nullIf(31),
      })).single()
      assert.equal(row.text, '30')
      assert.equal(row.double, 30)
      assert.equal(Number(row.decimal), 30)
      assert.equal(row.nulled, null)
      assert.equal(row.kept, 30)
    })

    it('builds CASE WHEN with literal and expression branches', async () => {
      const { db } = await seeded()
      const rows = await db.queryable(User).orderBy((u) => u.id).select((u) => ({
        name: u.name,
        // bob 的年龄为 NULL，比较结果是 NULL，落到 ELSE
        group: caseWhen(u.age.lt(18), 'minor').when(u.age.lt(65), 'adult').else('unknown'),
        adult: caseWhen(u.age.ge(18), 1).else(0),
        label: caseWhen(u.age.isNull(), u.name.upper()).end(),
      })).toList()
      assert.deepEqual(rows, [
        { name: 'alice', group: 'adult', adult: 1, label: null },
        { name: 'bob', group: 'unknown', adult: 0, label: 'BOB' },
        { name: 'carol', group: 'minor', adult: 0, label: null },
      ])
    })

    it('uses CASE inside conditions and aggregates', async () => {
      const { db } = await seeded()
      // CASE 当条件：年龄 >= 18 才是 adult；bob 的年龄为 NULL，落到 ELSE
      const names = await db.queryable(User).where((u) => caseWhen(u.age.ge(18), 'adult').else('minor').eq('adult')).select((u) => u.name).toList()
      assert.deepEqual(names, ['alice'])
      // CASE 当聚合的参数：金额大于 5 的帖子数（10.50 与 2000.00 两篇）
      assert.equal(Number(await db.queryable(Post).sum((p) => caseWhen(p.amount.gt('5'), 1).else(0))), 2)
    })
  })

  describe(`${name}: extension column types`, { skip: !options.extensionTypes }, () => {
    const at = new Date('2026-01-02T03:04:05.006Z')
    const row = (amount: string, big: bigint) => ({
      amount: new Decimal(amount), big, day: parseDate('2026-01-02'),
      startsAt: new CalendarDateTime(2026, 1, 2, 3, 4, 5, 6), at: fromDate(at, 'Asia/Shanghai'), clock: new Time(8, 30, 15), raw: Uint8Array.from([0, 1, 2, 254, 255]),
    })

    it('round-trips decimal.js, 64-bit integers and every @internationalized/date type', async () => {
      const { db } = await seeded()
      // 2^53 + 1：number 表示不了，往返后必须一模一样
      const big = 9007199254740993n
      await db.insert(Ext).values(row('10.50', big)).execute()
      const back = await db.queryable(Ext).single()
      assert.ok(back.amount instanceof Decimal)
      assert.equal(back.amount.toFixed(2), '10.50')
      assert.equal(back.big, big)
      assert.equal(back.day.toString(), '2026-01-02')
      assert.equal(back.startsAt.toString(), '2026-01-02T03:04:05.006')
      // 同一个时刻，读出时换算到 Asia/Shanghai（UTC+8）
      assert.equal(back.at.toDate().toISOString(), at.toISOString())
      assert.equal(back.at.timeZone, 'Asia/Shanghai')
      assert.equal(back.at.hour, 11)
      assert.equal(back.clock.toString(), '08:30:15')
      // 二进制：读出是普通的 Uint8Array（不是 Buffer），内容一致
      assert.ok(!(back.raw instanceof Buffer))
      assert.deepEqual(back.raw, Uint8Array.from([0, 1, 2, 254, 255]))
    })

    it('compares and filters with the extension types', async () => {
      const { db } = await seeded()
      await db.insert(Ext).values([row('10.50', 9007199254740993n), row('0.25', 1n)]).execute()
      assert.equal(await db.queryable(Ext).where((e) => e.amount.gt(new Decimal('5'))).count(), 1)
      assert.equal(await db.queryable(Ext).where((e) => e.big.eq(9007199254740993n)).count(), 1)
      assert.equal(await db.queryable(Ext).where((e) => e.day.ge(parseDate('2026-01-02'))).count(), 2)
      assert.equal(await db.queryable(Ext).where((e) => e.day.gt(parseDate('2026-01-02'))).count(), 0)
      assert.equal(await db.queryable(Ext).where((e) => e.startsAt.eq(new CalendarDateTime(2026, 1, 2, 3, 4, 5, 6))).count(), 2)
      assert.equal(await db.queryable(Ext).where((e) => e.at.eq(fromDate(at, 'Asia/Shanghai'))).count(), 2)
      // year / month / day 认得这些类型
      const parts = await db.queryable(Ext).select((e) => ({ y: e.day.year(), m: e.startsAt.month(), d: e.at.day() })).first()
      assert.deepEqual(parts, { y: 2026, m: 1, d: 2 })
    })

    it('does exact arithmetic and aggregates on Decimal and bigint', async () => {
      const { db } = await seeded()
      // 浮点算 0.1 + 0.2 会得到 0.30000000000000004；Decimal 不会
      await db.insert(Ext).values([row('0.10', 9007199254740993n), row('0.20', 2n)]).execute()
      const sum = await db.queryable(Ext).sum((e) => e.amount)
      assert.ok(sum instanceof Decimal)
      assert.equal(sum.toFixed(2), '0.30')
      assert.equal((await db.queryable(Ext).avg((e) => e.amount))?.toFixed(2), '0.15')
      assert.equal((await db.queryable(Ext).max((e) => e.amount))?.toFixed(2), '0.20')
      const rows = await db.queryable(Ext).orderBy((e) => e.id).select((e) => ({ doubled: e.amount.times(2), shifted: e.amount.plus(new Decimal('1.05')), next: e.big.plus(1n) })).toList()
      assert.deepEqual(rows.map((r) => [r.doubled.toFixed(2), r.shifted.toFixed(2), r.next]), [['0.20', '1.15', 9007199254740994n], ['0.40', '1.25', 3n]])
      assert.equal(await db.queryable(Ext).sum((e) => e.big), 9007199254740995n)
      await db.update(Ext).set((e) => ({ amount: e.amount.times(3) })).where((e) => e.big.eq(2n)).execute()
      assert.equal((await db.queryable(Ext).where((e) => e.big.eq(2n)).single()).amount.toFixed(2), '0.60')
    })

    it('adds days and diffs dates on @internationalized/date columns', async () => {
      const { db } = await seeded()
      await db.insert(Ext).values(row('1.00', 1n)).execute()
      const r = await db.queryable(Ext).select((e) => ({ plus: e.day.addDays(30).month(), diff: e.day.diffDays(parseDate('2025-12-31')) })).single()
      assert.deepEqual(r, { plus: 2, diff: 2 })
    })
  })

  describe(`${name}: native SQL and execution hooks`, () => {
    it('runs db.sql with bound values, expanded arrays and quoted identifiers', async () => {
      const { db } = await seeded()
      // 标识符都用 ident：各库的引号不同，HANA 里不加引号的名字还会被折成大写
      const t = db.sql.ident
      const rows = await db.sql`SELECT COUNT(*) FROM ${t('t_user')} WHERE ${t('age')} > ${20} AND ${t('name')} IN (${['alice', 'bob']})`
      assert.equal(Number(Object.values(rows[0]!)[0]), 1)
      const affected = await db.sql.execute`UPDATE ${t('t_post')} SET ${t('title')} = ${'renamed'} WHERE ${t('id')} IN (${[1, 2]})`
      assert.equal(affected, 2)
      assert.equal(await db.queryable(Post).where((p) => p.title.eq('renamed')).count(), 2)
    })

    it('rejects undefined values and empty arrays instead of sending a broken statement', async () => {
      const { db } = await seeded()
      await assert.rejects(() => db.sql`SELECT ${undefined}`, /undefined/)
      await assert.rejects(() => db.sql`SELECT 1 WHERE 1 IN (${[]})`, /empty/)
    })

    it('reports every statement to onExecute, with rows, duration and errors', async () => {
      const env = await seeded()
      const events: ExecutionEvent[] = []
      const db = createDb({ schema, adapter: env.adapter, onExecute: (e) => events.push(e) })
      await db.queryable(User).toList()
      await db.delete(Post).where((p) => p.id.eq(1)).execute()
      await assert.rejects(() => db.sql`SELECT * FROM ${db.sql.ident('eqts_no_such_table')}`)
      // 事务里的语句也经过同一个钩子
      await db.transaction(async (tx) => { await tx.queryable(Company).count() })
      assert.deepEqual(events.slice(0, 3).map((e) => [e.kind, e.rows, e.error === undefined]), [['query', 3, true], ['execute', 1, true], ['query', 0, false]])
      assert.ok(events.every((e) => e.durationMs >= 0))
      assert.ok(events.length >= 4 && events.some((e) => e.statement.sql.includes('COUNT')))
    })
  })

  describe(`${name}: root aggregates, decimal arithmetic and insert chunking`, () => {
    it('aggregates a whole query without groupBy', async () => {
      const { db } = await seeded()
      // 种子里四篇帖子的金额：10.50 + 2000.00 + 1.25 + 3.00
      assert.equal(Number(await db.queryable(Post).sum((p) => p.amount)), 2014.75)
      assert.equal(Number(await db.queryable(Post).max((p) => p.amount)), 2000)
      assert.equal(Number(await db.queryable(Post).min((p) => p.amount)), 1.25)
      assert.equal(Number(await db.queryable(Post).avg((p) => p.amount)), 2014.75 / 4)
      assert.equal(await db.queryable(Post).countDistinct((p) => p.userId), 2)
      // where 条件照常生效；排序被丢掉，不会让 PG 报"ORDER BY 不在聚合里"
      assert.equal(Number(await db.queryable(Post).where((p) => p.userId.eq(2)).orderBy((p) => p.id).sum((p) => p.amount)), 4.25)
      assert.equal(await db.queryable(User).sum((u) => u.age), 47)
    })

    it('returns null for aggregates over no rows', async () => {
      const { db } = await seeded()
      const none = db.queryable(Post).where((p) => p.userId.eq(999))
      assert.equal(await none.sum((p) => p.amount), null)
      assert.equal(await none.max((p) => p.amount), null)
      assert.equal(await none.countDistinct((p) => p.userId), 0)
    })

    it('refuses aggregates combined with limit', async () => {
      const { db } = await seeded()
      await assert.rejects(() => db.queryable(Post).limit(2).sum((p) => p.amount), /limit/)
    })

    it('does arithmetic on decimal columns with numbers, decimal text and other columns', async () => {
      const { db } = await seeded()
      const rows = await db.queryable(Post).orderBy((p) => p.id).select((p) => ({
        doubled: p.amount.times(2),
        plusText: p.amount.plus('0.50'),
        self: p.amount.minus(p.amount),
      })).toList()
      assert.deepEqual(rows.map((r) => [Number(r.doubled), Number(r.plusText), Number(r.self)]), [
        [21, 11, 0], [4000, 2000.5, 0], [2.5, 1.75, 0], [6, 3.5, 0],
      ])
      await db.update(Post).set((p) => ({ amount: p.amount.plus(1) })).where((p) => p.id.eq(3)).execute()
      assert.equal(Number((await db.queryable(Post).where((p) => p.id.eq(3)).single()).amount), 2.25)
    })

    it('inserts many rows, splitting them into statements below the parameter limit', async () => {
      const { db } = await seeded()
      // 3 列 × 12000 行 = 36000 个参数，超过 SQLite 的 32766，必须分块；其它库一次也能装下，结果一致
      const rows = Array.from({ length: 12000 }, (_, i) => ({ userId: 1, title: `bulk ${i}`, amount: '1.00' as const }))
      assert.equal(await db.insert(Post).values(rows).execute(), 12000)
      assert.equal(await db.queryable(Post).where((p) => p.title.startsWith('bulk ')).count(), 12000)
    })
  })
}
