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
import { pgFunctions } from './functions.ts'
import { Dialect, type ColumnOptions, type Adapter, type Driver, type ExecuteResult, type FunctionRenderer, type Node, type Session, type SqlWriter, type TransactionOptions } from '@zerodep-dev/easy-query-ts'

export { Pg } from './functions.ts'

export class PostgresDialect extends Dialect {
  readonly name = 'postgres'
  /** PG 协议里参数个数是 16 位整数，最多 65535 */
  override readonly maxBindParams = 65535
  override readonly generatedKeys = 'returning' as const

  override placeholder(index: number): string {
    return `$${index}`
  }

  /** CONCAT 是可变参数函数，推不出参数的类型：每项都转成 text */
  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      ...pgFunctions,
      concat: (a) => `CONCAT(${a.map((x) => `CAST(${x} AS text)`).join(', ')})`,
      // PG 的两参数 ROUND 只接受 numeric，double 列要先转
      round: (a) => `ROUND(CAST(${a[0]} AS NUMERIC), ${a[1]})`,
      date_trunc: (a) => `DATE_TRUNC(${a[1]}, ${a[0]})`,
      cast_string: (a) => `CAST(${a[0]} AS TEXT)`,
    }
  }

  override columnType(kind: string, o: ColumnOptions): string {
    if (o.dbType) return o.dbType
    switch (kind) {
      case 'decimal': return `NUMERIC(${o.precision ?? 38}, ${o.scale ?? 10})`
      case 'json': return 'JSONB'
      case 'bytes': return 'BYTEA'
      default: return super.columnType(kind, o)
    }
  }

  override readonly nullSafeEquals = 'IS NOT DISTINCT FROM'
  override readonly supportsReturning = true

  /** CASE 分支里的字符串 / 数字 / 布尔参数 PG 推断不出类型（"could not determine data type of parameter"），加显式转换 */
  protected override caseValue(n: Node, w: SqlWriter): string {
    const sql = this.node(n, w)
    if (n.k !== 'param') return sql
    const type = typeof n.value === 'string' ? 'TEXT' : typeof n.value === 'number' ? 'NUMERIC' : typeof n.value === 'boolean' ? 'BOOLEAN' : undefined
    return type ? `CAST(${sql} AS ${type})` : sql
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

/** 游标名的序号：同一个事务里可以同时开几个游标 */
let cursors = 0

function run(target: Target, sql: string, params: readonly unknown[]): Promise<QueryResult> {
  const config: QueryConfig = { text: sql, values: params as unknown[], types }
  return target.query(config)
}

class PostgresSession implements Session {
  protected readonly target: Target
  /** 连接池（事务里的会话没有）：流式读取时用它借一条连接开临时事务 */
  protected readonly pool: Pool | undefined

  constructor(target: Target, pool?: Pool) {
    this.target = target
    this.pool = pool
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const result = await run(this.target, sql, params)
    return result.rows as Record<string, unknown>[]
  }

  /**
   * 游标流：在事务里 DECLARE 一个游标，再一批批 FETCH。直接用池时借一条连接开临时事务；
   * 已经在事务里（target 是 PoolClient）就直接在这个事务里声明游标。不需要额外的 pg-cursor 依赖。
   */
  async *stream(sql: string, params: readonly unknown[], batchSize: number): AsyncGenerator<Record<string, unknown>[]> {
    const own = this.pool ? await this.pool.connect() : undefined
    const client: Target = own ?? this.target
    const cursor = `eqts_cursor_${(cursors += 1)}`
    try {
      if (own) await run(client, 'BEGIN', [])
      await run(client, `DECLARE ${cursor} NO SCROLL CURSOR FOR ${sql}`, params)
      for (;;) {
        const { rows } = await run(client, `FETCH ${batchSize} FROM ${cursor}`, [])
        if (rows.length > 0) yield rows as Record<string, unknown>[]
        if (rows.length < batchSize) break
      }
    } finally {
      try {
        await run(client, `CLOSE ${cursor}`, [])
        if (own) await run(client, 'COMMIT', [])
      } finally {
        own?.release()
      }
    }
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

  private readonly source: Pool

  constructor(pool: Pool) {
    super(pool, pool)
    this.source = pool
  }

  async transaction<T>(work: (session: Session) => Promise<T>, options?: TransactionOptions): Promise<T> {
    const client = await this.source.connect()
    try {
      await client.query(`BEGIN${options?.isolation ? ` ISOLATION LEVEL ${ISOLATION[options.isolation]}` : ''}${options?.readOnly ? ' READ ONLY' : ''}`)
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
