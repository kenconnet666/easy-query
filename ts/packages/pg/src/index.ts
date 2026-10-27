/**
 * PostgreSQL（12+），驱动用 node-postgres（pg）的连接池。
 * ```ts
 * import pg from 'pg'
 * const db = createDb({ schema, adapter: postgres(new pg.Pool({ connectionString })) })
 * ```
 * 日期、时间、时间戳每条查询都按文字读出，再由列的 codec 解码（不受驱动按本地时区解析的影响）；int8、numeric 本来就是文字。
 * 自增主键用 INSERT … RETURNING 取回。
 */
import pg from 'pg'
import type { Pool, PoolClient, QueryConfig, QueryResult } from 'pg'
import { Dialect, type Adapter, type Driver, type ExecuteResult, type FunctionRenderer, type Session, type TransactionOptions } from '@eqts/core'

export class PostgresDialect extends Dialect {
  readonly name = 'postgres'
  override readonly generatedKeys = 'returning' as const

  override placeholder(index: number): string {
    return `$${index}`
  }

  /** CONCAT 是可变参数函数，推不出参数的类型：每项都转成 text */
  protected override functions(): Record<string, FunctionRenderer> {
    return { ...super.functions(), concat: (a) => `CONCAT(${a.map((x) => `CAST(${x} AS text)`).join(', ')})` }
  }

  /** PG 有布尔类型，不转 1 / 0 */
  override encodeParam(value: unknown): unknown {
    return typeof value === 'boolean' ? value : super.encodeParam(value)
  }
}

/** date、time、timetz、timestamp、timestamptz 的 OID：按文字读 */
const AS_TEXT = new Set([1082, 1083, 1266, 1114, 1184])

const types = {
  getTypeParser: ((oid: number) => (AS_TEXT.has(oid) ? (value: string) => value : pg.types.getTypeParser(oid))) as typeof pg.types.getTypeParser,
}

type Target = Pick<Pool, 'query'> | PoolClient

function run(target: Target, sql: string, params: readonly unknown[]): Promise<QueryResult> {
  const config: QueryConfig = { text: sql, values: params as unknown[], types }
  return target.query(config)
}

class PostgresSession implements Session {
  protected readonly target: Target

  constructor(target: Target) {
    this.target = target
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const result = await run(this.target, sql, params)
    return result.rows as Record<string, unknown>[]
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const result = await run(this.target, sql, params)
    return { affected: result.rowCount ?? 0, insertId: undefined }
  }
}

const ISOLATION = {
  'read uncommitted': 'READ UNCOMMITTED',
  'read committed': 'READ COMMITTED',
  'repeatable read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE',
} as const

class PostgresDriver extends PostgresSession implements Driver {
  private readonly pool: Pool

  constructor(pool: Pool) {
    super(pool)
    this.pool = pool
  }

  async transaction<T>(work: (session: Session) => Promise<T>, options?: TransactionOptions): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query(options?.isolation ? `BEGIN ISOLATION LEVEL ${ISOLATION[options.isolation]}` : 'BEGIN')
      try {
        const result = await work(new PostgresSession(client))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    } finally {
      client.release()
    }
  }
}

export function postgres(pool: Pool): Adapter {
  return { dialect: new PostgresDialect(), driver: new PostgresDriver(pool) }
}
