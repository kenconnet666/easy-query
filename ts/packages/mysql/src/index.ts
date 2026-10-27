/**
 * MySQL 8（基线 8.0.18，覆盖 PolarDB MySQL 8.0.18-X-Cluster），驱动用 mysql2/promise 的连接池。
 * ```ts
 * import { createPool } from 'mysql2/promise'
 * const db = createDb({ schema, adapter: mysql(createPool({ uri, timezone: 'Z' })) })
 * ```
 * 日期时间、DECIMAL、BIGINT 每条查询都按文字读出再由列的 codec 解码，所以不依赖连接池的 dateStrings / supportBigNumbers 配置；
 * TIMESTAMP 列会按会话时区换算，建议连接池设 `timezone: 'Z'` 并让会话时区为 +00:00。
 */
import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise'
import { Dialect, type Adapter, type ConflictNode, type Driver, type ExecuteResult, type FunctionRenderer, type Session, type TransactionOptions } from '@eqts/core'
import { mysqlFunctions } from './functions.ts'

export { MySQL } from './functions.ts'
export type { MatchMode } from './functions.ts'

/** MySQL 要求 OFFSET 前必须有 LIMIT；没给 LIMIT 时用最大值 */
const NO_LIMIT = '18446744073709551615'

export class MySqlDialect extends Dialect {
  readonly name = 'mysql'

  /** MySQL.json / MySQL.match 的函数（见 functions.ts） */
  protected override functions(): Record<string, FunctionRenderer> {
    return { ...super.functions(), ...mysqlFunctions }
  }

  override quote(identifier: string): string {
    return '`' + identifier.replace(/`/g, '``') + '`'
  }

  /** MySQL 的 LIKE 默认转义符就是反斜杠 */
  override likeEscape(): string {
    return ''
  }

  /**
   * MySQL 按表上的主键 / 唯一键判断冲突；用 VALUES(col) 取新值（8.0.19 起的 AS 别名写法 8.0.18 不认）。
   * ignore 写成对 target 的空更新，而不是 INSERT IGNORE（后者会吞掉其它错误）。
   */
  override onConflict(c: ConflictNode): string {
    const update = c.update.length === 0
      ? c.target.map((t) => `${this.quote(t)} = ${this.quote(t)}`)
      : c.update.map((u) => `${this.quote(u)} = VALUES(${this.quote(u)})`)
    return ` ON DUPLICATE KEY UPDATE ${update.join(', ')}`
  }

  override limitOffset(limit: number | undefined, offset: number | undefined): string {
    if (limit === undefined && offset !== undefined && offset > 0) return ` LIMIT ${NO_LIMIT} OFFSET ${offset}`
    return super.limitOffset(limit, offset)
  }
}

const AS_TEXT = new Set(['DATE', 'NEWDATE', 'DATETIME', 'DATETIME2', 'TIMESTAMP', 'TIMESTAMP2', 'TIME', 'TIME2', 'NEWDECIMAL', 'DECIMAL', 'LONGLONG'])

/** 这些类型按文字读，交给列的 codec：避免驱动按本地时区解析日期、DECIMAL 变浮点、BIGINT 丢精度 */
function typeCast(field: { type: string; string(): string | null }, next: () => unknown): unknown {
  return AS_TEXT.has(field.type) ? field.string() : next()
}

type Queryable = Pick<Pool, 'query'> | PoolConnection

class MySqlSession implements Session {
  protected readonly target: Queryable

  constructor(target: Queryable) {
    this.target = target
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const [rows] = await this.target.query({ sql, values: params, typeCast })
    return rows as Record<string, unknown>[]
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const [result] = await this.target.query<ResultSetHeader>({ sql, values: params })
    return { affected: result.affectedRows, insertId: result.insertId === 0 ? undefined : result.insertId }
  }
}

const ISOLATION = {
  'read uncommitted': 'READ UNCOMMITTED',
  'read committed': 'READ COMMITTED',
  'repeatable read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE',
} as const

class MySqlDriver extends MySqlSession implements Driver {
  private readonly pool: Pool

  constructor(pool: Pool) {
    super(pool)
    this.pool = pool
  }

  async transaction<T>(work: (session: Session) => Promise<T>, options?: TransactionOptions): Promise<T> {
    const connection = await this.pool.getConnection()
    try {
      // SET TRANSACTION 只作用于下一个事务，不改连接的默认隔离级别
      if (options?.isolation) await connection.query(`SET TRANSACTION ISOLATION LEVEL ${ISOLATION[options.isolation]}`)
      await connection.beginTransaction()
      try {
        const result = await work(new MySqlSession(connection))
        await connection.commit()
        return result
      } catch (error) {
        await connection.rollback()
        throw error
      }
    } finally {
      connection.release()
    }
  }
}

export function mysql(pool: Pool): Adapter {
  return { dialect: new MySqlDialect(), driver: new MySqlDriver(pool) }
}
