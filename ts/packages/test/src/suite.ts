/**
 * 各方言在实库上跑的同一套用例。open 每次给一个已建表的空库；方言包的测试调用 liveSuite 即可。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { and, caseWhen, createDb, defineView, or, touch, win, type Expr, type ExecutionEvent, type Interceptor } from '@eqts/core'
import { CalendarDateTime, fromDate, parseDate, Time } from '@internationalized/date'
import { Decimal } from 'decimal.js'
import { Comment, Company, Doc, Ext, Member, Note, Post, Role, schema, seed, User, UserRole, type TestEnv } from './fixture.ts'

export interface LiveSuiteOptions {
  /** 库里建了 t_ext 表，可以跑 decimal.js / bigint / @internationalized/date 的往返用例 */
  readonly extensionTypes?: boolean
  /** 库里建了 t_role / t_user_role / t_member / t_note，可以跑多对多与复合外键的用例 */
  readonly extraTables?: boolean
  /** 是否测试递归 CTE；HANA 没有 WITH RECURSIVE，传 false */
  readonly recursiveCte?: boolean
  /** 是否测试只读事务；各库的拒绝写入报错不同，只断言"会失败"。HANA 未验证时可关 */
  readonly readOnlyTransactions?: boolean
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

  describe(`${name}: many-to-many and composite relations`, { skip: !options.extraTables }, () => {
    /** alice: admin + dev；bob: dev；carol 没有角色 */
    const withRoles = async () => {
      const env = await seeded()
      const { db } = env
      await db.insert(Role).values([{ name: 'admin' }, { name: 'dev' }, { name: 'ops' }]).execute()
      await db.insert(UserRole).values([{ userId: 1, roleId: 1 }, { userId: 1, roleId: 2 }, { userId: 2, roleId: 2 }]).execute()
      return env
    }

    it('filters and counts through the junction table', async () => {
      const { db } = await withRoles()
      const names = (rows: { name: string }[]) => rows.map((r) => r.name)
      const q = db.queryable(User).orderBy((u) => u.id)
      assert.deepEqual(names(await q.where((u) => u.roles.any((r) => r.name.eq('dev'))).toList()), ['alice', 'bob'])
      assert.deepEqual(names(await q.where((u) => u.roles.any((r) => r.name.eq('admin'))).toList()), ['alice'])
      assert.deepEqual(names(await q.where((u) => u.roles.none((r) => r.name.eq('admin'))).toList()), ['bob', 'carol'])
      const counts = await q.select((u) => ({ name: u.name, roles: u.roles.count() })).toList()
      assert.deepEqual(counts.map((c) => [c.name, c.roles]), [['alice', 2], ['bob', 1], ['carol', 0]])
    })

    it('builds object trees through the junction table, with per-parent limits', async () => {
      const { db } = await withRoles()
      const rows = await db.queryable(User).orderBy((u) => u.id).select((u) => ({
        name: u.name,
        roles: u.roles.orderBy((r) => r.name).toList((r) => ({ name: r.name })),
        first: u.roles.orderBy((r) => r.name.desc()).first((r) => ({ name: r.name })),
      })).toList()
      assert.deepEqual(rows, [
        { name: 'alice', roles: [{ name: 'admin' }, { name: 'dev' }], first: { name: 'dev' } },
        { name: 'bob', roles: [{ name: 'dev' }], first: { name: 'dev' } },
        { name: 'carol', roles: [], first: null },
      ])
    })

    it('works from the other side too', async () => {
      const { db } = await withRoles()
      const rows = await db.queryable(Role).orderBy((r) => r.id).select((r) => ({ name: r.name, users: r.users.orderBy((u) => u.id).toList((u) => ({ name: u.name })) })).toList()
      assert.deepEqual(rows, [
        { name: 'admin', users: [{ name: 'alice' }] },
        { name: 'dev', users: [{ name: 'alice' }, { name: 'bob' }] },
        { name: 'ops', users: [] },
      ])
    })

    it('matches composite foreign keys on every column', async () => {
      const { db } = await seeded()
      // m1 与 m3 的 id 相同、租户不同：只比较 id 会把租户 2 的笔记算到 m1 头上
      await db.insert(Member).values([{ tenantId: 1, id: 1, name: 'm1' }, { tenantId: 1, id: 2, name: 'm2' }, { tenantId: 2, id: 1, name: 'm3' }]).execute()
      await db.insert(Note).values([
        { tenantId: 1, memberId: 1, body: 'a' }, { tenantId: 1, memberId: 1, body: 'b' },
        { tenantId: 2, memberId: 1, body: 'c' }, { tenantId: 1, memberId: 2, body: 'd' },
      ]).execute()
      const members = await db.queryable(Member).orderBy((m) => [m.tenantId, m.id]).select((m) => ({
        name: m.name,
        count: m.notes.count(),
        notes: m.notes.orderBy((n) => n.body).toList((n) => ({ body: n.body })),
      })).toList()
      assert.deepEqual(members.map((m) => [m.name, m.count, m.notes.map((n) => n.body)]), [['m1', 2, ['a', 'b']], ['m2', 1, ['d']], ['m3', 1, ['c']]])
      // 多对一也按整组列连接
      const owners = await db.queryable(Note).orderBy((n) => n.body).select((n) => ({ body: n.body, owner: n.member.name })).toList()
      assert.deepEqual(owners.map((o) => [o.body, o.owner]), [['a', 'm1'], ['b', 'm1'], ['c', 'm3'], ['d', 'm2']])
      assert.equal(await db.queryable(Member).where((m) => m.notes.any((n) => n.body.eq('c'))).count(), 1)
    })
  })

  describe(`${name}: streaming, cancellation and transactions`, () => {
    it('streams rows in batches without loading everything first', async () => {
      const { db } = await seeded()
      await db.insert(Post).values(Array.from({ length: 1200 }, (_, i) => ({ userId: 1, title: `bulk ${i}`, amount: '1.00' as const }))).execute()
      let count = 0
      let batches = 0
      for await (const row of db.queryable(Post).orderBy((p) => p.id).stream({ batchSize: 500 })) {
        count += 1
        if (row.id % 500 === 0) batches += 1
      }
      assert.equal(count, 1204)
      assert.ok(batches >= 2)
      // 读到第一行就放弃：连接要还回去，之后的查询照常
      for await (const row of db.queryable(Post).orderBy((p) => p.id).stream()) {
        assert.equal(row.title, 'orm tips')
        break
      }
      assert.equal(await db.queryable(Post).count(), 1204)
      await assert.rejects(async () => { for await (const _ of db.queryable(User).select((u) => ({ posts: u.posts.toList() })).stream()) void _ }, /toList()/)
    })

    it('streams inside a transaction and reports the streamed rows to onExecute', async () => {
      const env = await seeded()
      const events: ExecutionEvent[] = []
      const db = createDb({ schema, adapter: env.adapter, onExecute: (e) => events.push(e) })
      await db.transaction(async (tx) => {
        await tx.insert(Comment).values({ postId: 1, body: 'inside' }).execute()
        const bodies: string[] = []
        for await (const c of tx.queryable(Comment).orderBy((c) => c.id).stream({ batchSize: 2 })) bodies.push(c.body)
        assert.deepEqual(bodies, ['nice', 'thanks', 'inside'])
      })
      assert.ok(events.some((e) => e.kind === 'query' && e.rows === 3 && e.error === undefined))
    })

    it('rolls back only the savepoint when a nested transaction fails', async () => {
      const { db } = await seeded()
      const titles = async () => (await db.queryable(Post).where((p) => p.title.startsWith('tx-')).orderBy((p) => p.title).toList()).map((p) => p.title)
      const add = (tx: typeof db, title: string) => tx.insert(Post).values({ userId: 1, title, amount: '1.00' }).execute()
      await db.transaction(async (tx) => {
        await add(tx, 'tx-a')
        await assert.rejects(() => tx.transaction(async (inner) => { await add(inner, 'tx-b'); throw new Error('boom') }), /boom/)
        await tx.transaction(async (inner) => { await add(inner, 'tx-c') })
      })
      assert.deepEqual(await titles(), ['tx-a', 'tx-c'])
      // 外层回滚时，成功的嵌套事务也一起回滚
      await assert.rejects(() => db.transaction(async (tx) => {
        await tx.transaction(async (inner) => { await add(inner, 'tx-d') })
        throw new Error('outer')
      }), /outer/)
      assert.deepEqual(await titles(), ['tx-a', 'tx-c'])
      await assert.rejects(() => db.transaction(async (tx) => { await tx.transaction(async () => undefined, { isolation: 'serializable' }) }), /nested transaction/)
    })

    it('begins a transaction manually and rolls back unless committed', async () => {
      const { db } = await seeded()
      const count = () => db.queryable(Post).where((p) => p.title.startsWith('manual-')).count()
      const add = (tx: typeof db, title: string) => tx.insert(Post).values({ userId: 1, title, amount: '1.00' }).execute()
      {
        await using tx = await db.begin()
        await add(tx, 'manual-1')
        await tx.commit()
      }
      assert.equal(await count(), 1)
      {
        // 没提交就离开作用域：自动回滚
        await using tx = await db.begin()
        await add(tx, 'manual-2')
      }
      assert.equal(await count(), 1)
      const tx = await db.begin()
      await add(tx, 'manual-3')
      await tx.rollback()
      await tx.rollback() // 已结束再回滚什么也不做
      await assert.rejects(() => tx.commit(), /already finished/)
      assert.equal(await count(), 1)
    })

    it('rejects writes in a read-only transaction', { skip: options.readOnlyTransactions === false }, async () => {
      const { db } = await seeded()
      assert.equal(await db.transaction((tx) => tx.queryable(Post).count(), { readOnly: true }), 4)
      await assert.rejects(() => db.transaction((tx) => tx.insert(Post).values({ userId: 1, title: 'ro', amount: '1.00' }).execute(), { readOnly: true }))
      // 事务结束后连接恢复可写（SQLite 的 query_only 要被还原）
      await db.insert(Post).values({ userId: 1, title: 'rw', amount: '1.00' }).execute()
      assert.equal(await db.queryable(Post).count(), 5)
    })

    it('stops waiting when the signal is aborted', async () => {
      const { db } = await seeded()
      await assert.rejects(() => db.withSignal(AbortSignal.abort(new Error('cancelled'))).queryable(User).toList(), /cancelled/)
      // 没取消的信号不影响结果
      assert.equal((await db.withSignal(new AbortController().signal).queryable(User).toList()).length, 3)
      await assert.rejects(async () => { for await (const _ of db.withSignal(AbortSignal.abort()).queryable(User).stream()) void _ })
    })
  })

  describe(`${name}: views`, () => {
    it('reuses and nests projections', async () => {
      const { db } = await seeded()
      const PostCard = defineView(schema, Post, (p) => ({ title: p.title, owner: p.user.name }))
      const UserCard = defineView(schema, User, (u) => ({
        name: u.name,
        company: u.company.name,
        posts: u.posts.orderBy((p) => p.id).limit(1).toList(PostCard),
      }))
      const rows = await db.queryable(User).orderBy((u) => u.id).select(UserCard).toList()
      assert.deepEqual(rows, [
        { name: 'alice', company: 'acme', posts: [{ title: 'orm tips', owner: 'alice' }] },
        { name: 'bob', company: 'acme', posts: [{ title: 'orm_v2', owner: 'bob' }] },
        { name: 'carol', company: null, posts: [] },
      ])
      // 视图也能在别的 select 里展开，并且能和 where / join 一起用
      const cards = await db.queryable(Post).where((p) => p.id.eq(4)).select((p) => ({ ...PostCard(p), id: p.id })).toList()
      assert.deepEqual(cards, [{ title: 'hello', owner: 'bob', id: 4 }])
    })
  })

  describe(`${name}: column rules`, { skip: !options.extraTables }, () => {
    const doc = (title: string) => ({ title, createdBy: 'ann', secret: 'hello' })

    it('turns delete into an update and hides soft-deleted rows', async () => {
      const { db } = await seeded()
      await db.insert(Doc).values([doc('a'), doc('b'), doc('c')]).execute()
      assert.equal(await db.delete(Doc).where((d) => d.id.eq(1)).execute(), 1)
      assert.equal(await db.queryable(Doc).count(), 2)
      // 单条语句关掉过滤，能看到被逻辑删除的行
      const all = await db.queryable(Doc).noInterceptor('softDelete').orderBy((d) => d.id).toList()
      assert.deepEqual(all.map((d) => [d.title, d.deleted]), [['a', true], ['b', false], ['c', false]])
      // 已经删除的行读不到，再删一次什么也没做；更新也碰不到它
      assert.equal(await db.delete(Doc).where((d) => d.id.eq(1)).execute(), 0)
      assert.equal(await db.update(Doc).set({ title: 'x' }).where((d) => d.id.eq(1)).execute(), 0)
      // hard() 才是物理删除
      assert.equal(await db.delete(Doc).where((d) => d.id.eq(1)).hard().execute(), 1)
      assert.equal(await db.queryable(Doc).noInterceptor('softDelete').count(), 2)
    })

    it('fills client defaults on insert and update-time values on update', async () => {
      const { db } = await seeded()
      await db.insert(Doc).values([doc('a'), { ...doc('b'), token: 'mine' }]).execute()
      const rows = await db.queryable(Doc).orderBy((d) => d.id).toList()
      // token 没给就用 $default；status 没给，用库里的默认值 draft；deleted 插入时默认写"未删除"
      assert.deepEqual(rows.map((r) => [r.token, r.status, r.deleted, r.version, r.updatedAt]), [['tok', 'draft', false, 0, null], ['mine', 'draft', false, 0, null]])
      await db.update(Doc).set({ title: 'a2' }).where((d) => d.id.eq(1)).execute()
      assert.equal((await db.queryable(Doc).where((d) => d.id.eq(1)).single()).updatedAt?.toISOString(), '2026-05-06T07:08:09.000Z')
      const given = new Date('2030-01-01T00:00:00.000Z')
      await db.update(Doc).set({ title: 'b2', updatedAt: given }).where((d) => d.id.eq(2)).execute()
      assert.equal((await db.queryable(Doc).where((d) => d.id.eq(2)).single()).updatedAt?.toISOString(), given.toISOString())
    })

    it('validates enum values on write and read', async () => {
      const { db } = await seeded()
      await assert.rejects(() => db.insert(Doc).values({ ...doc('a'), status: 'bogus' as never }).execute(), /not one of/)
      await db.insert(Doc).values({ ...doc('a'), status: 'published' }).execute()
      assert.equal((await db.queryable(Doc).single()).status, 'published')
      // 库里被写进了不认识的值：读出时报错，而不是悄悄当成合法值
      await db.sql.execute`UPDATE ${db.sql.ident('t_doc')} SET ${db.sql.ident('status')} = ${'weird'}`
      await assert.rejects(() => db.queryable(Doc).toList(), /not one of/)
    })

    it('guards updates by version and bumps it on every update', async () => {
      const { db } = await seeded()
      await db.insert(Doc).values(doc('a')).execute()
      const stale = await db.queryable(Doc).single()
      assert.equal(stale.version, 0)
      await db.update(Doc).entity({ ...stale, title: 'first' }).execute()
      assert.equal((await db.queryable(Doc).single()).version, 1)
      // 还拿着版本 0 的旧数据去更新：条件不满足，一行也没改到，抛错
      await assert.rejects(() => db.update(Doc).entity({ ...stale, title: 'second' }).execute(), /optimistic lock/)
      assert.equal((await db.queryable(Doc).single()).title, 'first')
      // 表达式更新没有版本条件，但同样让版本加 1，别人手里的旧版本随之失效
      await db.update(Doc).set({ title: 'third' }).where((d) => d.id.eq(1)).execute()
      assert.equal((await db.queryable(Doc).single()).version, 2)
    })

    it('never updates insert-only columns', async () => {
      const { db } = await seeded()
      await db.insert(Doc).values(doc('a')).execute()
      assert.throws(() => db.update(Doc).set({ createdBy: 'bob' }).where((d) => d.id.eq(1)).toSQL(), /insert-only/)
      const row = await db.queryable(Doc).single()
      await db.update(Doc).entity({ ...row, title: 'a2', createdBy: 'bob' }).execute()
      assert.equal((await db.queryable(Doc).single()).createdBy, 'ann')
    })

    it('encrypts transparently, including in equality conditions', async () => {
      const { db } = await seeded()
      await db.insert(Doc).values(doc('a')).execute()
      const raw = await db.sql`SELECT ${db.sql.ident('secret')} FROM ${db.sql.ident('t_doc')}`
      assert.equal(Object.values(raw[0]!)[0], 'uryyb')
      assert.equal((await db.queryable(Doc).single()).secret, 'hello')
      assert.equal(await db.queryable(Doc).where((d) => d.secret.eq('hello')).count(), 1)
    })
  })

  describe(`${name}: subqueries, derived tables, unions and CTEs`, () => {
    it('uses a subquery in in(...) and as a scalar', async () => {
      const { db } = await seeded()
      const q = db.queryable(User).orderBy((u) => u.id)
      // 有帖子的用户 / 没有帖子的用户 / 有大额帖子的用户
      assert.deepEqual((await q.where((u) => u.id.in(db.queryable(Post).select((p) => p.userId))).toList()).map((u) => u.name), ['alice', 'bob'])
      assert.deepEqual((await q.where((u) => u.id.notIn(db.queryable(Post).select((p) => p.userId))).toList()).map((u) => u.name), ['carol'])
      assert.deepEqual((await q.where((u) => u.id.in(db.queryable(Post).where((p) => p.amount.gt('100')).select((p) => p.userId))).toList()).map((u) => u.name), ['alice'])
      // 标量子查询：金额高于平均值（503.6875）的帖子只有 2000.00 那篇
      const average = db.queryable(Post).groupBy(() => ({})).select((g) => g.avg((p) => p.amount))
      assert.deepEqual((await db.queryable(Post).where((p) => p.amount.gt(average)).toList()).map((p) => p.id), [2])
    })

    it('rejects subqueries that do not select exactly one column', async () => {
      const { db } = await seeded()
      await assert.rejects(() => db.queryable(User).where((u) => u.id.in(db.queryable(Post).select((p) => p.userId) as never)).where((u) => u.id.in(db.queryable(Post) as never)).toList(), /exactly one column/)
    })

    it('filters on window results through a derived table (QUALIFY)', async () => {
      const { db } = await seeded()
      const top = db.queryable(Post).select((p) => ({ id: p.id, userId: p.userId, rn: win.rowNumber((w) => w.partitionBy(p.userId).orderBy(p.amount.desc())) })).asTable()
      // 每个用户金额最高的一篇：alice 的 2000.00（id 2）、bob 的 3.00（id 4）
      assert.deepEqual((await top.where((t) => t.rn.eq(1)).orderBy((t) => t.id).toList()).map((t) => t.id), [2, 4])
      assert.equal(await top.where((t) => t.rn.eq(1)).count(), 2)
      assert.deepEqual((await top.orderBy((t) => t.id).toPage(2, 3)).rows.map((t) => t.id), [4])
      // 先限制再排序：派生表里的 limit 在外层 orderBy 之前生效
      const firstTwo = await db.queryable(Post).orderBy((p) => p.id).limit(2).select((p) => ({ id: p.id })).asTable().orderBy((t) => t.id.desc()).toList()
      assert.deepEqual(firstTwo.map((t) => t.id), [2, 1])
    })

    it('unions and unionAlls queries, aligning columns by name', async () => {
      const { db } = await seeded()
      const adults = db.queryable(User).where((u) => u.age.gt(20)).select((u) => ({ name: u.name, age: u.age }))
      const minors = db.queryable(User).where((u) => u.age.lt(20)).select((u) => ({ age: u.age, name: u.name }))
      const both = adults.union(minors)
      assert.deepEqual((await both.orderBy((r) => r.name.asc()).toList()).map((r) => [r.name, r.age]), [['alice', 30], ['carol', 17]])
      assert.equal(await both.count(), 2)
      // UNION 去重，UNION ALL 保留重复
      assert.equal(await adults.union(adults).count(), 1)
      assert.equal(await adults.unionAll(adults).count(), 2)
      // 三个查询接着并（alice、carol、alice），排序后跳过第一行再取两行
      const three = adults.unionAll(minors).unionAll(adults)
      assert.deepEqual((await three.orderBy((r) => r.name.asc()).limit(2).offset(1).toList()).map((r) => r.name), ['alice', 'carol'])
    })

    it('rejects unions whose members differ in columns or carry ordering', async () => {
      const { db } = await seeded()
      const names = db.queryable(User).select((u) => ({ name: u.name }))
      await assert.rejects(async () => names.union(db.queryable(User).select((u) => ({ id: u.id })) as never).toList(), /same columns/)
      await assert.rejects(async () => db.queryable(User).orderBy((u) => u.id).select((u) => ({ name: u.name })).union(names).toList(), /asTable/)
    })

    it('registers CTEs and joins them with real entities, chaining one on another', async () => {
      const { db } = await seeded()
      const adb = db.with('big', db.queryable(Post).where((p) => p.amount.gt('1')).select((p) => ({ userId: p.userId, amount: p.amount })))
      // 第二个 CTE 建立在第一个之上；WITH 里按依赖顺序排好，参数也按出现顺序绑定
      const bdb = adb.with('totals', adb.queryable(adb.entity('big')).groupBy((b) => ({ userId: b.userId })).select((g) => ({ userId: g.key.userId, total: g.sum((b) => b.amount) })))
      const rows = await bdb.queryable(User)
        .innerJoin(bdb.entity('totals'), (u, t) => t.userId.eq(u.id))
        .where((u) => u.name.ne('nobody'))
        .orderBy((u) => u.id)
        .select((u, t) => ({ name: u.name, total: t.total }))
        .toList()
      assert.deepEqual(rows.map((r) => [r.name, Number(r.total)]), [['alice', 2010.5], ['bob', 4.25]])
      assert.match(bdb.queryable(bdb.entity('totals')).toSQL().sql, /^WITH .*big.*totals/)
    })

    it('runs recursive CTEs', { skip: options.recursiveCte === false }, async () => {
      const { db } = await seeded()
      // 1 到 5 的序列：锚点是 id = 1 的公司，递归部分每次加 1，到 5 为止
      const rdb = db.withRecursive('seq',
        db.queryable(Company).where((c) => c.id.eq(1)).select((c) => ({ n: c.id })),
        (r, self) => r.queryable(self).where((s) => s.n.lt(5)).select((s) => ({ n: s.n.plus(1) })))
      assert.deepEqual((await rdb.queryable(rdb.entity('seq')).orderBy((s) => s.n).toList()).map((s) => s.n), [1, 2, 3, 4, 5])
      // 递归结果还能和真实实体 join
      const joined = await rdb.queryable(Company).innerJoin(rdb.entity('seq'), (c, s) => s.n.eq(c.id)).select((c) => ({ name: c.name })).toList()
      assert.deepEqual(joined.map((j) => j.name), ['acme', 'globex'])
    })
  })

  describe(`${name}: explicit joins`, () => {
    it('inner joins two tables and selects from both', async () => {
      const { db } = await seeded()
      // carol 没有帖子，内连接里不出现
      const rows = await db.queryable(User).innerJoin(Post, (u, p) => p.userId.eq(u.id))
        .orderBy((_u, p) => p.id)
        .select((u, p) => ({ name: u.name, title: p.title }))
        .toList()
      assert.deepEqual(rows.map((r) => [r.name, r.title]), [['alice', 'orm tips'], ['alice', 'sql 100%'], ['bob', 'orm_v2'], ['bob', 'hello']])
    })

    it('left joins and keeps rows without a match', async () => {
      const { db } = await seeded()
      const rows = await db.queryable(User).leftJoin(Post, (u, p) => p.userId.eq(u.id))
        .orderBy((u, p) => [u.id, p.id])
        .select((u, p) => ({ name: u.name, title: p.title }))
        .toList()
      assert.equal(rows.length, 5)
      assert.deepEqual(rows.at(-1), { name: 'carol', title: null })
    })

    it('returns whole rows grouped by entity name when nothing is selected', async () => {
      const { db } = await seeded()
      const rows = await db.queryable(User).leftJoin(Post, (u, p) => p.userId.eq(u.id)).orderBy((u, p) => [u.id, p.id]).toList()
      assert.equal(rows[0]!.User.name, 'alice')
      assert.equal(rows[0]!.Post?.title, 'orm tips')
      // left join 没匹配上时整行是 null，而不是一行全是 null 的对象
      assert.equal(rows.at(-1)!.User.name, 'carol')
      assert.equal(rows.at(-1)!.Post, null)
    })

    it('joins three tables, filters on joined tables and pages', async () => {
      const { db } = await seeded()
      const q = db.queryable(User)
        .innerJoin(Post, (u, p) => p.userId.eq(u.id))
        .innerJoin(Comment, (_u, p, c) => c.postId.eq(p.id))
        .where((u, _p, c) => [u.name.eq('alice'), c.body.like('n')])
        .orderBy((_u, _p, c) => c.id)
      // 'nice' 与 'thanks' 都含 n，都挂在 alice 的第 1 篇帖子上
      assert.deepEqual((await q.select((_u, p, c) => ({ title: p.title, body: c.body })).toList()).map((r) => r.body), ['nice', 'thanks'])
      assert.equal(await q.count(), 2)
      assert.equal((await q.select((u) => ({ id: u.id })).toPage(1, 1)).total, 2)
    })

    it('uses navigations of a joined table', async () => {
      const { db } = await seeded()
      // p.user 是 Post 上的多对一导航，隐式 join 排在显式 join 之后
      const rows = await db.queryable(User).innerJoin(Post, (u, p) => p.userId.eq(u.id))
        .where((_u, p) => p.user.name.eq('bob'))
        .select((_u, p) => ({ title: p.title, owner: p.user.name }))
        .toList()
      assert.deepEqual(rows.map((r) => r.owner), ['bob', 'bob'])
    })

    it('groups and aggregates across joined tables', async () => {
      const { db } = await seeded()
      const rows = await db.queryable(User).innerJoin(Post, (u, p) => p.userId.eq(u.id))
        .groupBy((u) => ({ name: u.name }))
        .orderBy((g) => g.key.name.asc())
        .select((g) => ({ name: g.key.name, posts: g.count(), total: g.sum((_u, p) => p.amount) }))
        .toList()
      assert.deepEqual(rows.map((r) => [r.name, r.posts, Number(r.total)]), [['alice', 2, 2010.5], ['bob', 2, 4.25]])
      assert.equal(Number(await db.queryable(User).innerJoin(Post, (u, p) => p.userId.eq(u.id)).where((u) => u.name.eq('bob')).sum((_u, p) => p.amount)), 4.25)
    })

    it('joins the same entity twice only when columns are named by select', async () => {
      const { db } = await seeded()
      // 自连接：同公司的不同用户配对
      const pairs = await db.queryable(User).innerJoin(User, (a, b) => [b.companyId.eq(a.companyId), b.id.ne(a.id)])
        .orderBy((a, b) => [a.id, b.id])
        .select((a, b) => ({ a: a.name, b: b.name }))
        .toList()
      assert.deepEqual(pairs, [{ a: 'alice', b: 'bob' }, { a: 'bob', b: 'alice' }])
      await assert.rejects(() => db.queryable(User).innerJoin(User, (a, b) => b.id.eq(a.id)).toList(), /more than once/)
    })

    it('rejects joins after select and joins without a condition', async () => {
      const { db } = await seeded()
      assert.throws(() => db.queryable(User).select((u) => ({ id: u.id })).innerJoin(Post, (u, p) => p.userId.eq(u.id)), /before select/)
      await assert.rejects(() => db.queryable(User).innerJoin(Post, () => undefined).toList(), /ON condition/)
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
