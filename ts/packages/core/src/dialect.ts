/**
 * 方言：把语法树渲染成某种数据库的 SQL。基类按 SQL 标准写，各库继承后只覆盖不同的地方（引号、函数、分页、锁）。
 */
import type { ConflictNode, DeleteNode, InsertNode, Node, SelectNode, UpdateNode } from './ast.ts'
import { utcText } from './schema.ts'

export interface Statement {
  readonly sql: string
  readonly params: readonly unknown[]
}

/** 渲染一条语句时收集参数 */
export class SqlWriter {
  readonly params: unknown[] = []

  bind(dialect: Dialect, value: unknown): string {
    // 超出数据库的占位符上限时，在发给数据库之前报出清楚的错误（而不是一句 "too many placeholders"）
    if (this.params.length >= dialect.maxBindParams) {
      throw new Error(`statement binds more than ${dialect.maxBindParams} parameters, the limit of the ${dialect.name} dialect; split the in-list or the batch into several statements`)
    }
    this.params.push(value)
    return dialect.placeholder(this.params.length)
  }
}

export type FunctionRenderer = (args: string[]) => string

export abstract class Dialect {
  abstract readonly name: string

  private cachedFunctions: Record<string, FunctionRenderer> | undefined

  /** 函数表：节点 { k: 'fn', name } 按名字找写法；子类 `{ ...super.functions(), length: … }` 覆盖 */
  protected functions(): Record<string, FunctionRenderer> {
    return {
      upper: (a) => `UPPER(${a[0]})`,
      lower: (a) => `LOWER(${a[0]})`,
      trim: (a) => `TRIM(${a[0]})`,
      length: (a) => `CHAR_LENGTH(${a[0]})`,
      concat: (a) => `CONCAT(${a.join(', ')})`,
      coalesce: (a) => `COALESCE(${a.join(', ')})`,
      year: (a) => `EXTRACT(YEAR FROM ${a[0]})`,
      month: (a) => `EXTRACT(MONTH FROM ${a[0]})`,
      day: (a) => `EXTRACT(DAY FROM ${a[0]})`,
    }
  }

  /** 一条语句最多能绑定多少个参数；多行插入据此自动分块。默认取各库里最小的常见上限（SQLite 32766） */
  readonly maxBindParams: number = 32766

  /** 单行插入后怎么拿自增主键：驱动直接返回（SQLite、MySQL），或 INSERT … RETURNING 主键（PG） */
  readonly generatedKeys: 'driver' | 'returning' = 'driver'

  returning(column: string): string {
    return ` RETURNING ${this.quote(column)}`
  }

  quote(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`
  }

  /** 第 index 个参数（从 1 开始）的占位符 */
  placeholder(_index: number): string {
    return '?'
  }

  /** LIKE 的转义子句；默认转义符就是反斜杠的库返回空串 */
  likeEscape(): string {
    return " ESCAPE '\\'"
  }

  /** 没有列编码时，JS 值 → 驱动接受的参数 */
  encodeParam(value: unknown): unknown {
    if (value instanceof Date) return utcText(value)
    if (typeof value === 'boolean') return value ? 1 : 0
    return value
  }

  limitOffset(limit: number | undefined, offset: number | undefined): string {
    let s = ''
    if (limit !== undefined) s += ` LIMIT ${int(limit)}`
    if (offset !== undefined && offset > 0) s += ` OFFSET ${int(offset)}`
    return s
  }

  forUpdate(): string {
    return ' FOR UPDATE'
  }

  select(q: SelectNode, w: SqlWriter = new SqlWriter()): string {
    const cols = q.columns.length === 0 ? '1' : q.columns.map((c) => `${this.node(c.e, w)} AS ${this.quote(c.as)}`).join(', ')
    let s = `SELECT ${q.distinct ? 'DISTINCT ' : ''}${cols} FROM ${q.from.sub ? `(${this.select(q.from.sub, w)})` : this.table(q.from.table)} ${q.from.alias}`
    for (const j of q.joins) s += ` LEFT JOIN ${this.table(j.table)} ${j.alias} ON ${this.node(j.on, w)}`
    if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`
    if (q.groupBy.length > 0) s += ` GROUP BY ${q.groupBy.map((g) => this.node(g, w)).join(', ')}`
    if (q.having.length > 0) s += ` HAVING ${this.conjunction(q.having, w)}`
    if (q.orderBy.length > 0) s += ` ORDER BY ${q.orderBy.map((o) => this.node(o.e, w) + (o.desc ? ' DESC' : ' ASC')).join(', ')}`
    s += this.limitOffset(q.limit, q.offset)
    if (q.forUpdate) s += this.forUpdate()
    return s
  }

  insert(q: InsertNode, w: SqlWriter = new SqlWriter()): string {
    const rows = q.rows.map((r) => `(${r.map((n) => this.node(n, w)).join(', ')})`).join(', ')
    return `INSERT INTO ${this.table(q.table)} (${q.columns.map((c) => this.quote(c)).join(', ')}) VALUES ${rows}${q.conflict ? this.onConflict(q.conflict) : ''}`
  }

  /** upsert 子句；默认是 SQLite / PG 的 ON CONFLICT 写法 */
  onConflict(c: ConflictNode): string {
    const target = `(${c.target.map((t) => this.quote(t)).join(', ')})`
    if (c.update.length === 0) return ` ON CONFLICT ${target} DO NOTHING`
    return ` ON CONFLICT ${target} DO UPDATE SET ${c.update.map((u) => `${this.quote(u)} = excluded.${this.quote(u)}`).join(', ')}`
  }

  update(q: UpdateNode, w: SqlWriter = new SqlWriter()): string {
    const set = q.set.map((s) => `${this.quote(s.column)} = ${this.node(s.e, w)}`).join(', ')
    let s = `UPDATE ${this.table(q.from.table)} AS ${q.from.alias} SET ${set}`
    if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`
    return s
  }

  delete(q: DeleteNode, w: SqlWriter = new SqlWriter()): string {
    let s = `DELETE FROM ${this.table(q.from.table)} AS ${q.from.alias}`
    if (q.where.length > 0) s += ` WHERE ${this.conjunction(q.where, w)}`
    return s
  }

  /** 表名可以带 schema 前缀（a.b） */
  table(name: string): string {
    return name.split('.').map((p) => this.quote(p)).join('.')
  }

  node(n: Node, w: SqlWriter): string {
    switch (n.k) {
      case 'col': return `${n.alias}.${this.quote(n.name)}`
      // 列编码之后再交给方言：例如布尔列编码后仍是布尔，由方言决定写 1 / 0 还是 true / false
      case 'param': return w.bind(this, n.value == null ? null : this.encodeParam(n.codec ? n.codec.encode(n.value) : n.value))
      case 'lit': return n.sql
      case 'raw': return n.parts.reduce((s, part, i) => s + part + (i < n.args.length ? this.node(n.args[i]!, w) : ''), '')
      case 'op': return `${this.operand(n.l, w)} ${n.op} ${this.operand(n.r, w)}`
      case 'and': return n.items.map((i) => this.wrap(i, 'and', w)).join(' AND ')
      case 'or': return n.items.map((i) => this.wrap(i, 'or', w)).join(' OR ')
      case 'not': return `NOT (${this.node(n.e, w)})`
      case 'null': return `${this.operand(n.e, w)} IS ${n.not ? 'NOT ' : ''}NULL`
      case 'in':
        if (n.list.length === 0) return n.not ? '1 = 1' : '1 = 0'
        return `${this.operand(n.e, w)} ${n.not ? 'NOT ' : ''}IN (${n.list.map((i) => this.node(i, w)).join(', ')})`
      case 'between': return `${this.operand(n.e, w)} BETWEEN ${this.operand(n.lo, w)} AND ${this.operand(n.hi, w)}`
      case 'like': return `${this.operand(n.e, w)} ${n.not ? 'NOT ' : ''}LIKE ${this.node(n.pattern, w)}${this.likeEscape()}`
      case 'fn': {
        const render = (this.cachedFunctions ??= this.functions())[n.name]
        if (!render) throw new Error(`function '${n.name}' is not supported by the ${this.name} dialect`)
        return render(n.args.map((a) => this.node(a, w)))
      }
      case 'agg': {
        const arg = n.arg ? this.node(n.arg, w) : '*'
        return `${n.fn.toUpperCase()}(${n.distinct ? 'DISTINCT ' : ''}${arg})`
      }
      case 'case': {
        const whens = n.when.map(([c, t]) => ` WHEN ${this.node(c, w)} THEN ${this.node(t, w)}`).join('')
        return `CASE${whens}${n.else ? ` ELSE ${this.node(n.else, w)}` : ''} END`
      }
      case 'exists': return `${n.not ? 'NOT ' : ''}EXISTS (${this.select(n.q, w)})`
      case 'over': {
        const parts: string[] = []
        if (n.partition.length > 0) parts.push(`PARTITION BY ${n.partition.map((p) => this.node(p, w)).join(', ')}`)
        if (n.order.length > 0) parts.push(`ORDER BY ${n.order.map((o) => this.node(o.e, w) + (o.desc ? ' DESC' : ' ASC')).join(', ')}`)
        if (n.frame) parts.push(n.frame)
        return `${this.node(n.fn, w)} OVER (${parts.join(' ')})`
      }
      case 'sub': return `(${this.select(n.q, w)})`
    }
  }

  private conjunction(items: readonly Node[], w: SqlWriter): string {
    return items.map((i) => this.wrap(i, 'and', w)).join(' AND ')
  }

  /** AND 里的 OR、比较里的运算要加括号 */
  private wrap(n: Node, parent: 'and' | 'or', w: SqlWriter): string {
    const s = this.node(n, w)
    return (n.k === 'or' && parent === 'and') || (n.k === 'and' && parent === 'or') ? `(${s})` : s
  }

  private operand(n: Node, w: SqlWriter): string {
    const s = this.node(n, w)
    return n.k === 'op' || n.k === 'and' || n.k === 'or' || n.k === 'raw' ? `(${s})` : s
  }
}

function int(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`limit/offset must be a non-negative integer, got ${n}`)
  return n
}
