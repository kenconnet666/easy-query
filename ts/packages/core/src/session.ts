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
}

export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'

export interface TransactionOptions {
  readonly isolation?: IsolationLevel
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
    result = await run()
  } catch (error) {
    ctx.onExecute?.({ statement, kind, durationMs: performance.now() - started, rows: 0, error })
    throw error
  }
  ctx.onExecute?.({ statement, kind, durationMs: performance.now() - started, rows: count(result), error: undefined })
  return result
}
