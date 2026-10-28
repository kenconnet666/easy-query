import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { col, defineSchema, entity } from '@eqts/core'
import { User } from '../src/fixture.ts'
import { memoryDb } from '../src/sqlite-env.ts'

describe('relations: SQL text', async () => {
  const { db } = await memoryDb()

  it('renders a many-to-many any() as a subquery that joins the junction table', () => {
    const s = db.queryable(User).where((u) => u.roles.any((r) => r.name.eq('dev'))).select((u) => ({ id: u.id })).toSQL()
    assert.equal(s.sql, 'SELECT t0."id" AS "c0" FROM "t_user" t0 WHERE EXISTS (SELECT 1 FROM "t_role" t1'
      + ' INNER JOIN "t_user_role" t2 ON t2."role_id" = t1."id" WHERE t2."user_id" = t0."id" AND t1."name" = ?)')
  })
})

describe('relations: definition checks', () => {
  const A = entity('t_a', { x: col.int().primaryKey(), y: col.int(), z: col.int().nullable() })
  const B = entity('t_b', { x: col.int().primaryKey(), y: col.int() })
  const NoKey = entity('t_nokey', { v: col.int() })

  it('rejects composite foreign keys whose column counts differ', () => {
    // 类型上两边都是"列名或列名数组"，个数对不上要到定义时才能发现
    assert.throws(() => defineSchema({ A, B }, { A: (r) => ({ b: r.one('B', { from: ['x', 'y'], to: ['x'] }) }) }), /must match/)
  })

  it('rejects unknown columns in any position of a composite key', () => {
    assert.throws(() => defineSchema({ A, B }, { A: (r) => ({ b: r.one('B', { from: ['x', 'y'], to: ['x', 'nope' as 'y'] }) }) }), /B has no column 'nope'/)
  })

  it('needs a primary key when many-to-many leaves from / to out', () => {
    const Link = entity('t_link', { aId: col.int(), noId: col.int() })
    assert.throws(() => defineSchema({ A, NoKey, Link }, {
      A: (r) => ({ others: r.manyToMany('NoKey', { through: 'Link', throughFrom: 'aId', throughTo: 'noId' }) }),
    }), /needs from \/ to or a primary key/)
  })

  it('makes the target nullable when any column of a composite key is nullable', () => {
    const schema = defineSchema({ A, B }, { A: (r) => ({ b: r.one('B', { from: ['x', 'z'], to: ['x', 'y'] }) }) })
    assert.equal(schema.relations.A.b.nullable, true)
  })
})
