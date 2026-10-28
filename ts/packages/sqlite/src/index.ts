/**
 * SQLite：基于 Node 自带的 node:sqlite（无需安装驱动），主要用于测试与本地工具。
 * ```ts
 * import { DatabaseSync } from 'node:sqlite'
 * const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) })
 * ```
 * 注意：同一个 DatabaseSync 只有一条连接，事务进行中其它异步代码发出的语句也会落在这个事务里；事务之间按顺序排队。
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { Dialect, type ColumnOptions, type Entity, type Adapter, type Driver, type ExecuteResult, type FunctionRenderer, type Session, type TransactionOptions } from '@eqts/core'

/** SQLite 的日期时间是文字：用 strftime 取整，结果仍是 'YYYY-MM-DD HH:MM:SS' */
function dateTrunc(x: string, unit: string): string {
  switch (unit) {
    case 'year': return `strftime('%Y-01-01 00:00:00', ${x})`
    // 季度：本季第一个月 = ((月 - 1) / 3) * 3 + 1
    case 'quarter': return `(strftime('%Y-', ${x}) || printf('%02d', ((CAST(strftime('%m', ${x}) AS INTEGER) - 1) / 3) * 3 + 1) || '-01 00:00:00')`
    case 'month': return `strftime('%Y-%m-01 00:00:00', ${x})`
    // 'weekday 0' 先走到本周日（或当天就是周日），再退 6 天回到周一
    case 'week': return `strftime('%Y-%m-%d 00:00:00', ${x}, 'weekday 0', '-6 days')`
    case 'day': return `strftime('%Y-%m-%d 00:00:00', ${x})`
    case 'hour': return `strftime('%Y-%m-%d %H:00:00', ${x})`
    case 'minute': return `strftime('%Y-%m-%d %H:%M:00', ${x})`
    default: return `strftime('%Y-%m-%d %H:%M:%S', ${x})`
  }
}

export class SqliteDialect extends Dialect {
  readonly name = 'sqlite'
  /** SQLite 的 IS 就是 null 安全的相等 */
  override readonly nullSafeEquals = 'IS'
  /** SQLite 3.35+（node:sqlite 自带的版本满足） */
  override readonly supportsReturning = true

  /** SQLite 只有 INTEGER / REAL / TEXT / BLOB / NUMERIC 几种亲和性：日期时间都是 TEXT，布尔是 INTEGER */
  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType
    switch (kind) {
      case 'int': case 'bigint': case 'boolean': return 'INTEGER'
      case 'decimal': return 'NUMERIC'
      case 'double': return 'REAL'
      case 'bytes': return 'BLOB'
      default: return 'TEXT'
    }
  }

  /** 自增主键必须写成 `INTEGER PRIMARY KEY AUTOINCREMENT`（主键约束就在列上） */
  override columnDefinition(name: string, kind: string, o: ColumnOptions): string {
    if (o.generated) return `${this.quote(name)} INTEGER PRIMARY KEY AUTOINCREMENT`
    return super.columnDefinition(name, kind, o)
  }

  protected override tableConstraints(entity: Entity): string[] {
    const hasGenerated = Object.values(entity.columns).some((c) => c.options.generated)
    return super.tableConstraints(entity).filter((c) => !(hasGenerated && c.startsWith('PRIMARY KEY')))
  }

  /** SQLite 没有 ROLLUP / CUBE */
  override groupByKeys(keys: string[], mode: 'rollup' | 'cube' | undefined): string {
    if (mode) throw new Error(`${mode}() is not supported by SQLite`)
    return keys.join(', ')
  }

  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      length: (a) => `LENGTH(${a[0]})`,
      concat: (a) => `(${a.join(' || ')})`,
      year: (a) => `CAST(strftime('%Y', ${a[0]}) AS INTEGER)`,
      month: (a) => `CAST(strftime('%m', ${a[0]}) AS INTEGER)`,
      day: (a) => `CAST(strftime('%d', ${a[0]}) AS INTEGER)`,
      substring: (a) => `SUBSTR(${a.join(', ')})`,
      index_of: (a) => `(INSTR(${a[0]}, ${a[1]}) - 1)`,
      left: (a) => `SUBSTR(${a[0]}, 1, ${a[1]})`,
      // 起点小于 1 时 SQLite 会改成"从右数"，所以用 MAX 夹在 1 以上（n 超过长度时取整个字符串）
      right: (a) => `SUBSTR(${a[0]}, MAX(LENGTH(${a[0]}) - ${a[1]} + 1, 1))`,
      // 内置的 FLOOR / CEIL 要编译时打开数学函数，不一定有，用取整加修正代替
      floor: (a) => `(CAST(${a[0]} AS INTEGER) - (${a[0]} < CAST(${a[0]} AS INTEGER)))`,
      ceil: (a) => `(CAST(${a[0]} AS INTEGER) + (${a[0]} > CAST(${a[0]} AS INTEGER)))`,
      mod: (a) => `(${a[0]} % ${a[1]})`,
      // SQLite 的日期时间是文字，用 datetime() 做加减；结果是 'YYYY-MM-DD HH:MM:SS'，不带毫秒
      add_days: (a) => `datetime(${a[0]}, '${a[1]} days')`,
      add_months: (a) => `datetime(${a[0]}, '${a[1]} months')`,
      diff_days: (a) => `CAST(ROUND(julianday(date(${a[0]})) - julianday(date(${a[1]}))) AS INTEGER)`,
      date_trunc: (a) => dateTrunc(a[0]!, a[1]!.replace(/'/g, '')),
      cast_string: (a) => `CAST(${a[0]} AS TEXT)`,
      cast_double: (a) => `CAST(${a[0]} AS REAL)`,
      cast_decimal: (a) => `CAST(${a[0]} AS NUMERIC)`,
      cast_date: (a) => `date(${a[0]})`,
      cast_datetime: (a) => `datetime(${a[0]})`,
    }
  }

  /** SQLite 没有行锁，事务本身锁库 */
  override forUpdate(): string {
    return ''
  }
}

export interface SqliteOptions {
  /**
   * 整数列按 bigint 读出（再由列的 codec 转成 number / bigint / string）。
   * SQLite 的整数是 64 位，node:sqlite 默认读成 JS number，超过 2^53 会丢精度；用 `col.bigint({ mode: 'bigint' })` 存雪花 id 之类的大整数时要打开。
   * 默认关闭：打开后没有 codec 的原生片段（`sql\`...\``）读出的整数也是 bigint。
   */
  readonly bigInts?: boolean
}

class SqliteSession implements Session {
  protected readonly database: DatabaseSync
  private readonly bigInts: boolean

  constructor(database: DatabaseSync, options: SqliteOptions = {}) {
    this.database = database
    this.bigInts = options.bigInts ?? false
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const statement = this.database.prepare(sql)
    if (this.bigInts) statement.setReadBigInts(true)
    return statement.all(...(params as SQLInputValue[])) as Record<string, unknown>[]
  }

  /** node:sqlite 的 iterate：逐行从游标取，按批产出 */
  async *stream(sql: string, params: readonly unknown[], batchSize: number): AsyncGenerator<Record<string, unknown>[]> {
    const statement = this.database.prepare(sql)
    if (this.bigInts) statement.setReadBigInts(true)
    let batch: Record<string, unknown>[] = []
    for (const row of statement.iterate(...(params as SQLInputValue[]))) {
      batch.push(row as Record<string, unknown>)
      if (batch.length >= batchSize) {
        yield batch
        batch = []
      }
    }
    if (batch.length > 0) yield batch
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const result = this.database.prepare(sql).run(...(params as SQLInputValue[]))
    return { affected: Number(result.changes), insertId: result.lastInsertRowid }
  }
}

class SqliteDriver extends SqliteSession implements Driver {
  private queue: Promise<unknown> = Promise.resolve()

  async transaction<T>(work: (session: Session) => Promise<T>, options?: TransactionOptions): Promise<T> {
    const run = async (): Promise<T> => {
      // 只读事务：SQLite 没有 READ ONLY 事务，用 query_only 让写入被拒绝；不需要写锁，所以用普通的 BEGIN
      this.database.exec(options?.readOnly ? 'PRAGMA query_only = ON' : 'BEGIN IMMEDIATE')
      if (options?.readOnly) this.database.exec('BEGIN')
      try {
        const result = await work(this)
        this.database.exec('COMMIT')
        return result
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      } finally {
        if (options?.readOnly) this.database.exec('PRAGMA query_only = OFF')
      }
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }
}

export function sqlite(database: DatabaseSync, options: SqliteOptions = {}): Adapter {
  return { dialect: new SqliteDialect(), driver: new SqliteDriver(database, options) }
}
