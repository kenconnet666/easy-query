/**
 * 在实库上跑共用套件。EQTS_MYSQL_URLS 为逗号分隔的连接串（不带库名），未设置时跳过：
 *   EQTS_MYSQL_URLS=mysql://root:root@127.0.0.1:3318,mysql://root:root@127.0.0.1:3306 pnpm test
 * 每个用例重建 eqts_test 库里的表。
 */
import { after, describe, it } from 'node:test'
import { createPool, type Pool } from 'mysql2/promise'
import { createDb, type Statement } from '@eqts/core'
import assert from 'node:assert/strict'
import { Post, schema, seed, User, type TestEnv } from '@eqts/test/fixture'
import { liveSuite } from '@eqts/test/suite'
import { MySQL, mysql } from '../src/index.ts'

const DDL = [
  'DROP TABLE IF EXISTS t_comment, t_post, t_user, t_company',
  'CREATE TABLE t_company (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL)',
  'CREATE TABLE t_user (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, age INT, company_id BIGINT, attrs JSON NOT NULL, created_at DATETIME(3) NOT NULL)',
  'CREATE TABLE t_post (id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL, title VARCHAR(200) NOT NULL, amount DECIMAL(12,2) NOT NULL, FULLTEXT KEY ft_title (title))',
  'CREATE TABLE t_comment (id BIGINT AUTO_INCREMENT PRIMARY KEY, post_id BIGINT NOT NULL, body VARCHAR(200) NOT NULL)',
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

  liveSuite(`mysql ${new URL(url).port}`, open)

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
