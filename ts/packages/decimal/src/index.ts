/**
 * decimal.js 的列类型：库里的 DECIMAL / NUMERIC 读成 `Decimal` 对象，不经过浮点。
 * 核心不依赖 decimal.js；这个包只提供列定义，并用声明合并让算术、sum / avg、窗口函数认得 Decimal。
 *
 * ```ts
 * import { Decimal } from 'decimal.js'
 * import { decimalJs } from '@eqts/decimal'
 *
 * const Order = entity('t_order', { id: col.bigint().primaryKey().generated(), amount: decimalJs(12, 2) })
 * await db.insert(Order).values({ amount: new Decimal('10.50') }).execute()
 * const total = await db.queryable(Order).sum(o => o.amount)          // Decimal | null
 * await db.update(Order).set(o => ({ amount: o.amount.times(2) })).where(o => o.amount.gt(new Decimal(5))).execute()
 * ```
 */
import { Decimal } from 'decimal.js'
import { col } from '@eqts/core'

declare module '@eqts/core' {
  /** 让 plus / minus / times / div、sum / avg 可以用在 Decimal 列上 */
  interface NumericExtensions {
    decimalJs: Decimal
  }
}

/** 写入时接受的值：Decimal，或写 `times(2)` 这类运算时的 number / 数值文字 */
type Writable = Decimal | number | string

/**
 * 精确小数列。precision / scale 目前只是文档（建表由你自己的迁移负责）；以后做代码优先 DDL 时会用到。
 * 读出统一走文字再 `new Decimal(...)`，所以不依赖驱动把 DECIMAL 读成 number 还是 string。
 */
export function decimalJs(_precision?: number, _scale?: number) {
  return col.custom<Decimal>(
    'decimal',
    (raw) => new Decimal(String(raw)),
    // toFixed() 不带参数时给出完整的非科学计数法文字，大数和极小数都不会写成 1e+21
    (value) => (value instanceof Decimal ? value : new Decimal(value as Writable)).toFixed(),
  )
}
