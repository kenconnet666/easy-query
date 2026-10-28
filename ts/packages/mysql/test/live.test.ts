/**
 * 在实库上跑共用套件。EQTS_MYSQL_URLS 为逗号分隔的连接串（不带库名），未设置时跳过：
 *   EQTS_MYSQL_URLS=mysql://root:root@127.0.0.1:3318,mysql://root:root@127.0.0.1:3306 pnpm test
 * 每个用例重建 eqts_test 库里的表。
 */
import { after, describe, it } from 'node:test'
import { createPool, type Pool } from 'mysql2/promise'
import { createDb, type Statement } from '@zerodep-dev/easy-query-ts'
import assert from 'node:assert/strict'
import { Post, schema, seed, User, type TestEnv } from '@zerodep-dev/easy-query-ts-test/fixture'
import { liveSuite } from '@zerodep-dev/easy-query-ts-test/suite'
import { MySQL, mysql } from '../src/index.ts'

const DDL = [
  'DROP TABLE IF EXISTS t_doc, t_note, t_member, t_user_role, t_role, t_ext, t_comment, t_post, t_user, t_company',
  'CREATE TABLE t_company (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL)',
  'CREATE TABLE t_user (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, age INT, company_id BIGINT, attrs JSON NOT NULL, created_at DATETIME(3) NOT NULL)',
  'CREATE TABLE t_post (id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL, title VARCHAR(200) NOT NULL, amount DECIMAL(12,2) NOT NULL, FULLTEXT KEY ft_title (title))',
  'CREATE TABLE t_comment (id BIGINT AUTO_INCREMENT PRIMARY KEY, post_id BIGINT NOT NULL, body VARCHAR(200) NOT NULL)',
  // t_ext：@zerodep-dev/easy-query-ts-decimal、@zerodep-dev/easy-query-ts-date 与 64 位整数的往返
  'CREATE TABLE t_ext (id BIGINT AUTO_INCREMENT PRIMARY KEY, amount DECIMAL(12,2) NOT NULL, big BIGINT NOT NULL, day DATE NOT NULL, starts_at DATETIME(3) NOT NULL, at DATETIME(3) NOT NULL, clock TIME NOT NULL, raw BLOB NOT NULL)',
  // 多对多与复合外键
  'CREATE TABLE t_role (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL)',
  'CREATE TABLE t_user_role (user_id BIGINT NOT NULL, role_id BIGINT NOT NULL, PRIMARY KEY (user_id, role_id))',
  'CREATE TABLE t_member (tenant_id INT NOT NULL, id INT NOT NULL, name VARCHAR(100) NOT NULL, PRIMARY KEY (tenant_id, id))',
  'CREATE TABLE t_note (id BIGINT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NOT NULL, member_id INT NOT NULL, body VARCHAR(200) NOT NULL)',
  // 列修饰器
  `CREATE TABLE t_doc (id BIGINT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(100) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'draft', deleted BOOLEAN NOT NULL, version INT NOT NULL, created_by VARCHAR(100) NOT NULL, token VARCHAR(100) NOT NULL, updated_at DATETIME(3) NULL, secret VARCHAR(100) NOT NULL)`,
]

const urls = (process.env['EQTS_MYSQL_URLS'] ?? '').split(',').map((u) => u.trim()).filter(Boolean)

if (urls.length === 0) {
  describe('mysql (live)', () => {
    it('skipped: set EQTS_MYSQL_URLS to run', { skip: true }, () => {})
  })
}

for (const url of urls) {
  const pools: Pool[] = []
  const pool = async (): Promise<Pool> => {
    if (pools[0]) return pools[0]
    const bootstrap = createPool({ uri: url, connectionLimit: 1 })
    await bootstrap.query('CREATE DATABASE IF NOT EXISTS eqts_test')
    await bootstrap.end()
    const p = createPool({ uri: url, database: 'eqts_test', connectionLimit: 5, timezone: 'Z' })
    pools.push(p)
    return p
  }
  after(async () => { await pools[0]?.end() })

  const open = async (): Promise<TestEnv> => {
    const p = await pool()
    for (const statement of DDL) await p.query(statement)
    const statements: Statement[] = []
    const adapter = mysql(p)
    return { db: createDb({ schema, adapter, log: (s) => statements.push(s) }), statements, adapter }
  }

  liveSuite(`mysql ${new URL(url).port}`, open, { extensionTypes: true, extraTables: true, cube: false, returning: false })

  describe(`mysql ${new URL(url).port}: MySQL.* functions`, () => {
    it('json predicates and full-text match', async () => {
      const { db } = await seed(await open())
      assert.equal(await db.queryable(User).where((u) => MySQL.json(u.attrs).contains('"vip"', '$.tags')).count(), 1)
      assert.equal(await db.queryable(User).where((u) => MySQL.json(u.attrs).hasMember('vip', '$.tags')).count(), 1)
      assert.equal(await db.queryable(User).where((u) => MySQL.json(u.attrs).containsPath('$.tags', '$.nope')).count(), 3)
      assert.equal(await db.queryable(User).where((u) => MySQL.json(u.attrs).containsAllPaths('$.tags', '$.nope')).count(), 0)
      const hits = await db.queryable(Post).where((p) => MySQL.match(p.title).against('hello')).select((p) => ({ title: p.title, score: MySQL.match(p.title).score('hello') })).toList()
      assert.equal(hits.length, 1)
      assert.ok(hits[0]!.score > 0)
    })
  })
}
