/**
 * 带类型的表达式。`u.name` 是 `Expr<string>`，`u.age` 是 `Expr<number | null>`；条件是 `Expr<boolean>`，可以存进变量、放进数组。
 * 只适用于某些类型的方法用 `this` 参数限定（例如 like 只能在字符串上调用），用错在编译期报错。
 */
import type { AggregateFn, BinaryOp, Node, OrderNode, SelectNode } from './ast.ts'
import { col, type Codec, type DecimalText } from './schema.ts'

export const codecs = {
  int: col.int().codec,
  double: col.double().codec,
  boolean: col.boolean().codec,
  string: col.string().codec,
}

/** 子查询的标记：Queryable 实现它，in(...) 和与标量比较时通过它取出子查询的语法树 */
export const SUBQUERY: unique symbol = Symbol('eqts.subquery')

/**
 * 能当子查询用的东西（一条 Queryable）。T 是它每行产生的值的类型：`select(p => p.userId)` 是 number。
 * 子查询是独立的语句，不能引用外层的表（相关子查询请用一对多导航的 any / count / sum）。
 */
export interface Subquery<T> {
  readonly __row: T
  [SUBQUERY](): SelectNode
}

export function isSubquery(value: unknown): value is Subquery<unknown> {
  return typeof value === 'object' && value !== null && SUBQUERY in value
}

/** 与 T 比较时右边可以写的值：值本身或同类型的表达式；可空的表达式也行（join 条件里 `c.id.eq(u.companyId)`，NULL 不会等于任何值） */
export type Operand<T> = NonNullable<T> | Expr<NonNullable<T>> | Expr<T> | Expr<NonNullable<T> | null> | Subquery<NonNullable<T>> | Subquery<NonNullable<T> | null>

/**
 * 第三方数值类型的登记处。@eqts/decimal 之类的扩展包用声明合并把自己的类型加进来，
 * 之后算术、sum / avg、窗口函数就自动认这个类型，核心不依赖任何第三方库：
 * ```ts
 * declare module '@eqts/core' { interface NumericExtensions { decimalJs: Decimal } }
 * ```
 */
export interface NumericExtensions {}

/** 第三方日期时间类型的登记处，用法同 NumericExtensions（@eqts/date 登记 CalendarDate 等） */
export interface TemporalExtensions {}

/** 可以做算术与 sum / avg 的值类型 */
export type Numeric = number | bigint | DecimalText | NumericExtensions[keyof NumericExtensions]

/** 可以取年 / 月 / 日的值类型（string 是 date 列的 'YYYY-MM-DD'，精确区分留给后续的 Expr 类型门面） */
export type Temporal = Date | string | TemporalExtensions[keyof TemporalExtensions]

/**
 * 算术右操作数：与左边同类型的值或表达式。
 * 十进制文字列和第三方数值类型（如 decimal.js 的 Decimal）额外接受 number，写 `amount.times(2)` 更顺手；
 * bigint 列只接受 bigint，避免把浮点数混进 64 位整数运算。
 */
export type Arith<T> = Operand<T> | (NonNullable<T> extends DecimalText | NumericExtensions[keyof NumericExtensions] ? number : never)

/** T 可空时结果也可空 */
type Keep<T, R> = null extends T ? R | null : R

export class Expr<T> {
  declare readonly __type: T
  readonly node: Node
  /** 读结果时怎么解码；与它比较的参数也用它编码 */
  readonly codec: Codec<any> | undefined

  constructor(node: Node, codec?: Codec<any>) {
    this.node = node
    this.codec = codec
  }

  eq(value: Operand<T>): Pred { return this.op('=', value) }
  ne(value: Operand<T>): Pred { return this.op('<>', value) }
  gt(value: Operand<T>): Pred { return this.op('>', value) }
  ge(value: Operand<T>): Pred { return this.op('>=', value) }
  lt(value: Operand<T>): Pred { return this.op('<', value) }
  le(value: Operand<T>): Pred { return this.op('<=', value) }

  /**
   * 在这些值里，或在子查询的结果里：`u.id.in(db.queryable(Post).select(p => p.userId))`。
   * 值列表为空数组时恒为假；子查询必须只选一列。
   */
  in(values: readonly NonNullable<T>[] | Subquery<NonNullable<T>> | Subquery<NonNullable<T> | null>): Pred {
    return this.inNode(values, false)
  }

  /** 不在这些值里 / 子查询的结果里。值列表为空数组时恒为真（子查询里有 NULL 时按 SQL 的 NOT IN 规则，结果为未知） */
  notIn(values: readonly NonNullable<T>[] | Subquery<NonNullable<T>> | Subquery<NonNullable<T> | null>): Pred {
    return this.inNode(values, true)
  }

  private inNode(values: readonly unknown[] | Subquery<unknown>, not: boolean): Pred {
    if (isSubquery(values)) return pred({ k: 'in_sub', e: this.node, q: values[SUBQUERY](), not })
    return pred({ k: 'in', e: this.node, list: (values as readonly unknown[]).map((v) => this.operand(v)), not })
  }

  between(lo: Operand<T>, hi: Operand<T>): Pred {
    return pred({ k: 'between', e: this.node, lo: this.operand(lo), hi: this.operand(hi) })
  }

  /**
   * null 安全的相等：两边都是 NULL 也算相等（`=` 遇到 NULL 得到未知）。value 可以是 null。
   * MySQL `<=>`、PG `IS NOT DISTINCT FROM`、SQLite `IS`，其它库写成 `(a = b OR (a IS NULL AND b IS NULL))`。
   */
  eqNullSafe(value: Operand<T> | null): Pred {
    return pred({ k: 'eq_ns', l: this.node, r: value === null ? { k: 'lit', sql: 'NULL' } : this.operand(value) })
  }

  /**
   * 截断到某个时间单位（`createdAt.dateTrunc('month')` 得到当月 1 日 0 点），按月 / 按周 / 按天分组统计时用。
   * 周从星期一开始（与 PG 一致）。HANA 暂不支持，渲染时报错。
   */
  dateTrunc(this: Expr<Temporal | null>, unit: DateUnit): Expr<T> {
    if (!DATE_UNITS.includes(unit)) throw new RangeError(`dateTrunc unit must be one of ${DATE_UNITS.join(', ')}, got '${unit}'`)
    return new Expr({ k: 'fn', name: 'date_trunc', args: [this.node, { k: 'lit', sql: `'${unit}'` }] }, this.codec) as Expr<T>
  }

  isNull(): Pred { return pred({ k: 'null', e: this.node, not: false }) }
  isNotNull(): Pred { return pred({ k: 'null', e: this.node, not: true }) }

  /** 包含 text（两边加 %）；text 里的 % _ 按字面匹配 */
  like(this: Expr<string | null>, text: string): Pred { return this.likeNode(`%${escapeLike(text)}%`, false) }
  notLike(this: Expr<string | null>, text: string): Pred { return this.likeNode(`%${escapeLike(text)}%`, true) }
  startsWith(this: Expr<string | null>, text: string): Pred { return this.likeNode(`${escapeLike(text)}%`, false) }
  endsWith(this: Expr<string | null>, text: string): Pred { return this.likeNode(`%${escapeLike(text)}`, false) }

  asc(): Order { return new Order({ e: this.node, desc: false }) }
  desc(): Order { return new Order({ e: this.node, desc: true }) }

  /** 为 NULL 时取 fallback（COALESCE） */
  orElse(fallback: Operand<T>): Expr<NonNullable<T>> {
    return new Expr({ k: 'fn', name: 'coalesce', args: [this.node, this.operand(fallback)] }, this.codec)
  }

  upper(this: Expr<string | null>): Expr<T> { return this.fn('upper') as Expr<T> }
  lower(this: Expr<string | null>): Expr<T> { return this.fn('lower') as Expr<T> }
  trim(this: Expr<string | null>): Expr<T> { return this.fn('trim') as Expr<T> }
  /** 字符数 */
  length(this: Expr<string | null>): Expr<Keep<T, number>> { return new Expr({ k: 'fn', name: 'length', args: [this.node] }, codecs.int) }
  concat(this: Expr<string | null>, ...parts: (string | Expr<string | null>)[]): Expr<T> {
    return new Expr({ k: 'fn', name: 'concat', args: [this.node, ...parts.map((p) => toNode(p, codecs.string))] }, this.codec)
  }

  // 算术：接收者可以是任何数值类型（number / bigint / 十进制文字 / 通过 NumericExtensions 登记的第三方类型）
  plus(this: Expr<Numeric | null>, value: Arith<T>): Expr<T> { return this.arith('+', value) as Expr<T> }
  minus(this: Expr<Numeric | null>, value: Arith<T>): Expr<T> { return this.arith('-', value) as Expr<T> }
  times(this: Expr<Numeric | null>, value: Arith<T>): Expr<T> { return this.arith('*', value) as Expr<T> }
  div(this: Expr<Numeric | null>, value: Arith<T>): Expr<T> { return this.arith('/', value) as Expr<T> }

  year(this: Expr<Temporal | null>): Expr<Keep<T, number>> { return new Expr({ k: 'fn', name: 'year', args: [this.node] }, codecs.int) }
  month(this: Expr<Temporal | null>): Expr<Keep<T, number>> { return new Expr({ k: 'fn', name: 'month', args: [this.node] }, codecs.int) }
  day(this: Expr<Temporal | null>): Expr<Keep<T, number>> { return new Expr({ k: 'fn', name: 'day', args: [this.node] }, codecs.int) }

  // ---- 字符串函数（写法由各方言的函数表决定） ----

  /** 子串：下标按 JS 的 substring，从 start（含）到 end（不含），0 起；省略 end 取到末尾 */
  substring(this: Expr<string | null>, start: number, end?: number): Expr<T> {
    const from = nonNegativeInt(start, 'substring start')
    const args: Node[] = [this.node, intLit(from + 1)]
    if (end !== undefined) {
      const to = nonNegativeInt(end, 'substring end')
      // JS 的 substring 会悄悄交换两个下标；这里直接报错，免得把写反了的下标当成正确结果
      if (to < from) throw new RangeError(`substring end (${to}) must not be less than start (${from})`)
      args.push(intLit(to - from))
    }
    return new Expr({ k: 'fn', name: 'substring', args }, this.codec)
  }

  /** 把所有 search 替换成 replacement */
  replace(this: Expr<string | null>, search: string, replacement: string): Expr<T> {
    return new Expr({ k: 'fn', name: 'replace', args: [this.node, this.operand(search), this.operand(replacement)] }, this.codec)
  }

  /** text 第一次出现的位置，0 起；没有时为 -1（与 JS 的 indexOf 一致） */
  indexOf(this: Expr<string | null>, text: string): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'index_of', args: [this.node, this.operand(text)] }, codecs.int)
  }

  /** 前 n 个字符 */
  left(this: Expr<string | null>, n: number): Expr<T> {
    return new Expr({ k: 'fn', name: 'left', args: [this.node, intLit(nonNegativeInt(n, 'left length'))] }, this.codec)
  }

  /** 后 n 个字符 */
  right(this: Expr<string | null>, n: number): Expr<T> {
    return new Expr({ k: 'fn', name: 'right', args: [this.node, intLit(nonNegativeInt(n, 'right length'))] }, this.codec)
  }

  // ---- 数学函数 ----

  abs(this: Expr<Numeric | null>): Expr<T> { return this.fn('abs') as Expr<T> }
  floor(this: Expr<Numeric | null>): Expr<T> { return this.fn('floor') as Expr<T> }
  ceil(this: Expr<Numeric | null>): Expr<T> { return this.fn('ceil') as Expr<T> }

  /** 四舍五入到 digits 位小数（默认取整） */
  round(this: Expr<Numeric | null>, digits = 0): Expr<T> {
    return new Expr({ k: 'fn', name: 'round', args: [this.node, intLit(nonNegativeInt(digits, 'round digits'))] }, this.codec)
  }

  /** 取余 */
  mod(this: Expr<Numeric | null>, divisor: Arith<T>): Expr<T> {
    return new Expr({ k: 'fn', name: 'mod', args: [this.node, this.operand(divisor)] }, this.codec)
  }

  // ---- 日期函数 ----

  /** 加 n 天（n 可为负）。SQLite 的结果不带毫秒 */
  addDays(this: Expr<Temporal | null>, n: number): Expr<T> {
    return new Expr({ k: 'fn', name: 'add_days', args: [this.node, intLit(safeInt(n, 'addDays'))] }, this.codec)
  }

  /** 加 n 个月（n 可为负）；月末按各库自己的规则收敛（如 1 月 31 日加 1 个月） */
  addMonths(this: Expr<Temporal | null>, n: number): Expr<T> {
    return new Expr({ k: 'fn', name: 'add_months', args: [this.node, intLit(safeInt(n, 'addMonths'))] }, this.codec)
  }

  /** 与 other 相差的整天数（本值减 other，只看日期部分） */
  diffDays(this: Expr<Temporal | null>, other: Operand<T>): Expr<Keep<T, number>> {
    return new Expr({ k: 'fn', name: 'diff_days', args: [this.node, this.operand(other)] }, codecs.int)
  }

  // ---- 通用 ----

  /** 与 value 相等时得到 NULL（NULLIF） */
  nullIf(value: Operand<T>): Expr<T | null> {
    return new Expr({ k: 'fn', name: 'nullif', args: [this.node, this.operand(value)] }, this.codec)
  }

  /**
   * 类型转换（CAST）。decimal 要给精度与小数位：`x.cast('decimal', 12, 2)`。
   * 各库的类型名不同（MySQL 的整数是 SIGNED、字符串是 CHAR），由方言函数表翻译。
   */
  cast<K extends keyof CastTypes>(type: K, precision?: number, scale?: number): Expr<Keep<T, CastTypes[K]>> {
    const args: Node[] = [this.node]
    if (type === 'decimal') args.push(intLit(nonNegativeInt(precision ?? 38, 'cast precision')), intLit(nonNegativeInt(scale ?? 10, 'cast scale')))
    return new Expr({ k: 'fn', name: `cast_${type}`, args }, castCodecs[type])
  }

  /** 把值转成参数节点，用本表达式的编码 */
  operand(value: unknown): Node {
    return toNode(value, this.codec)
  }

  private op(op: BinaryOp, value: unknown): Pred {
    if (value === null || value === undefined) throw new TypeError(`cannot compare with ${String(value)}; use isNull() / isNotNull()`)
    return pred({ k: 'op', op, l: this.node, r: this.operand(value) })
  }

  private arith(op: BinaryOp, value: unknown): Expr<unknown> {
    return new Expr({ k: 'op', op, l: this.node, r: this.operand(value) }, this.codec)
  }

  private fn(name: string): Expr<unknown> {
    return new Expr({ k: 'fn', name, args: [this.node] }, this.codec)
  }

  private likeNode(pattern: string, not: boolean): Pred {
    return pred({ k: 'like', e: this.node, pattern: { k: 'param', value: pattern, codec: undefined }, not })
  }
}

export type Pred = Expr<boolean>

/** dateTrunc 的时间单位 */
export type DateUnit = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second'
const DATE_UNITS: readonly DateUnit[] = ['year', 'quarter', 'month', 'week', 'day', 'hour', 'minute', 'second']

/** cast 的目标类型 → 转换后的 JS 类型 */
export interface CastTypes {
  string: string
  int: number
  bigint: number
  double: number
  decimal: DecimalText
  date: string
  datetime: Date
}

const castCodecs: Record<keyof CastTypes, Codec<any>> = {
  string: col.string().codec,
  int: col.int().codec,
  bigint: col.bigint().codec,
  double: col.double().codec,
  decimal: col.decimal().codec,
  date: col.date().codec,
  datetime: col.datetime().codec,
}

/** 受信任的整数字面量：函数的位置、长度等参数直接写进 SQL，不占绑定参数（PG 的 SUBSTRING 等对参数类型很挑） */
function intLit(n: number): Node {
  return { k: 'lit', sql: String(n) }
}

function safeInt(n: number, what: string): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be an integer, got ${n}`)
  return n
}

function nonNegativeInt(n: number, what: string): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${what} must be a non-negative integer, got ${n}`)
  return n
}

/**
 * CASE WHEN 的构建器。结果类型是各分支值类型的并集：
 * ```ts
 * caseWhen(u.age.lt(18), 'minor').when(u.age.lt(65), 'adult').else('senior')   // Expr<string>
 * caseWhen(u.age.isNull(), 0).end()                                           // 没有 ELSE：不匹配时为 NULL，Expr<number | null>
 * ```
 */
export class CaseBuilder<T> {
  private readonly branches: readonly (readonly [Node, Node])[]
  private readonly codec: Codec<any> | undefined

  constructor(branches: readonly (readonly [Node, Node])[], codec: Codec<any> | undefined) {
    this.branches = branches
    this.codec = codec
  }

  when<V>(condition: Pred, value: V | Expr<V>): CaseBuilder<T | V> {
    const [node, codec] = branchValue(value)
    return new CaseBuilder<T | V>([...this.branches, [condition.node, node]], this.codec ?? codec)
  }

  /** 以 ELSE 结束 */
  else<V>(value: V | Expr<V>): Expr<T | V> {
    const [node, codec] = branchValue(value)
    return new Expr({ k: 'case', when: this.branches, else: node }, this.codec ?? codec)
  }

  /** 不写 ELSE 就结束：没有分支命中时为 NULL */
  end(): Expr<T | null> {
    return new Expr({ k: 'case', when: this.branches, else: undefined }, this.codec)
  }
}

/** 从 `when` 条件开始一个 CASE 表达式 */
export function caseWhen<V>(condition: Pred, value: V | Expr<V>): CaseBuilder<V> {
  const [node, codec] = branchValue(value)
  return new CaseBuilder<V>([[condition.node, node]], codec)
}

/** 分支值 → 节点与读结果用的解码：表达式沿用自己的；字面量按 JS 类型选 */
function branchValue(value: unknown): [Node, Codec<any> | undefined] {
  if (value instanceof Expr) return [value.node, value.codec]
  const codec = typeof value === 'string' ? codecs.string
    : typeof value === 'number' ? codecs.double
      : typeof value === 'boolean' ? codecs.boolean
        : value instanceof Date ? col.datetime().codec
          : undefined
  return [{ k: 'param', value, codec: undefined }, codec]
}

export class Order {
  readonly node: OrderNode
  constructor(node: OrderNode) {
    this.node = node
  }
}

export type OrderItem = Order | Expr<unknown>

/** 条件：数组表示 AND；false / null / undefined / 0 / '' 跳过，方便写 `age != null && u.age.ge(age)` */
export type Cond = Expr<boolean> | Expr<boolean | null> | false | null | undefined | 0 | '' | readonly Cond[]

export function and(...conds: Cond[]): Pred {
  return pred(combine('and', conds) ?? { k: 'lit', sql: '1 = 1' })
}

/** 全部跳过时恒为假 */
export function or(...conds: Cond[]): Pred {
  const items = conds.map(condNode).filter((n): n is Node => n !== undefined)
  if (items.length === 0) return pred({ k: 'lit', sql: '1 = 0' })
  return pred(items.length === 1 ? items[0]! : { k: 'or', items })
}

export function not(cond: Cond): Pred {
  const n = condNode(cond)
  return pred(n ? { k: 'not', e: n } : { k: 'lit', sql: '1 = 0' })
}

/** 条件 → 节点；全部跳过时为 undefined */
export function condNode(cond: Cond): Node | undefined {
  if (!cond) return undefined
  if (cond instanceof Expr) return cond.node
  return combine('and', cond)
}

function combine(kind: 'and', conds: readonly Cond[]): Node | undefined {
  const items = conds.map(condNode).filter((n): n is Node => n !== undefined)
  if (items.length === 0) return undefined
  return items.length === 1 ? items[0]! : { k: kind, items }
}

export function orderNodes(items: OrderItem | readonly OrderItem[]): OrderNode[] {
  const list = Array.isArray(items) ? items : [items]
  return list.map((o: OrderItem) => (o instanceof Order ? o.node : { e: o.node, desc: false }))
}

export function toNode(value: unknown, codec: Codec<any> | undefined): Node {
  if (value instanceof Expr) return value.node
  // 子查询当标量用：`(SELECT …)`，要求它只返回一行一列
  if (isSubquery(value)) return { k: 'sub', q: value[SUBQUERY]() }
  return { k: 'param', value, codec }
}

export function pred(node: Node): Pred {
  return new Expr<boolean>(node, codecs.boolean)
}

export function aggregate<T>(fn: AggregateFn, arg: Expr<unknown> | undefined, codec: Codec<any> | undefined, distinct = false): Expr<T> {
  return new Expr<T>({ k: 'agg', fn, arg: arg?.node, distinct }, codec)
}

/** 聚合结果的解码：AVG 总是小数；SUM 跟着列（decimal 仍是文字） */
export function aggregateCodec(fn: AggregateFn, e: Expr<unknown>): Codec<any> | undefined {
  if (fn === 'count') return codecs.int
  if (fn === 'avg') return e.codec?.kind === 'decimal' ? e.codec : codecs.double
  return e.codec
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => '\\' + c)
}

/**
 * 原生 SQL 片段。插进来的表达式按列渲染，其余值作为绑定参数；T 是结果类型。
 * ```ts
 * db.queryable(User).where(u => sql<boolean>`${u.name} REGEXP ${pattern}`)
 * ```
 */
export function sql<T>(strings: TemplateStringsArray, ...args: unknown[]): Expr<T> {
  return new Expr<T>({ k: 'raw', parts: [...strings], args: args.map((a) => toNode(a, undefined)) })
}

/** 带解码的原生片段：`sql.typed(codecs.int)\`...\`` */
sql.typed = <T>(codec: Codec<T>) => (strings: TemplateStringsArray, ...args: unknown[]): Expr<T> =>
  new Expr<T>({ k: 'raw', parts: [...strings], args: args.map((a) => toNode(a, undefined)) }, codec)

/**
 * 方言专属函数的节点：name 由方言的函数表认领（如 'mysql.json_contains'），别的方言渲染时报不支持。
 * 参数里的表达式按列渲染，节点原样放入（如受信任的 lit），其余值作为绑定参数。
 */
export function dialectFn<T>(name: string, args: readonly unknown[], codec?: Codec<any>): Expr<T> {
  const nodes = args.map((a): Node => (a instanceof Expr ? a.node : isNode(a) ? a : { k: 'param', value: a, codec: undefined }))
  return new Expr<T>({ k: 'fn', name, args: nodes }, codec)
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'k' in value && (value as { k: unknown }).k === 'lit'
}
