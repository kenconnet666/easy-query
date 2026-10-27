import { DatabaseSync } from 'node:sqlite'
import { createDb, type Statement } from '@eqts/core'
import { schema, type TestEnv } from '../../core/test/fixture.ts'
import { sqlite } from '../src/index.ts'

const DDL = `
CREATE TABLE t_company (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
CREATE TABLE t_user (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, age INTEGER, company_id INTEGER,
  attrs TEXT NOT NULL DEFAULT '{"tags":[]}', created_at TEXT NOT NULL);
CREATE TABLE t_post (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL);
CREATE TABLE t_comment (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, body TEXT NOT NULL);
`

/** 建好表的内存库 */
export async function memoryDb(): Promise<TestEnv> {
  const database = new DatabaseSync(':memory:')
  database.exec(DDL)
  const statements: Statement[] = []
  return { db: createDb({ schema, adapter: sqlite(database), log: (s) => statements.push(s) }), statements }
}
