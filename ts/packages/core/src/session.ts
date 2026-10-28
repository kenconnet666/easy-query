/**
 * 驱动接口与执行上下文。驱动只管执行文本 SQL；方言管渲染，两者由各数据库包一起提供（Adapter）。
 */
import type { AnySchema } from './relations.ts'
import type { Dialect, Statement } from './dialect.ts'
import type { Interceptors } from './interceptor.ts'

export interface ExecuteResult {
  readonly affected: number
  /** 自增主键（单行插入时有意义） */
  readonly insertId: number | bigint | undefined
}

/** 一条连接（或事务）上的执行 */
export interface Session {
  query(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]>
  execute(sql: string, params: readonly unknown[]): Promise<ExecuteResult>
  /**
   * 流式读取：每次产出一批（最多 batchSize 行），不把整个结果集读进内存。驱动不支持时不实现，
   * 核心退化成一次读完再分批产出（API 一致，只是没有省内存）。
   */
  stream?(sql: string, params: readonly unknown[], batchSize: number): AsyncIterable<Record<string, unknown>[]>
}

export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'

export interface TransactionOptions {
  readonly isolation?: IsolationLevel
  /** 只读事务：数据库会拒绝其中的写入，部分库还能据此做优化 */
  readonly readOnly?: boolean
}

export interface Driver extends Session {
  /** 在同一条连接上开事务执行 work，正常返回时提交、抛错时回滚 */
  transaction<T>(work: (session: Session) => Promise<T>, options?: TransactionOptions): Promise<T>
}

/** 各数据库包提供：方言 + 驱动 */
export interface Adapter {
  readonly dialect: Dialect
  readonly driver: Driver
}

/** 一条语句执行完（成功或失败）后交给 onExecute 的信息，对应 Java 版的 JdbcExecutorListener */
export interface ExecutionEvent {
  readonly statement: Statement
  /** query 是读（返回行），execute 是写（返回影响的行数） */
  readonly kind: 'query' | 'execute'
  /** 驱动执行耗时，毫秒 */
  readonly durationMs: number
  /** 读返回的行数 / 写影响的行数；失败时为 0 */
  readonly rows: number
  /** 失败时的错误；成功时为 undefined。错误之后仍会照常抛给调用方 */
  readonly error: unknown
}

/** 构建器执行时用到的一切 */
export interface Context {
  readonly schema: AnySchema
  readonly dialect: Dialect
  readonly session: Session
  /** 每条语句执行前调用 */
  readonly log: ((statement: Statement) => void) | undefined
  /** 每条语句执行后调用（成功与失败都会），用来记耗时、慢 SQL、链路追踪 */
  readonly onExecute: ((event: ExecutionEvent) => void) | undefined
  readonly interceptors: Interceptors
  /** 取消信号：已取消的信号让新语句直接失败，执行中取消则不再等待结果（见 Db.withSignal） */
  readonly signal: AbortSignal | undefined
}

export function query(ctx: Context, statement: Statement): Promise<Record<string, unknown>[]> {
  return observe(ctx, statement, 'query', () => ctx.session.query(statement.sql, statement.params), (rows) => rows.length)
}

export function execute(ctx: Context, statement: Statement): Promise<ExecuteResult> {
  return observe(ctx, statement, 'execute', () => ctx.session.execute(statement.sql, statement.params), (result) => result.affected)
}

/**
 * 执行并通知钩子。钩子在 try 之外调用：钩子自己抛错会让这条语句失败，但不会被当成"语句失败"再通知一次。
 */
async function observe<T>(ctx: Context, statement: Statement, kind: 'query' | 'execute', run: () => Promise<T>, count: (result: T) => number): Promise<T> {
  ctx.log?.(statement)
  const started = performance.now()
  let result: T
  try {
    result = await abortable(ctx.signal, run)
  } catch (error) {
    ctx.onExecute?.({ statement, kind, durationMs: performance.now() - started, rows: 0, error })
    throw error
  }
  ctx.onExecute?.({ statement, kind, durationMs: performance.now() - started, rows: count(result), error: undefined })
  return result
}

/**
 * 带取消地执行：信号已取消就不再发出语句；执行中取消就不再等待，立刻以信号的 reason 失败。
 * 注意这只是"客户端不再等"，数据库那边的语句不会被终止（真正的终止要各驱动的取消协议，如 MySQL KILL QUERY、PG pg_cancel_backend）。
 */
export async function abortable<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  if (!signal) return run()
  signal.throwIfAborted()
  let onAbort!: () => void
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([run(), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 流式执行一条查询，按批产出行。驱动没有 stream 时一次读完再分批。
 * 语句日志、onExecute 的行为与 query 一致：日志在开始前，onExecute 在流结束（或被中途放弃）时，rows 是实际产出的行数。
 */
export async function* streamRows(ctx: Context, statement: Statement, batchSize: number): AsyncGenerator<Record<string, unknown>[]> {
  ctx.log?.(statement)
  const started = performance.now()
  let rows = 0
  let failure: unknown
  try {
    ctx.signal?.throwIfAborted()
    const source = ctx.session.stream
      ? ctx.session.stream(statement.sql, statement.params, batchSize)
      : chunks(await abortable(ctx.signal, () => ctx.session.query(statement.sql, statement.params)), batchSize)
    for await (const batch of source) {
      ctx.signal?.throwIfAborted()
      rows += batch.length
      yield batch
    }
  } catch (error) {
    failure = error
    throw error
  } finally {
    ctx.onExecute?.({ statement, kind: 'query', durationMs: performance.now() - started, rows, error: failure })
  }
}

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size)
}
