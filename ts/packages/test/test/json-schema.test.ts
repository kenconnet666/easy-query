import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { col, createDb, defineSchema, entity, type StandardSchema } from '@eqts/core'
import { sqlite } from '@eqts/sqlite'
import { z } from 'zod'

// zod 实现了 Standard Schema：直接传进 col.json，类型从校验器推导
const Profile = z.object({ tags: z.array(z.string()), level: z.number().int().min(0) })
const Account = entity('t_account', { id: col.bigint().primaryKey().generated(), profile: col.json(Profile) })

describe('json columns with a Standard Schema', () => {
  const database = new DatabaseSync(':memory:')
  database.exec('CREATE TABLE t_account (id INTEGER PRIMARY KEY AUTOINCREMENT, profile TEXT NOT NULL)')
  const db = createDb({ schema: defineSchema({ Account }), adapter: sqlite(database) })

  it('round-trips a valid value and infers its type from the schema', async () => {
    await db.insert(Account).values({ profile: { tags: ['a'], level: 2 } }).execute()
    const row = await db.queryable(Account).single()
    const level: number = row.profile.level
    assert.deepEqual([row.profile.tags, level], [['a'], 2])
  })

  it('rejects an invalid value on write, naming the failing path', async () => {
    await assert.rejects(() => db.insert(Account).values({ profile: { tags: ['a'], level: -1 } }).execute(), /write: invalid JSON value: level/)
  })

  it('rejects a stored value that no longer matches the schema on read', async () => {
    database.exec(`INSERT INTO t_account (profile) VALUES ('{"tags":"oops","level":1}')`)
    await assert.rejects(() => db.queryable(Account).toList(), /read: invalid JSON value: tags/)
  })

  it('works with a hand-written Standard Schema and refuses asynchronous ones', async () => {
    const positive: StandardSchema<number> = {
      '~standard': { version: 1, vendor: 'test', validate: (v) => (typeof v === 'number' && v > 0 ? { value: v } : { issues: [{ message: 'must be positive' }] }) },
    }
    const asynchronous: StandardSchema<number> = { '~standard': { version: 1, vendor: 'test', validate: async (v) => ({ value: v as number }) } }
    const Counter = entity('t_counter', { id: col.bigint().primaryKey().generated(), n: col.json(positive), m: col.json(asynchronous) })
    const counterDb = createDb({ schema: defineSchema({ Counter }), adapter: sqlite(database) })
    database.exec('CREATE TABLE t_counter (id INTEGER PRIMARY KEY AUTOINCREMENT, n TEXT NOT NULL, m TEXT NOT NULL)')
    await assert.rejects(() => counterDb.insert(Counter).values({ n: 0, m: 1 }).execute(), /must be positive/)
    await assert.rejects(() => counterDb.insert(Counter).values({ n: 1, m: 1 }).execute(), /asynchronous schemas are not supported/)
  })

  it('keeps the plain generic form without validation', async () => {
    const Loose = entity('t_loose', { id: col.bigint().primaryKey().generated(), data: col.json<{ any: number }>() })
    database.exec('CREATE TABLE t_loose (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)')
    const looseDb = createDb({ schema: defineSchema({ Loose }), adapter: sqlite(database) })
    await looseDb.insert(Loose).values({ data: { any: 1 } }).execute()
    assert.deepEqual((await looseDb.queryable(Loose).single()).data, { any: 1 })
  })
})
