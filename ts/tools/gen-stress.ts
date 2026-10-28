/**
 * 生成 T0 类型压力样板：50 个实体，每个都有指向下一个的多对一与指向上一个的一对多，查询里走 5 层导航。
 * 用法：node tools/gen-stress.ts > packages/test/test/stress.check.ts
 */
const N = 50
const lines: string[] = [
  '// 由 tools/gen-stress.ts 生成，勿手改。T0：50 个实体、互相引用的关系、5 层导航，tsc 不报实例化过深。',
  "import { col, createDb, defineSchema, entity, type Adapter } from '@eqts/core'",
  '',
]
for (let i = 0; i < N; i++) {
  lines.push(`const E${i} = entity('t_e${i}', { id: col.bigint().primaryKey().generated(), name: col.string(), nextId: col.bigint(), prevId: col.bigint().nullable(), score: col.decimal(10, 2), at: col.datetime() })`)
}
lines.push('', `const schema = defineSchema({ ${Array.from({ length: N }, (_, i) => `E${i}`).join(', ')} }, {`)
for (let i = 0; i < N; i++) {
  const next = (i + 1) % N
  const prev = (i + N - 1) % N
  lines.push(`  E${i}: (r) => ({ next: r.one('E${next}', { from: 'nextId', to: 'id' }), prev: r.one('E${prev}', { from: 'prevId', to: 'id' }), children: r.many('E${prev}', { from: 'id', to: 'nextId' }) }),`)
}
lines.push('})', '', 'declare const adapter: Adapter', 'const db = createDb({ schema, adapter })', '')
lines.push('export async function deep() {')
for (let i = 0; i < N; i += 7) {
  lines.push(`  const r${i} = await db.queryable(E${i})`)
  lines.push(`    .where((e) => [e.next.next.next.next.next.name.like('x'), e.children.any((c) => c.prev.prev.children.any((d) => d.score.gt('1')))])`)
  lines.push(`    .select((e) => ({ id: e.id, deep: e.next.next.next.next.next.name, maybe: e.prev.next.prev.name, kids: e.children.toList((c) => ({ n: c.next.next.name, g: c.children.count() })) }))`)
  lines.push('    .toList()')
  lines.push(`  const s${i}: { id: number; deep: string; maybe: string | null; kids: { n: string; g: number }[] }[] = r${i}`)
  lines.push(`  void s${i}`)
}
lines.push('}', '')
process.stdout.write(lines.join('\n'))
