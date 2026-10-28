/**
 * 在实库上跑共用套件。EQTS_PG_URLS 为逗号分隔的连接串，未设置时跳过：
 *   EQTS_PG_URLS=postgres://postgres:postgres@127.0.0.1:54321/easy-query-test pnpm test
 * 表建在 eqts 模式里（search_path），每个用例重建。
 */
import { after, describe, it } from 'node:test'
import pg from 'pg'
import assert from 'node:assert/strict'
import { createDb, sql, type Statement } from '@eqts/core'
import { Post, schema, seed, User, type TestEnv } from '@eqts/test/fixture'
import { liveSuite } from '@eqts/test/suite'
import { Pg, postgres } from '../src/index.ts'

const DDL = [
  'CREATE SCHEMA IF NOT EXISTS eqts',
  'DROP TABLE IF EXISTS t_doc, t_note, t_member, t_user_role, t_role, t_ext, t_comment, t_post, t_user, t_company',
  'CREATE TABLE t_company (id BIGSERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL)',
  'CREATE TABLE t_user (id BIGSERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, age INT, company_id BIGINT, attrs JSONB NOT NULL, created_at TIMESTAMP(3) NOT NULL)',
  'CREATE TABLE t_post (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL, title VARCHAR(200) NOT NULL, amount NUMERIC(12,2) NOT NULL)',
  'CREATE TABLE t_comment (id BIGSERIAL PRIMARY KEY, post_id BIGINT NOT NULL, body VARCHAR(200) NOT NULL)',
  // t_ext：@eqts/decimal、@eqts/date 与 64 位整数的往返
  'CREATE TABLE t_ext (id BIGSERIAL PRIMARY KEY, amount NUMERIC(12,2) NOT NULL, big BIGINT NOT NULL, day DATE NOT NULL, starts_at TIMESTAMP(3) NOT NULL, at TIMESTAMP(3) NOT NULL, clock TIME NOT NULL, raw BYTEA NOT NULL)',
  // 多对多与复合外键
  'CREATE TABLE t_role (id BIGSERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL)',
  'CREATE TABLE t_user_role (user_id BIGINT NOT NULL, role_id BIGINT NOT NULL, PRIMARY KEY (user_id, role_id))',
  'CREATE TABLE t_member (tenant_id INT NOT NULL, id INT NOT NULL, name VARCHAR(100) NOT NULL, PRIMARY KEY (tenant_id, id))',
  'CREATE TABLE t_note (id BIGSERIAL PRIMARY KEY, tenant_id INT NOT NULL, member_id INT NOT NULL, body VARCHAR(200) NOT NULL)',
  // 列修饰器
  `CREATE TABLE t_doc (id BIGSERIAL PRIMARY KEY, title VARCHAR(100) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'draft', deleted BOOLEAN NOT NULL, version INT NOT NULL, created_by VARCHAR(100) NOT NULL, token VARCHAR(100) NOT NULL, updated_at TIMESTAMP(3) NULL, secret VARCHAR(100) NOT NULL)`,
]

const urls = (process.env['EQTS_PG_URLS'] ?? '').split(',').map((u) => u.trim()).filter(Boolean)

if (urls.length === 0) {
  describe('postgres (live)', () => {
    it('skipped: set EQTS_PG_URLS to run', { skip: true }, () => {})
  })
}

for (const url of urls) {
  const pool = new pg.Pool({ connectionString: url, max: 5, options: '-c search_path=eqts' })
  after(async () => { await pool.end() })

  const open = async (): Promise<TestEnv> => {
    for (const statement of DDL) await pool.query(statement)
    const statements: Statement[] = []
    const adapter = postgres(pool)
    return { db: createDb({ schema, adapter, log: (s) => statements.push(s) }), statements, adapter }
  }

  liveSuite(`postgres ${new URL(url).port}`, open, { extensionTypes: true, extraTables: true })

  describe(`postgres ${new URL(url).port}: Pg.* functions`, () => {
    it('jsonb, arrays and full-text search', async () => {
      const { db } = await seed(await open())
      assert.equal(await db.queryable(User).where((u) => Pg.jsonb(u.attrs).contains('{"tags":["vip"]}')).count(), 1)
      assert.equal(await db.queryable(User).where((u) => Pg.jsonb(u.attrs).hasKey('tags')).count(), 3)
      const tags = sql<string[]>`ARRAY['a', 'b']`
      assert.equal(await db.queryable(User).where(() => [Pg.array(tags).hasAll('a', 'b'), Pg.array(tags).length().eq(2)]).count(), 3)
      assert.equal(await db.queryable(User).where(() => Pg.array(tags).hasAny('z')).count(), 0)
      const hits = await db.queryable(Post).where((p) => Pg.fulltext(p.title).matches('tips')).select((p) => ({ title: p.title, rank: Pg.fulltext(p.title).rank('tips') })).toList()
      assert.deepEqual(hits.map((h) => h.title), ['orm tips'])
      assert.ok(hits[0]!.rank > 0)
    })
  })
}
