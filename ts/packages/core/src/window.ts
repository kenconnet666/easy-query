/**
 * 窗口函数。与 Java 版 M3.4 同一组能力：分区、排序、ROWS / RANGE frame、不分区的全局窗口。
 * ```ts
 * db.queryable(Post).select(p => ({
 *   id: p.id,
 *   rn: win.rowNumber(w => w.partitionBy(p.userId).orderBy(p.id.desc())),          // 每个用户内的序号
 *   running: win.sum(p.amount, w => w.partitionBy(p.userId).orderBy(p.id).rows('unboundedPreceding', 'currentRow')),
 *   prev: win.lag(p.amount, w => w.orderBy(p.id)),                                  // 上一行，没有为 null
 * }))
 * ```
 * 不传窗口（或 {@code w => w}）就是全表一个窗口：{@code OVER ()}。
 */
import type { Node, OrderNode } from './ast.ts'
import { aggregateCodec, codecs, Expr, orderNodes, type Numeric, type OrderItem } from './expr.ts'

/** frame 的一端；偏移量写进 SQL，只接受非负整数 */
export type Bound = 'unboundedPreceding' | 'currentRow' | 'unboundedFollowing' | { readonly preceding: number } | { readonly following: number }

export class WindowSpec {
  readonly partition: readonly Node[]
  readonly order: readonly OrderNode[]
  readonly frame: string | undefined

  constructor(partition: readonly Node[] = [], order: readonly OrderNode[] = [], frame?: string) {
    this.partition = partition
    this.order = order
    this.frame = frame
  }

  partitionBy(...exprs: Expr<unknown>[]): WindowSpec {
    return new WindowSpec([...this.partition, ...exprs.map((e) => e.node)], this.order, this.frame)
  }

  orderBy(...items: OrderItem[]): WindowSpec {
    return new WindowSpec(this.partition, [...this.order, ...orderNodes(items)], this.frame)
  }

  /** 按物理行数取窗口：rows('unboundedPreceding', 'currentRow') 是累计 */
  rows(start: Bound, end: Bound): WindowSpec {
    return new WindowSpec(this.partition, this.order, `ROWS BETWEEN ${bound(start)} AND ${bound(end)}`)
  }

  /** 按 ORDER BY 的值取窗口（值相同的行同进同出） */
  range(start: Bound, end: Bound): WindowSpec {
    return new WindowSpec(this.partition, this.order, `RANGE BETWEEN ${bound(start)} AND ${bound(end)}`)
  }
}

type Spec = (w: WindowSpec) => WindowSpec

function bound(b: Bound): string {
  if (b === 'unboundedPreceding') return 'UNBOUNDED PRECEDING'
  if (b === 'currentRow') return 'CURRENT ROW'
  if (b === 'unboundedFollowing') return 'UNBOUNDED FOLLOWING'
  const [n, dir] = 'preceding' in b ? [b.preceding, 'PRECEDING'] : [b.following, 'FOLLOWING']
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`window frame offset must be a non-negative integer, got ${n}`)
  return `${n} ${dir}`
}

function over<T>(fn: Node, spec: Spec | undefined, codec: Expr<unknown>['codec']): Expr<T> {
  const w = spec ? spec(new WindowSpec()) : new WindowSpec()
  return new Expr<T>({ k: 'over', fn, partition: w.partition, order: w.order, frame: w.frame }, codec)
}

const lit = (sql: string): Node => ({ k: 'lit', sql })

function positive(n: number, what: string): number {
  if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError(`${what} must be a positive integer, got ${n}`)
  return n
}

export const win = {
  rowNumber: (spec?: Spec) => over<number>(lit('ROW_NUMBER()'), spec, codecs.int),
  rank: (spec?: Spec) => over<number>(lit('RANK()'), spec, codecs.int),
  denseRank: (spec?: Spec) => over<number>(lit('DENSE_RANK()'), spec, codecs.int),
  /** 把有序的行分成 buckets 组，返回组号（1 起） */
  ntile: (buckets: number, spec?: Spec) => over<number>(lit(`NTILE(${positive(buckets, 'ntile buckets')})`), spec, codecs.int),
  count: (value?: Expr<unknown>, spec?: Spec) =>
    over<number>({ k: 'agg', fn: 'count', arg: value?.node, distinct: false }, spec, codecs.int),
  sum: <V extends Numeric | null>(value: Expr<V>, spec?: Spec) =>
    over<NonNullable<V> | null>({ k: 'agg', fn: 'sum', arg: value.node, distinct: false }, spec, aggregateCodec('sum', value)),
  avg: <V extends Numeric | null>(value: Expr<V>, spec?: Spec) =>
    over<NonNullable<V> | null>({ k: 'agg', fn: 'avg', arg: value.node, distinct: false }, spec, aggregateCodec('avg', value)),
  max: <V>(value: Expr<V>, spec?: Spec) => over<NonNullable<V> | null>({ k: 'agg', fn: 'max', arg: value.node, distinct: false }, spec, value.codec),
  min: <V>(value: Expr<V>, spec?: Spec) => over<NonNullable<V> | null>({ k: 'agg', fn: 'min', arg: value.node, distinct: false }, spec, value.codec),
  /** 往前第 offset 行的值；没有时为 null */
  lag: <V>(value: Expr<V>, spec?: Spec, offset = 1) =>
    over<NonNullable<V> | null>({ k: 'raw', parts: ['LAG(', `, ${positive(offset, 'lag offset')})`], args: [value.node] }, spec, value.codec),
  /** 往后第 offset 行的值；没有时为 null */
  lead: <V>(value: Expr<V>, spec?: Spec, offset = 1) =>
    over<NonNullable<V> | null>({ k: 'raw', parts: ['LEAD(', `, ${positive(offset, 'lead offset')})`], args: [value.node] }, spec, value.codec),
}
