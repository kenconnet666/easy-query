/**
 * 方言：把语法树渲染成某种数据库的 SQL。基类按 SQL 标准写，各库继承后只覆盖不同的地方（引号、函数、分页、锁）。
 */
import type { ConflictNode, CteNode, DeleteNode, InsertNode, Node, SelectNode, UpdateNode } from './ast.ts'
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
      // 字符串：substring 的位置、长度已经是 1 起的整数字面量
      substring: (a) => `SUBSTRING(${a.join(', ')})`,
      replace: (a) => `REPLACE(${a.join(', ')})`,
      index_of: (a) => `(POSITION(${a[1]} IN ${a[0]}) - 1)`,
      left: (a) => `LEFT(${a[0]}, ${a[1]})`,
      right: (a) => `RIGHT(${a[0]}, ${a[1]})`,
      // 数学
      abs: (a) => `ABS(${a[0]})`,
      floor: (a) => `FLOOR(${a[0]})`,
      ceil: (a) => `CEIL(${a[0]})`,
      round: (a) => `ROUND(${a[0]}, ${a[1]})`,
      mod: (a) => `MOD(${a[0]}, ${a[1]})`,
      nullif: (a) => `NULLIF(${a[0]}, ${a[1]})`,
      // 日期：天数 / 月数是整数字面量。基类按 PG 的区间写法，其它库覆盖
      add_days: (a) => `(${a[0]} + INTERVAL '${a[1]} day')`,
      add_months: (a) => `(${a[0]} + INTERVAL '${a[1]} month')`,
      diff_days: (a) => `(CAST(${a[0]} AS DATE) - CAST(${a[1]} AS DATE))`,
      // 类型转换：基类用标准类型名，各库差异覆盖
      cast_string: (a) => `CAST(${a[0]} AS VARCHAR(4000))`,
      cast_int: (a) => `CAST(${a[0]} AS INTEGER)`,
      cast_bigint: (a) => `CAST(${a[0]} AS BIGINT)`,
      cast_double: (a) => `CAST(${a[0]} AS DOUBLE PRECISION)`,
      cast_decimal: (a) => `CAST(${a[0]} AS DECIMAL(${a[1]}, ${a[2]}))`,
      cast_date: (a) => `CAST(${a[0]} AS DATE)`,
      cast_datetime: (a) => `CAST(${a[0]} AS TIMESTAMP)`,
    }
  }

  /**
   * CASE 分支里的值。默认原样渲染；PG 这类不能从上下文推断参数类型的库覆盖它，给参数加类型转换。
   */
  protected caseValue(n: Node, w: SqlWriter): string {
    return this.node(n, w)
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

  /** 把编码后的参数绑定进语句，返回它在 SQL 里的写法；默认是占位符。驱动不能可靠传递的值（见 MySQL 的 bigint）可以覆盖成字面量 */
  bindParam(value: unknown, w: SqlWriter): string {
    return w.bind(this, value)
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

  /** 嵌套事务用的保存点语句；保存点名字由核心生成（只含字母数字下划线） */
  savepoint(name: string): string {
    return `SAVEPOINT ${name}`
  }

  /** 释放保存点；没有这条语句的库返回 undefined（回滚到保存点后事务照常继续） */
  releaseSavepoint(name: string): string | undefined {
    return `RELEASE SAVEPOINT ${name}`
  }

  rollbackToSavepoint(name: string): string {
    return `ROLLBACK TO SAVEPOINT ${name}`
  }

  /** 是否支持递归 CTE（WITH RECURSIVE）。HANA 没有，用层级函数代替 */
  readonly supportsRecursiveCte: boolean = true

  /** 完整的查询语句：WITH 子句 + 查询体 + UNION 的各成员 */
  select(q: SelectNode, w: SqlWriter = new SqlWriter()): string {
    // 绑定参数按渲染顺序收集，所以必须严格按文本顺序渲染：WITH、主体、再是 UNION 的各成员
    const withs = q.ctes && q.ctes.length > 0 ? this.withClause(q.ctes, w) : ''
    let sql = withs + this.selectCore(q, w)
    for (const u of q.unions ?? []) sql += ` UNION ${u.all ? 'ALL ' : ''}${this.selectCore(u.q, w)}`
    return sql
  }

  private withClause(ctes: readonly CteNode[], w: SqlWriter): string {
    const recursive = ctes.some((c) => c.recursive)
    if (recursive && !this.supportsRecursiveCte) throw new Error(`recursive CTEs are not supported by the ${this.name} dialect`)
    const parts = ctes.map((c) => `${this.quote(c.name)} (${c.columns.map((x) => this.quote(x)).join(', ')}) AS (${this.select(c.q, w)})`)
    return `WITH ${recursive ? 'RECURSIVE ' : ''}${parts.join(', ')} `
  }

  private selectCore(q: SelectNode, w: SqlWriter): string {
    const cols = q.columns.length === 0 ? '1' : q.columns.map((c) => `${this.node(c.e, w)} AS ${this.quote(c.as)}`).join(', ')
    let s = `SELECT ${q.distinct ? 'DISTINCT ' : ''}${cols} FROM ${q.from.sub ? `(${this.select(q.from.sub, w)})` : this.table(q.from.table)} ${q.from.alias}`
    for (const j of q.joins) s += ` ${j.kind === 'inner' ? 'INNER' : 'LEFT'} JOIN ${this.table(j.table)} ${j.alias} ON ${this.node(j.on, w)}`
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
      case 'param': return this.bindParam(n.value == null ? null : this.encodeParam(n.codec ? n.codec.encode(n.value) : n.value), w)
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
      case 'in_sub': return `${this.operand(n.e, w)} ${n.not ? 'NOT ' : ''}IN (${this.select(n.q, w)})`
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
        const whens = n.when.map(([c, t]) => ` WHEN ${this.node(c, w)} THEN ${this.caseValue(t, w)}`).join('')
        return `CASE${whens}${n.else ? ` ELSE ${this.caseValue(n.else, w)}` : ''} END`
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
