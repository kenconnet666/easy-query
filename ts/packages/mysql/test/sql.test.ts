import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Pool } from 'mysql2/promise'
import { createDb } from '@eqts/core'
import { schema, User } from '../../core/test/fixture.ts'
import { mysql } from '../src/index.ts'

describe('mysql: SQL text', () => {
  // 只渲染不执行，不需要真的连接池
  const db = createDb({ schema, adapter: mysql({} as Pool) })

  it('quotes with backticks and relies on the default LIKE escape', () => {
    const s = db.queryable(User).where((u) => [u.name.startsWith('a_'), u.company.name.eq('acme')]).select((u) => ({ id: u.id })).toSQL()
    assert.equal(s.sql, 'SELECT t0.`id` AS `c0` FROM `t_user` t0 LEFT JOIN `t_company` t1 ON t1.`id` = t0.`company_id` WHERE t0.`name` LIKE ? AND t1.`name` = ?')
    assert.deepEqual(s.params, [String.raw`a\_%`, 'acme'])
  })

  it('adds a LIMIT when only an offset is given', () => {
    assert.match(db.queryable(User).offset(5).toSQL().sql, / LIMIT 18446744073709551615 OFFSET 5$/)
  })

  it('locks rows for update', () => {
    assert.match(db.queryable(User).where((u) => u.id.eq(1)).forUpdate().toSQL().sql, / FOR UPDATE$/)
  })

  it('renders deletes with a table alias (MySQL 8.0.16+)', () => {
    assert.equal(db.delete(User).where((u) => u.id.eq(1)).toSQL().sql, 'DELETE FROM `t_user` AS t0 WHERE t0.`id` = ?')
  })
})
