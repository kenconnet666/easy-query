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
import { Dialect, type Adapter, type ConflictNode, type Driver, type ExecuteResult, type FunctionRenderer, type Session, type SqlWriter, type TransactionOptions } from '@eqts/core'
import { mysqlFunctions } from './functions.ts'

export { MySQL } from './functions.ts'
export type { MatchMode } from './functions.ts'

/** MySQL 要求 OFFSET 前必须有 LIMIT；没给 LIMIT 时用最大值 */
const NO_LIMIT = '18446744073709551615'

export class MySqlDialect extends Dialect {
  readonly name = 'mysql'
  /** MySQL 预处理语句最多 65535 个占位符 */
  override readonly maxBindParams = 65535

  /**
   * mysql2 的 query 在客户端把参数插进 SQL：bigint 会被写成带引号的字符串，`BIGINT + '1'` 在 MySQL 里按 DOUBLE 运算，
   * 超过 2^53 的值就丢精度。bigint 只含数字和负号，直接写成整数字面量；二进制统一成 Buffer（mysql2 只认 Buffer）。
   */
  override bindParam(value: unknown, w: SqlWriter): string {
    if (typeof value === 'bigint') return value.toString()
    return super.bindParam(value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value, w)
  }

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

/** mysql2 底层的回调式 API：流式读取只在这一层有（promise 包装没有暴露 stream） */
interface CoreQueryable {
  query(options: object): { stream(options: object): AsyncIterable<unknown> & { destroy(): void } }
}

/** 底层的连接：流式读取自己借一条，读完 release，中途放弃就 destroy（连接关掉，服务端随之终止查询） */
interface CoreConnection extends CoreQueryable {
  release(): void
  destroy(): void
}

/** 底层的连接池（只有池级的会话有 getConnection，事务里的会话没有） */
interface CorePool extends CoreQueryable {
  getConnection(callback: (error: Error | null, connection: CoreConnection) => void): void
}

class MySqlSession implements Session {
  protected readonly target: Queryable
  private readonly core: CoreQueryable

  constructor(target: Queryable, core: CoreQueryable) {
    this.target = target
    this.core = core
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const [rows] = await this.target.query({ sql, values: params, typeCast })
    return rows as Record<string, unknown>[]
  }

  /**
   * mysql2 的结果流（底层回调 API 的 query().stream()）：边收边产出，不攒整个结果集。
   * 池级：借一条专用连接，读完归还；调用方中途放弃就销毁这条连接，别的查询不受影响。
   * 事务里：连接不能销毁，中途放弃时把剩下的行读掉丢弃，保证事务还能继续用。
   */
  async *stream(sql: string, params: readonly unknown[], batchSize: number): AsyncGenerator<Record<string, unknown>[]> {
    const pool = this.core as Partial<CorePool>
    const own = pool.getConnection ? await new Promise<CoreConnection>((resolve, reject) => pool.getConnection!((error, connection) => (error ? reject(error) : resolve(connection)))) : undefined
    const rows = (own ?? this.core).query({ sql, values: params as unknown[], typeCast }).stream({ highWaterMark: batchSize })
    // 手动迭代而不是 for await：for await 提前退出会销毁流，事务里就没法把剩下的读掉了
    const iterator = rows[Symbol.asyncIterator]()
    let finished = false
    try {
      let batch: Record<string, unknown>[] = []
      for (;;) {
        const next = await iterator.next()
        if (next.done) break
        batch.push(next.value as Record<string, unknown>)
        if (batch.length >= batchSize) {
          yield batch
          batch = []
        }
      }
      if (batch.length > 0) yield batch
      finished = true
    } finally {
      if (own) {
        if (finished) own.release()
        else own.destroy()
      } else if (!finished) {
        while (!(await iterator.next()).done) { /* 丢弃剩余的行 */ }
      }
    }
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
    super(pool, (pool as unknown as { pool: CoreQueryable }).pool)
    this.pool = pool
  }

  async transaction<T>(work: (session: Session) => Promise<T>, options?: TransactionOptions): Promise<T> {
    const connection = await this.pool.getConnection()
    try {
      // SET TRANSACTION 只作用于下一个事务，不改连接的默认隔离级别
      if (options?.isolation) await connection.query(`SET TRANSACTION ISOLATION LEVEL ${ISOLATION[options.isolation]}`)
      await connection.query(options?.readOnly ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION')
      try {
        const result = await work(new MySqlSession(connection, (connection as unknown as { connection: CoreQueryable }).connection))
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
