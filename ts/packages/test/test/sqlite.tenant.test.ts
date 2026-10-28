import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { col, createDb, defineSchema, entity, tenant } from '@eqts/core'
import { sqlite } from '@eqts/sqlite'

const Order = entity('t_order', { id: col.bigint().primaryKey().generated(), tenantId: col.int(), customerId: col.int() })
const Customer = entity('t_customer', { id: col.int().primaryKey(), tenantId: col.int(), name: col.string() })
const schema = defineSchema({ Order, Customer }, {
  Order: (r) => ({ customer: r.one('Customer', { from: 'customerId', to: 'id' }) }),
  Customer: (r) => ({ orders: r.many('Order', { from: 'id', to: 'customerId' }) }),
})

describe('sqlite: tenant()', () => {
  let current = 7
  const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')), interceptors: [tenant('tenantId', () => current)] })

  it('filters the root, joins and subqueries with the current tenant', () => {
    const s = db.queryable(Customer).where((c) => c.orders.any((o) => o.customer.name.eq('x'))).select((c) => ({ id: c.id })).toSQL()
    assert.equal(s.sql, 'SELECT t0."id" AS "c0" FROM "t_customer" t0 WHERE EXISTS (SELECT 1 FROM "t_order" t1'
      + ' LEFT JOIN "t_customer" t2 ON t2."id" = t1."customer_id" AND t2."tenant_id" = ?'
      + ' WHERE t1."customer_id" = t0."id" AND t1."tenant_id" = ? AND t2."name" = ?) AND t0."tenant_id" = ?')
    assert.deepEqual(s.params, [7, 7, 'x', 7])
  })

  it('evaluates the tenant per statement and fills it on insert', () => {
    current = 8
    assert.deepEqual(db.insert(Order).values({ customerId: 1 } as never).toSQL()[0]!.params, [8, 1])
    assert.deepEqual(db.delete(Order).where((o) => o.id.eq(1)).toSQL().params, [1, 8])
  })

  it('still refuses writes whose only condition is the tenant', () => {
    assert.throws(() => db.delete(Order).toSQL(), /all\(\)/)
  })
})
