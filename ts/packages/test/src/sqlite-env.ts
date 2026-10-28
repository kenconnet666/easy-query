import { DatabaseSync } from 'node:sqlite'
import { createDb, type Statement } from '@zerodep-dev/easy-query-ts'
import { schema, type TestEnv } from './fixture.ts'
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite'

const DDL = `
CREATE TABLE t_company (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
CREATE TABLE t_user (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, age INTEGER, company_id INTEGER,
  attrs TEXT NOT NULL DEFAULT '{"tags":[]}', created_at TEXT NOT NULL);
CREATE TABLE t_post (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL);
CREATE TABLE t_comment (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, body TEXT NOT NULL);
-- 列修饰器
CREATE TABLE t_doc (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', deleted INTEGER NOT NULL, version INTEGER NOT NULL, created_by TEXT NOT NULL, token TEXT NOT NULL, updated_at TEXT, secret TEXT NOT NULL);
-- t_ext：@zerodep-dev/easy-query-ts-decimal、@zerodep-dev/easy-query-ts-date 与 64 位整数的往返
CREATE TABLE t_ext (id INTEGER PRIMARY KEY AUTOINCREMENT, amount NUMERIC(12,2) NOT NULL, big INTEGER NOT NULL, day TEXT NOT NULL, starts_at TEXT NOT NULL, at TEXT NOT NULL, clock TEXT NOT NULL, raw BLOB NOT NULL);
-- 多对多与复合外键
CREATE TABLE t_role (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
CREATE TABLE t_user_role (user_id INTEGER NOT NULL, role_id INTEGER NOT NULL, PRIMARY KEY (user_id, role_id));
CREATE TABLE t_member (tenant_id INTEGER NOT NULL, id INTEGER NOT NULL, name TEXT NOT NULL, PRIMARY KEY (tenant_id, id));
CREATE TABLE t_note (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, member_id INTEGER NOT NULL, body TEXT NOT NULL);
`

/** 建好表的内存库 */
export async function memoryDb(): Promise<TestEnv> {
  const database = new DatabaseSync(':memory:')
  database.exec(DDL)
  const statements: Statement[] = []
  // bigInts：整数列按 bigint 读出，64 位整数（雪花 id）才不丢精度
  const adapter = sqlite(database, { bigInts: true })
  return { db: createDb({ schema, adapter, log: (s) => statements.push(s) }), statements, adapter }
}
