/**
 * 驱动接口与执行上下文。驱动只管执行文本 SQL；方言管渲染，两者由各数据库包一起提供（Adapter）。
 */
import type { AnySchema } from './relations.ts'
import type { Dialect, Statement } from './dialect.ts'

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

/** 构建器执行时用到的一切 */
export interface Context {
  readonly schema: AnySchema
  readonly dialect: Dialect
  readonly session: Session
  readonly log: ((statement: Statement) => void) | undefined
}

export async function query(ctx: Context, statement: Statement): Promise<Record<string, unknown>[]> {
  ctx.log?.(statement)
  return ctx.session.query(statement.sql, statement.params)
}

export async function execute(ctx: Context, statement: Statement): Promise<ExecuteResult> {
  ctx.log?.(statement)
  return ctx.session.execute(statement.sql, statement.params)
}
