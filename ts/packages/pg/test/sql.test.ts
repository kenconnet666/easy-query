import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Pool } from 'pg'
import { createDb } from '@eqts/core'
import { schema, User } from '../../core/test/fixture.ts'
import { postgres } from '../src/index.ts'

describe('postgres: SQL text', () => {
  const db = createDb({ schema, adapter: postgres({} as Pool) })

  it('numbers placeholders and keeps booleans', () => {
    const s = db.queryable(User).where((u) => [u.name.eq('a'), u.age.in([1, 2])]).select((u) => ({ id: u.id })).toSQL()
    assert.equal(s.sql, 'SELECT t0."id" AS "c0" FROM "t_user" t0 WHERE t0."name" = $1 AND t0."age" IN ($2, $3)')
    assert.equal(db.queryable(User).where((u) => u.id.eq(1)).toSQL().params.length, 1)
  })
})
