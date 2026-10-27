// 由 tools/gen-stress.ts 生成，勿手改。T0：50 个实体、互相引用的关系、5 层导航，tsc 不报实例化过深。
import { col, createDb, defineSchema, entity, type Adapter } from '../src/index.ts'

const E0 = entity('t_e0', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E1 = entity('t_e1', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E2 = entity('t_e2', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E3 = entity('t_e3', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E4 = entity('t_e4', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E5 = entity('t_e5', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E6 = entity('t_e6', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E7 = entity('t_e7', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E8 = entity('t_e8', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E9 = entity('t_e9', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E10 = entity('t_e10', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E11 = entity('t_e11', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E12 = entity('t_e12', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E13 = entity('t_e13', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E14 = entity('t_e14', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E15 = entity('t_e15', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E16 = entity('t_e16', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E17 = entity('t_e17', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E18 = entity('t_e18', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E19 = entity('t_e19', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E20 = entity('t_e20', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E21 = entity('t_e21', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E22 = entity('t_e22', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E23 = entity('t_e23', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E24 = entity('t_e24', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E25 = entity('t_e25', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E26 = entity('t_e26', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E27 = entity('t_e27', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E28 = entity('t_e28', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E29 = entity('t_e29', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E30 = entity('t_e30', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E31 = entity('t_e31', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E32 = entity('t_e32', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E33 = entity('t_e33', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E34 = entity('t_e34', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E35 = entity('t_e35', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E36 = entity('t_e36', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E37 = entity('t_e37', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E38 = entity('t_e38', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E39 = entity('t_e39', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E40 = entity('t_e40', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E41 = entity('t_e41', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E42 = entity('t_e42', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E43 = entity('t_e43', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E44 = entity('t_e44', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E45 = entity('t_e45', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E46 = entity('t_e46', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E47 = entity('t_e47', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E48 = entity('t_e48', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })
const E49 = entity('t_e49', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })

const schema = defineSchema({ E0, E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13, E14, E15, E16, E17, E18, E19, E20, E21, E22, E23, E24, E25, E26, E27, E28, E29, E30, E31, E32, E33, E34, E35, E36, E37, E38, E39, E40, E41, E42, E43, E44, E45, E46, E47, E48, E49 }, {
  E0: (r) => ({ next: r.one('E1', { from: 'nextId', to: 'id' }), prev: r.one('E49', { from: 'prevId', to: 'id' }), children: r.many('E49', { from: 'id', to: 'nextId' }) }),
  E1: (r) => ({ next: r.one('E2', { from: 'nextId', to: 'id' }), prev: r.one('E0', { from: 'prevId', to: 'id' }), children: r.many('E0', { from: 'id', to: 'nextId' }) }),
  E2: (r) => ({ next: r.one('E3', { from: 'nextId', to: 'id' }), prev: r.one('E1', { from: 'prevId', to: 'id' }), children: r.many('E1', { from: 'id', to: 'nextId' }) }),
  E3: (r) => ({ next: r.one('E4', { from: 'nextId', to: 'id' }), prev: r.one('E2', { from: 'prevId', to: 'id' }), children: r.many('E2', { from: 'id', to: 'nextId' }) }),
  E4: (r) => ({ next: r.one('E5', { from: 'nextId', to: 'id' }), prev: r.one('E3', { from: 'prevId', to: 'id' }), children: r.many('E3', { from: 'id', to: 'nextId' }) }),
  E5: (r) => ({ next: r.one('E6', { from: 'nextId', to: 'id' }), prev: r.one('E4', { from: 'prevId', to: 'id' }), children: r.many('E4', { from: 'id', to: 'nextId' }) }),
  E6: (r) => ({ next: r.one('E7', { from: 'nextId', to: 'id' }), prev: r.one('E5', { from: 'prevId', to: 'id' }), children: r.many('E5', { from: 'id', to: 'nextId' }) }),
  E7: (r) => ({ next: r.one('E8', { from: 'nextId', to: 'id' }), prev: r.one('E6', { from: 'prevId', to: 'id' }), children: r.many('E6', { from: 'id', to: 'nextId' }) }),
  E8: (r) => ({ next: r.one('E9', { from: 'nextId', to: 'id' }), prev: r.one('E7', { from: 'prevId', to: 'id' }), children: r.many('E7', { from: 'id', to: 'nextId' }) }),
  E9: (r) => ({ next: r.one('E10', { from: 'nextId', to: 'id' }), prev: r.one('E8', { from: 'prevId', to: 'id' }), children: r.many('E8', { from: 'id', to: 'nextId' }) }),
  E10: (r) => ({ next: r.one('E11', { from: 'nextId', to: 'id' }), prev: r.one('E9', { from: 'prevId', to: 'id' }), children: r.many('E9', { from: 'id', to: 'nextId' }) }),
  E11: (r) => ({ next: r.one('E12', { from: 'nextId', to: 'id' }), prev: r.one('E10', { from: 'prevId', to: 'id' }), children: r.many('E10', { from: 'id', to: 'nextId' }) }),
  E12: (r) => ({ next: r.one('E13', { from: 'nextId', to: 'id' }), prev: r.one('E11', { from: 'prevId', to: 'id' }), children: r.many('E11', { from: 'id', to: 'nextId' }) }),
  E13: (r) => ({ next: r.one('E14', { from: 'nextId', to: 'id' }), prev: r.one('E12', { from: 'prevId', to: 'id' }), children: r.many('E12', { from: 'id', to: 'nextId' }) }),
  E14: (r) => ({ next: r.one('E15', { from: 'nextId', to: 'id' }), prev: r.one('E13', { from: 'prevId', to: 'id' }), children: r.many('E13', { from: 'id', to: 'nextId' }) }),
  E15: (r) => ({ next: r.one('E16', { from: 'nextId', to: 'id' }), prev: r.one('E14', { from: 'prevId', to: 'id' }), children: r.many('E14', { from: 'id', to: 'nextId' }) }),
  E16: (r) => ({ next: r.one('E17', { from: 'nextId', to: 'id' }), prev: r.one('E15', { from: 'prevId', to: 'id' }), children: r.many('E15', { from: 'id', to: 'nextId' }) }),
  E17: (r) => ({ next: r.one('E18', { from: 'nextId', to: 'id' }), prev: r.one('E16', { from: 'prevId', to: 'id' }), children: r.many('E16', { from: 'id', to: 'nextId' }) }),
  E18: (r) => ({ next: r.one('E19', { from: 'nextId', to: 'id' }), prev: r.one('E17', { from: 'prevId', to: 'id' }), children: r.many('E17', { from: 'id', to: 'nextId' }) }),
  E19: (r) => ({ next: r.one('E20', { from: 'nextId', to: 'id' }), prev: r.one('E18', { from: 'prevId', to: 'id' }), children: r.many('E18', { from: 'id', to: 'nextId' }) }),
  E20: (r) => ({ next: r.one('E21', { from: 'nextId', to: 'id' }), prev: r.one('E19', { from: 'prevId', to: 'id' }), children: r.many('E19', { from: 'id', to: 'nextId' }) }),
  E21: (r) => ({ next: r.one('E22', { from: 'nextId', to: 'id' }), prev: r.one('E20', { from: 'prevId', to: 'id' }), children: r.many('E20', { from: 'id', to: 'nextId' }) }),
  E22: (r) => ({ next: r.one('E23', { from: 'nextId', to: 'id' }), prev: r.one('E21', { from: 'prevId', to: 'id' }), children: r.many('E21', { from: 'id', to: 'nextId' }) }),
  E23: (r) => ({ next: r.one('E24', { from: 'nextId', to: 'id' }), prev: r.one('E22', { from: 'prevId', to: 'id' }), children: r.many('E22', { from: 'id', to: 'nextId' }) }),
  E24: (r) => ({ next: r.one('E25', { from: 'nextId', to: 'id' }), prev: r.one('E23', { from: 'prevId', to: 'id' }), children: r.many('E23', { from: 'id', to: 'nextId' }) }),
  E25: (r) => ({ next: r.one('E26', { from: 'nextId', to: 'id' }), prev: r.one('E24', { from: 'prevId', to: 'id' }), children: r.many('E24', { from: 'id', to: 'nextId' }) }),
  E26: (r) => ({ next: r.one('E27', { from: 'nextId', to: 'id' }), prev: r.one('E25', { from: 'prevId', to: 'id' }), children: r.many('E25', { from: 'id', to: 'nextId' }) }),
  E27: (r) => ({ next: r.one('E28', { from: 'nextId', to: 'id' }), prev: r.one('E26', { from: 'prevId', to: 'id' }), children: r.many('E26', { from: 'id', to: 'nextId' }) }),
  E28: (r) => ({ next: r.one('E29', { from: 'nextId', to: 'id' }), prev: r.one('E27', { from: 'prevId', to: 'id' }), children: r.many('E27', { from: 'id', to: 'nextId' }) }),
  E29: (r) => ({ next: r.one('E30', { from: 'nextId', to: 'id' }), prev: r.one('E28', { from: 'prevId', to: 'id' }), children: r.many('E28', { from: 'id', to: 'nextId' }) }),
  E30: (r) => ({ next: r.one('E31', { from: 'nextId', to: 'id' }), prev: r.one('E29', { from: 'prevId', to: 'id' }), children: r.many('E29', { from: 'id', to: 'nextId' }) }),
  E31: (r) => ({ next: r.one('E32', { from: 'nextId', to: 'id' }), prev: r.one('E30', { from: 'prevId', to: 'id' }), children: r.many('E30', { from: 'id', to: 'nextId' }) }),
  E32: (r) => ({ next: r.one('E33', { from: 'nextId', to: 'id' }), prev: r.one('E31', { from: 'prevId', to: 'id' }), children: r.many('E31', { from: 'id', to: 'nextId' }) }),
  E33: (r) => ({ next: r.one('E34', { from: 'nextId', to: 'id' }), prev: r.one('E32', { from: 'prevId', to: 'id' }), children: r.many('E32', { from: 'id', to: 'nextId' }) }),
  E34: (r) => ({ next: r.one('E35', { from: 'nextId', to: 'id' }), prev: r.one('E33', { from: 'prevId', to: 'id' }), children: r.many('E33', { from: 'id', to: 'nextId' }) }),
  E35: (r) => ({ next: r.one('E36', { from: 'nextId', to: 'id' }), prev: r.one('E34', { from: 'prevId', to: 'id' }), children: r.many('E34', { from: 'id', to: 'nextId' }) }),
  E36: (r) => ({ next: r.one('E37', { from: 'nextId', to: 'id' }), prev: r.one('E35', { from: 'prevId', to: 'id' }), children: r.many('E35', { from: 'id', to: 'nextId' }) }),
  E37: (r) => ({ next: r.one('E38', { from: 'nextId', to: 'id' }), prev: r.one('E36', { from: 'prevId', to: 'id' }), children: r.many('E36', { from: 'id', to: 'nextId' }) }),
  E38: (r) => ({ next: r.one('E39', { from: 'nextId', to: 'id' }), prev: r.one('E37', { from: 'prevId', to: 'id' }), children: r.many('E37', { from: 'id', to: 'nextId' }) }),
  E39: (r) => ({ next: r.one('E40', { from: 'nextId', to: 'id' }), prev: r.one('E38', { from: 'prevId', to: 'id' }), children: r.many('E38', { from: 'id', to: 'nextId' }) }),
  E40: (r) => ({ next: r.one('E41', { from: 'nextId', to: 'id' }), prev: r.one('E39', { from: 'prevId', to: 'id' }), children: r.many('E39', { from: 'id', to: 'nextId' }) }),
  E41: (r) => ({ next: r.one('E42', { from: 'nextId', to: 'id' }), prev: r.one('E40', { from: 'prevId', to: 'id' }), children: r.many('E40', { from: 'id', to: 'nextId' }) }),
  E42: (r) => ({ next: r.one('E43', { from: 'nextId', to: 'id' }), prev: r.one('E41', { from: 'prevId', to: 'id' }), children: r.many('E41', { from: 'id', to: 'nextId' }) }),
  E43: (r) => ({ next: r.one('E44', { from: 'nextId', to: 'id' }), prev: r.one('E42', { from: 'prevId', to: 'id' }), children: r.many('E42', { from: 'id', to: 'nextId' }) }),
  E44: (r) => ({ next: r.one('E45', { from: 'nextId', to: 'id' }), prev: r.one('E43', { from: 'prevId', to: 'id' }), children: r.many('E43', { from: 'id', to: 'nextId' }) }),
  E45: (r) => ({ next: r.one('E46', { from: 'nextId', to: 'id' }), prev: r.one('E44', { from: 'prevId', to: 'id' }), children: r.many('E44', { from: 'id', to: 'nextId' }) }),
  E46: (r) => ({ next: r.one('E47', { from: 'nextId', to: 'id' }), prev: r.one('E45', { from: 'prevId', to: 'id' }), children: r.many('E45', { from: 'id', to: 'nextId' }) }),
  E47: (r) => ({ next: r.one('E48', { from: 'nextId', to: 'id' }), prev: r.one('E46', { from: 'prevId', to: 'id' }), children: r.many('E46', { from: 'id', to: 'nextId' }) }),
  E48: (r) => ({ next: r.one('E49', { from: 'nextId', to: 'id' }), prev: r.one('E47', { from: 'prevId', to: 'id' }), children: r.many('E47', { from: 'id', to: 'nextId' }) }),
  E49: (r) => ({ next: r.one('E0', { from: 'nextId', to: 'id' }), prev: r.one('E48', { from: 'prevId', to: 'id' }), children: r.many('E48', { from: 'id', to: 'nextId' }) }),
})

declare const adapter: Adapter
const db = createDb({ schema, adapter })

export async function deep() {
  const r0 = await db.queryable(E0)
    .where((e) => [e.next.next.next.next.next.name.like('x'), e.children.any((c) => c.prev.prev.children.any((d) => d.score.gt('1')))])
    .select((e) => ({ id: e.id, deep: e.next.next.next.next.next.name, maybe: e.prev.next.prev.name, kids: e.children.toList((c) => ({ n: c.next.next.name, g: c.children.count() })) }))
    .toList()
  const s0: { id: number; deep: string; maybe: string | null; kids: { n: string; g: number }[] }[] = r0
  void s0
  const r7 = await db.queryable(E7)
    .where((e) => [e.next.next.next.next.next.name.like('x'), e.children.any((c) => c.prev.prev.children.any((d) => d.score.gt('1')))])
    .select((e) => ({ id: e.id, deep: e.next.next.next.next.next.name, maybe: e.prev.next.prev.name, kids: e.children.toList((c) => ({ n: c.next.next.name, g: c.children.count() })) }))
    .toList()
  const s7: { id: number; deep: string; maybe: string | null; kids: { n: string; g: number }[] }[] = r7
  void s7
  const r14 = await db.queryable(E14)
    .where((e) => [e.next.next.next.next.next.name.like('x'), e.children.any((c) => c.prev.prev.children.any((d) => d.score.gt('1')))])
    .select((e) => ({ id: e.id, deep: e.next.next.next.next.next.name, maybe: e.prev.next.prev.name, kids: e.children.toList((c) => ({ n: c.next.next.name, g: c.children.count() })) }))
    .toList()
  const s14: { id: number; deep: string; maybe: string | null; kids: { n: string; g: number }[] }[] = r14
  void s14
  const r21 = await db.queryable(E21)
    .where((e) => [e.next.next.next.next.next.name.like('x'), e.children.any((c) => c.prev.prev.children.any((d) => d.score.gt('1')))])
    .select((e) => ({ id: e.id, deep: e.next.next.next.next.next.name, maybe: e.prev.next.prev.name, kids: e.children.toList((c) => ({ n: c.next.next.name, g: c.children.count() })) }))
    .toList()
  const s21: { id: number; deep: string; maybe: string | null; kids: { n: string; g: number }[] }[] = r21
  void s21
  const r28 = await db.queryable(E28)
    .where((e) => [e.next.next.next.next.next.name.like('x'), e.children.any((c) => c.prev.prev.children.any((d) => d.score.gt('1')))])
    .select((e) => ({ id: e.id, deep: e.next.next.next.next.next.name, maybe: e.prev.next.prev.name, kids: e.children.toList((c) => ({ n: c.next.next.name, g: c.children.count() })) }))
    .toList()
  const s28: { id: number; deep: string; maybe: string | null; kids: { n: string; g: number }[] }[] = r28
  void s28
  const r35 = await db.queryable(E35)
    .where((e) => [e.next.next.next.next.next.name.like('x'), e.children.any((c) => c.prev.prev.children.any((d) => d.score.gt('1')))])
    .select((e) => ({ id: e.id, deep: e.next.next.next.next.next.name, maybe: e.prev.next.prev.name, kids: e.children.toList((c) => ({ n: c.next.next.name, g: c.children.count() })) }))
    .toList()
  const s35: { id: number; deep: string; maybe: string | null; kids: { n: string; g: number }[] }[] = r35
  void s35
  const r42 = await db.queryable(E42)
    .where((e) => [e.next.next.next.next.next.name.like('x'), e.children.any((c) => c.prev.prev.children.any((d) => d.score.gt('1')))])
    .select((e) => ({ id: e.id, deep: e.next.next.next.next.next.name, maybe: e.prev.next.prev.name, kids: e.children.toList((c) => ({ n: c.next.next.name, g: c.children.count() })) }))
    .toList()
  const s42: { id: number; deep: string; maybe: string | null; kids: { n: string; g: number }[] }[] = r42
  void s42
  const r49 = await db.queryable(E49)
    .where((e) => [e.next.next.next.next.next.name.like('x'), e.children.any((c) => c.prev.prev.children.any((d) => d.score.gt('1')))])
    .select((e) => ({ id: e.id, deep: e.next.next.next.next.next.name, maybe: e.prev.next.prev.name, kids: e.children.toList((c) => ({ n: c.next.next.name, g: c.children.count() })) }))
    .toList()
  const s49: { id: number; deep: string; maybe: string | null; kids: { n: string; g: number }[] }[] = r49
  void s49
}
