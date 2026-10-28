import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDb, type Adapter } from '@zerodep-dev/easy-query-ts'
import { User, schema } from '../src/fixture.ts'
import { memoryDb } from '../src/sqlite-env.ts'

/** 让每次查询都慢 delay 毫秒的适配器：SQLite 的查询是同步完成的，要靠它才能测"执行中被取消" */
function slow(adapter: Adapter, delay: number): Adapter {
  const wait = () => new Promise((resolve) => setTimeout(resolve, delay))
  return {
    dialect: adapter.dialect,
    driver: {
      query: async (sql, params) => { await wait(); return adapter.driver.query(sql, params) },
      execute: (sql, params) => adapter.driver.execute(sql, params),
      transaction: (work, options) => adapter.driver.transaction(work, options),
    },
  }
}

describe('cancellation', async () => {
  const env = await memoryDb()
  const db = createDb({ schema, adapter: slow(env.adapter, 300) })

  it('stops waiting as soon as the signal aborts, with the signal reason', async () => {
    const controller = new AbortController()
    const started = performance.now()
    const pending = db.withSignal(controller.signal).queryable(User).toList()
    setTimeout(() => controller.abort(new Error('too slow')), 20)
    await assert.rejects(() => pending, /too slow/)
    // 没有等到 300 毫秒的查询跑完
    assert.ok(performance.now() - started < 250)
  })

  it('supports AbortSignal.timeout', async () => {
    await assert.rejects(() => db.withSignal(AbortSignal.timeout(20)).queryable(User).toList(), (error: unknown) => error instanceof DOMException && error.name === 'TimeoutError')
  })

  it('does not disturb a query that finishes in time', async () => {
    const rows = await db.withSignal(AbortSignal.timeout(2000)).queryable(User).toList()
    assert.deepEqual(rows, [])
  })
})
