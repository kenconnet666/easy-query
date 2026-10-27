/**
 * 带类型的表达式。`u.name` 是 `Expr<string>`，`u.age` 是 `Expr<number | null>`；条件是 `Expr<boolean>`，可以存进变量、放进数组。
 * 只适用于某些类型的方法用 `this` 参数限定（例如 like 只能在字符串上调用），用错在编译期报错。
 */
import type { AggregateFn, BinaryOp, Node, OrderNode } from './ast.ts'
import { col, type Codec } from './schema.ts'

export const codecs = {
  int: col.int().codec,
  double: col.double().codec,
  boolean: col.boolean().codec,
  string: col.string().codec,
}

/** 与 T 比较时右边可以写的值：值本身或同类型的表达式 */
export type Operand<T> = NonNullable<T> | Expr<NonNullable<T>> | Expr<T>

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

  /** 空数组时恒为假 */
  in(values: readonly NonNullable<T>[]): Pred {
    return pred({ k: 'in', e: this.node, list: values.map((v) => this.operand(v)), not: false })
  }

  /** 空数组时恒为真 */
  notIn(values: readonly NonNullable<T>[]): Pred {
    return pred({ k: 'in', e: this.node, list: values.map((v) => this.operand(v)), not: true })
  }

  between(lo: Operand<T>, hi: Operand<T>): Pred {
    return pred({ k: 'between', e: this.node, lo: this.operand(lo), hi: this.operand(hi) })
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

  plus(this: Expr<number | null>, value: number | Expr<number | null>): Expr<T> { return this.arith('+', value) as Expr<T> }
  minus(this: Expr<number | null>, value: number | Expr<number | null>): Expr<T> { return this.arith('-', value) as Expr<T> }
  times(this: Expr<number | null>, value: number | Expr<number | null>): Expr<T> { return this.arith('*', value) as Expr<T> }
  div(this: Expr<number | null>, value: number | Expr<number | null>): Expr<T> { return this.arith('/', value) as Expr<T> }

  year(this: Expr<Date | string | null>): Expr<Keep<T, number>> { return new Expr({ k: 'fn', name: 'year', args: [this.node] }, codecs.int) }
  month(this: Expr<Date | string | null>): Expr<Keep<T, number>> { return new Expr({ k: 'fn', name: 'month', args: [this.node] }, codecs.int) }
  day(this: Expr<Date | string | null>): Expr<Keep<T, number>> { return new Expr({ k: 'fn', name: 'day', args: [this.node] }, codecs.int) }

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
