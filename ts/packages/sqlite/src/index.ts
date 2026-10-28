/**
 * SQLite：基于 Node 自带的 node:sqlite（无需安装驱动），主要用于测试与本地工具。
 * ```ts
 * import { DatabaseSync } from 'node:sqlite'
 * const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')) })
 * ```
 * 注意：同一个 DatabaseSync 只有一条连接，事务进行中其它异步代码发出的语句也会落在这个事务里；事务之间按顺序排队。
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { Dialect, type Adapter, type Driver, type ExecuteResult, type FunctionRenderer, type Session } from '@eqts/core'

export class SqliteDialect extends Dialect {
  readonly name = 'sqlite'

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

class SqliteSession implements Session {
  protected readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    return this.database.prepare(sql).all(...(params as SQLInputValue[])) as Record<string, unknown>[]
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const result = this.database.prepare(sql).run(...(params as SQLInputValue[]))
    return { affected: Number(result.changes), insertId: result.lastInsertRowid }
  }
}

class SqliteDriver extends SqliteSession implements Driver {
  private queue: Promise<unknown> = Promise.resolve()

  async transaction<T>(work: (session: Session) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.database.exec('BEGIN IMMEDIATE')
      try {
        const result = await work(this)
        this.database.exec('COMMIT')
        return result
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }
}

export function sqlite(database: DatabaseSync): Adapter {
  return { dialect: new SqliteDialect(), driver: new SqliteDriver(database) }
}
