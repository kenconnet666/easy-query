import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { or, sql } from '@eqts/core'
import { Comment, Gadget, Post, User } from '../src/fixture.ts'
import { memoryDb } from '../src/sqlite-env.ts'

describe('sqlite: SQL text', async () => {
  const { db } = await memoryDb()

  it('renders conditions, skipping falsy entries', () => {
    const age: number | undefined = undefined
    const s = db.queryable(User)
      .where((u) => [u.name.like('a_b'), age !== undefined && u.age.ge(age), or(u.age.isNull(), u.age.lt(18))])
      .orderBy((u) => [u.createdAt.desc(), u.id])
      .limit(10).offset(20)
      .toSQL()
    assert.equal(s.sql, 'SELECT t0."id" AS "c0", t0."name" AS "c1", t0."age" AS "c2", t0."company_id" AS "c3", t0."attrs" AS "c4", t0."created_at" AS "c5"'
      + String.raw` FROM "t_user" t0 WHERE t0."name" LIKE ? ESCAPE '\' AND (t0."age" IS NULL OR t0."age" < ?)`
      + ' ORDER BY t0."created_at" DESC, t0."id" ASC LIMIT 10 OFFSET 20')
    assert.deepEqual(s.params, [String.raw`%a\_b%`, 18])
  })

  it('joins a many-to-one navigation once and renders many-navigations as correlated subqueries', () => {
    const s = db.queryable(User)
      .where((u) => [u.company.name.eq('acme'), u.posts.any((p) => p.title.startsWith('orm'))])
      .select((u) => ({ id: u.id, company: u.company.name, posts: u.posts.count() }))
      .toSQL()
    assert.equal(s.sql, 'SELECT t0."id" AS "c0", t1."name" AS "c1", (SELECT COUNT(*) AS "v" FROM "t_post" t3 WHERE t3."user_id" = t0."id") AS "c2"'
      + ' FROM "t_user" t0 LEFT JOIN "t_company" t1 ON t1."id" = t0."company_id"'
      + String.raw` WHERE t1."name" = ? AND EXISTS (SELECT 1 FROM "t_post" t2 WHERE t2."user_id" = t0."id" AND t2."title" LIKE ? ESCAPE '\')`)
    assert.deepEqual(s.params, ['acme', 'orm%'])
  })

  it('encodes parameters with the column codec', () => {
    const s = db.queryable(User).where((u) => u.createdAt.ge(new Date('2026-01-01T00:00:00Z'))).toSQL()
    assert.deepEqual(s.params, ['2026-01-01 00:00:00.000'])
  })

  it('renders raw fragments with bound parameters', () => {
    const s = db.queryable(User).where((u) => sql<boolean>`instr(${u.name}, ${'li'}) > 0`).select((u) => ({ id: u.id })).toSQL()
    assert.equal(s.sql, 'SELECT t0."id" AS "c0" FROM "t_user" t0 WHERE instr(t0."name", ?) > 0')
    assert.deepEqual(s.params, ['li'])
  })

  it('treats empty in-lists as constant conditions', () => {
    assert.match(db.queryable(User).where((u) => u.id.in([])).toSQL().sql, /WHERE 1 = 0$/)
    assert.match(db.queryable(User).where((u) => u.id.notIn([])).toSQL().sql, /WHERE 1 = 1$/)
  })

  it('rejects comparing with null', () => {
    assert.throws(() => db.queryable(User).where((u) => u.age.eq(null as never)).toSQL(), /isNull/)
  })

  it('inserts rows grouped by the columns they set', () => {
    const t = new Date(0)
    const statements = db.insert(User).values([
      { name: 'a', createdAt: t },
      { name: 'b', age: 1, createdAt: t },
      { name: 'c', createdAt: t },
    ]).toSQL()
    assert.deepEqual(statements.map((s) => s.sql), [
      'INSERT INTO "t_user" ("name", "created_at") VALUES (?, ?), (?, ?)',
      'INSERT INTO "t_user" ("name", "age", "created_at") VALUES (?, ?, ?)',
    ])
  })

  it('renders updates with expressions', () => {
    const s = db.update(User).set((u) => ({ age: u.age.plus(1), name: 'x' })).where((u) => u.name.eq('alice')).toSQL()
    assert.equal(s.sql, 'UPDATE "t_user" AS t0 SET "age" = t0."age" + ?, "name" = ? WHERE t0."name" = ?')
  })

  it('refuses unconditional writes unless all() is called', () => {
    const id: number | undefined = undefined
    assert.throws(() => db.delete(Post).where((p) => id !== undefined && p.id.eq(id)).toSQL(), /all\(\)/)
    assert.throws(() => db.update(Post).set({ title: 'x' }).toSQL(), /all\(\)/)
  })

  it('rejects joins in writes', () => {
    assert.throws(() => db.delete(User).where((u) => u.company.name.eq('acme')).toSQL(), /JOIN/)
  })

  it('renders explicit joins in call order with their ON conditions', () => {
    const s = db.queryable(User)
      .innerJoin(Post, (u, p) => p.userId.eq(u.id))
      .leftJoin(Comment, (_u, p, c) => c.postId.eq(p.id))
      .select((u, p, c) => ({ name: u.name, title: p.title, body: c.body }))
      .toSQL()
    assert.equal(s.sql, 'SELECT t0."name" AS "c0", t1."title" AS "c1", t2."body" AS "c2" FROM "t_user" t0'
      + ' INNER JOIN "t_post" t1 ON t1."user_id" = t0."id" LEFT JOIN "t_comment" t2 ON t2."post_id" = t1."id"')
  })

  it('splits big inserts into statements that stay below the bind-parameter limit', () => {
    const t = new Date(0)
    // 每行 2 个参数：SQLite 上限 32766，每条语句最多装 16383 行，所以 40000 行是 3 条
    const statements = db.insert(User).values(Array.from({ length: 40000 }, (_, i) => ({ name: `u${i}`, createdAt: t }))).toSQL()
    assert.deepEqual(statements.map((s) => s.params.length), [32766, 32766, 14468])
  })

  it('reports an over-long in-list before it reaches the database', () => {
    const ids = Array.from({ length: 40000 }, (_, i) => i)
    assert.throws(() => db.queryable(User).where((u) => u.id.in(ids)).toSQL(), /more than 32766 parameters/)
  })

  it('drops ordering when aggregating the whole query', async () => {
    // 排序对聚合没有意义，PG 还会因为"ORDER BY 列不在聚合里"报错，所以执行的语句里不带
    const { db, statements } = await memoryDb()
    await db.queryable(Post).orderBy((p) => p.id).sum((p) => p.amount)
    assert.equal(statements[0]!.sql, 'SELECT SUM(t0."amount") AS "c0" FROM "t_post" t0')
  })
})

describe('sqlite: native SQL', async () => {
  const { db, statements } = await memoryDb()

  it('binds values, expands arrays and quotes identifiers', async () => {
    await db.sql`SELECT ${1} FROM ${db.sql.ident('t_user')} WHERE name IN (${['a', 'b']}) AND age > ${null}`
    assert.deepEqual(statements.at(-1), { sql: 'SELECT ? FROM "t_user" WHERE name IN (?, ?) AND age > ?', params: [1, 'a', 'b', null] })
  })

  it('encodes dates and booleans like the builders do', async () => {
    await db.sql`SELECT ${new Date('2026-01-02T03:04:05.006Z')}, ${true}`
    assert.deepEqual(statements.at(-1)!.params, ['2026-01-02 03:04:05.006', 1])
  })
})

describe('sqlite: code-first DDL', async () => {
  const { db } = await memoryDb()

  it('renders CREATE TABLE from the entity definition', () => {
    // 自增主键写在列上；日期时间是 TEXT、布尔是 INTEGER；DEFAULT 原样写入；唯一约束放在最后
    assert.equal(db.createTableSql(Gadget), 'CREATE TABLE IF NOT EXISTS "t_gadget" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL, "price" NUMERIC NOT NULL,'
      + ' "qty" INTEGER NOT NULL DEFAULT 0, "active" INTEGER NOT NULL, "born" TEXT, "seen_at" TEXT NOT NULL, "tags" TEXT NOT NULL, "photo" BLOB, UNIQUE ("name"))')
  })

  it('refuses to create derived tables', () => {
    const cte = db.with('recent', db.queryable(Post).select((p) => ({ id: p.id })))
    assert.throws(() => cte.createTableSql(cte.entity('recent')), /derived/)
  })
})

