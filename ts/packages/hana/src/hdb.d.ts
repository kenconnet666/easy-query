/** hdb（SAP 的纯 JS HANA 驱动）没有自带类型：这里只声明适配器用到的部分 */
declare module 'hdb' {
  type Callback<T> = (error: Error | null, result: T) => void

  export interface Statement {
    exec(values: unknown[], cb: Callback<unknown>): void
    drop(cb?: (error: Error | null) => void): void
  }

  export interface Client {
    connect(cb: (error: Error | null) => void): void
    exec(sql: string, cb: Callback<unknown>): void
    prepare(sql: string, cb: Callback<Statement>): void
    setAutoCommit(autoCommit: boolean): void
    commit(cb: (error: Error | null) => void): void
    rollback(cb: (error: Error | null) => void): void
    on(event: 'error', listener: (error: Error) => void): void
    end(): void
  }

  export interface ClientOptions {
    host: string
    port: number
    user: string
    password: string
    [option: string]: unknown
  }

  const hdb: { createClient(options: ClientOptions): Client }
  export default hdb
}
