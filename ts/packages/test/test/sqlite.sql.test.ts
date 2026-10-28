import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { or, sql } from '@eqts/core'
import { Post, User } from '../src/fixture.ts'
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
})
