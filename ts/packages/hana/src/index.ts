/**
 * SAP HANA 2.0，驱动用 SAP 维护的纯 JS 驱动 hdb（不需要原生编译）。
 * ```ts
 * const db = createDb({ schema, adapter: hana({ host, port: 39041, user, password, schema: 'APP', max: 5 }) })
 * ```
 * 适配器自带一个小连接池（hdb 一个 client 就是一条连接）。自增主键在同一条连接上用 CURRENT_IDENTITY_VALUE() 取回。
 */
import hdb, { type Client, type ClientOptions } from 'hdb'
import { hanaFunctions } from './functions.ts'
import { Dialect, SqlWriter, type Adapter, type Driver, type ExecuteResult, type FunctionRenderer, type InsertNode, type Session, type TransactionOptions } from '@eqts/core'

export { Hana } from './functions.ts'

/** HANA 的 LIMIT 不能省、OFFSET 前必须有 LIMIT */
const NO_LIMIT = 2147483647

export class HanaDialect extends Dialect {
  readonly name = 'hana'

  protected override functions(): Record<string, FunctionRenderer> {
    return {
      ...super.functions(),
      length: (a) => `LENGTH(${a[0]})`,
      // HANA 的 CONCAT 只收两个参数
      concat: (a) => `(${a.join(' || ')})`,
      ...hanaFunctions,
    }
  }

  /**
   * upsert 写成 MERGE：USING 里每行一个 SELECT … FROM DUMMY（多行 UNION ALL），按 target 列匹配；ignore 时没有 WHEN MATCHED。
   */
  override insert(q: InsertNode, w: SqlWriter = new SqlWriter()): string {
    if (!q.conflict && q.rows.length === 1) return super.insert(q, w)
    const cols = q.columns.map((c) => this.quote(c))
    // 渲染时参数按出现顺序收集，所以 source 只渲染一次
    const source = q.rows.map((r) => `SELECT ${r.map((n, i) => `${this.node(n, w)} AS ${cols[i]}`).join(', ')} FROM DUMMY`).join(' UNION ALL ')
    // HANA 的 VALUES 只能一行：多行写成 INSERT … SELECT … FROM DUMMY UNION ALL …
    if (!q.conflict) return `INSERT INTO ${this.table(q.table)} (${cols.join(', ')}) ${source}`
    const on = q.conflict.target.map((t) => `eq_t.${this.quote(t)} = eq_s.${this.quote(t)}`).join(' AND ')
    let sql = `MERGE INTO ${this.table(q.table)} eq_t USING (${source}) eq_s ON (${on})`
    if (q.conflict.update.length > 0) {
      sql += ` WHEN MATCHED THEN UPDATE SET ${q.conflict.update.map((u) => `eq_t.${this.quote(u)} = eq_s.${this.quote(u)}`).join(', ')}`
    }
    return `${sql} WHEN NOT MATCHED THEN INSERT (${cols.join(', ')}) VALUES (${cols.map((c) => `eq_s.${c}`).join(', ')})`
  }

  /**
   * hdb 按服务器推断的参数类型校验 JS 类型；{@code SELECT ? FROM DUMMY}（多行插入、MERGE 的来源）里的参数被推成 NVARCHAR，只收字符串。
   * 数值类型的参数也接受字符串，所以数一律转成字符串传。
   */
  override encodeParam(value: unknown): unknown {
    const v = super.encodeParam(value)
    return typeof v === 'number' || typeof v === 'bigint' ? String(v) : v
  }

  override limitOffset(limit: number | undefined, offset: number | undefined): string {
    if (limit === undefined && offset !== undefined && offset > 0) return ` LIMIT ${NO_LIMIT} OFFSET ${offset}`
    return super.limitOffset(limit, offset)
  }
}

function call<T>(fn: (cb: (error: Error | null, result: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((error, result) => (error ? reject(error) : resolve(result))))
}

async function run(client: Client, sql: string, params: readonly unknown[]): Promise<unknown> {
  if (params.length === 0) return call<unknown>((cb) => client.exec(sql, cb))
  const statement = await call<import('hdb').Statement>((cb) => client.prepare(sql, cb))
  try {
    return await call<unknown>((cb) => statement.exec([...params], cb))
  } finally {
    statement.drop()
  }
}

class HanaSession implements Session {
  protected readonly connection: () => Promise<{ client: Client; release: () => void }>

  constructor(connection: () => Promise<{ client: Client; release: () => void }>) {
    this.connection = connection
  }

  async query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const { client, release } = await this.connection()
    try {
      return (await run(client, sql, params)) as Record<string, unknown>[]
    } finally {
      release()
    }
  }

  async execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult> {
    const { client, release } = await this.connection()
    try {
      const affected = Number(await run(client, sql, params))
      if (!/^\s*INSERT\b/i.test(sql)) return { affected, insertId: undefined }
      // 同一条连接上取刚生成的 IDENTITY；表没有 IDENTITY 列时为 NULL
      const rows = (await run(client, 'SELECT CURRENT_IDENTITY_VALUE() AS "id" FROM DUMMY', [])) as { id: unknown }[]
      const id = rows[0]?.id
      return { affected, insertId: id === null || id === undefined ? undefined : toKey(id) }
    } finally {
      release()
    }
  }
}

function toKey(value: unknown): number | bigint {
  if (typeof value === 'number' || typeof value === 'bigint') return value
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : BigInt(String(value))
}

const ISOLATION = {
  'read uncommitted': 'READ COMMITTED',
  'read committed': 'READ COMMITTED',
  'repeatable read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE',
} as const

export interface HanaOptions extends ClientOptions {
  /** 连接后 SET SCHEMA */
  schema?: string
  /** 连接池上限，默认 5 */
  max?: number
}

/** 最小连接池：空闲的复用，满了排队 */
class Pool {
  private readonly options: HanaOptions
  private readonly idle: Client[] = []
  private readonly waiting: ((client: Client) => void)[] = []
  private size = 0

  constructor(options: HanaOptions) {
    this.options = options
  }

  async acquire(): Promise<Client> {
    const idle = this.idle.pop()
    if (idle) return idle
    if (this.size < (this.options.max ?? 5)) {
      this.size++
      try {
        return await this.open()
      } catch (error) {
        this.size--
        throw error
      }
    }
    return new Promise((resolve) => this.waiting.push(resolve))
  }

  release(client: Client): void {
    const next = this.waiting.shift()
    if (next) next(client)
    else this.idle.push(client)
  }

  end(): void {
    for (const client of this.idle.splice(0)) client.end()
  }

  private async open(): Promise<Client> {
    const { schema, max: _max, ...connect } = this.options
    const client = hdb.createClient(connect)
    client.on('error', () => undefined)
    await call<void>((cb) => client.connect((error) => cb(error, undefined)))
    if (schema) await run(client, `SET SCHEMA "${schema.replace(/"/g, '""')}"`, [])
    return client
  }
}

class HanaDriver extends HanaSession implements Driver {
  private readonly pool: Pool

  constructor(pool: Pool) {
    super(async () => {
      const client = await pool.acquire()
      return { client, release: () => pool.release(client) }
    })
    this.pool = pool
  }

  async transaction<T>(work: (session: Session) => Promise<T>, options?: TransactionOptions): Promise<T> {
    const client = await this.pool.acquire()
    client.setAutoCommit(false)
    try {
      if (options?.isolation) await run(client, `SET TRANSACTION ISOLATION LEVEL ${ISOLATION[options.isolation]}`, [])
      try {
        const result = await work(new HanaSession(async () => ({ client, release: () => undefined })))
        await call<void>((cb) => client.commit((error) => cb(error, undefined)))
        return result
      } catch (error) {
        await call<void>((cb) => client.rollback((error) => cb(error, undefined)))
        throw error
      }
    } finally {
      client.setAutoCommit(true)
      this.pool.release(client)
    }
  }

  end(): void {
    this.pool.end()
  }
}

/** 关闭空闲连接（测试与进程退出时） */
export function closeHana(adapter: Adapter): void {
  if (adapter.driver instanceof HanaDriver) adapter.driver.end()
}

export function hana(options: HanaOptions): Adapter {
  return { dialect: new HanaDialect(), driver: new HanaDriver(new Pool(options)) }
}
