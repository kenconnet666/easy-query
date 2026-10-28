/**
 * 入口。
 * ```ts
 * const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')), log: s => console.log(s.sql) })
 * const users = await db.queryable(User).where(u => u.name.like('a')).toList()
 * await db.transaction(async tx => { await tx.insert(User).values({ ... }).execute() })
 * ```
 */
import type { Statement } from './dialect.ts'
import { columnRules, Interceptors, type Interceptor } from './interceptor.ts'
import { Deletable, Insertable, Updatable } from './mutation.ts'
import { cteEntity, newQueryable, recursiveCteEntity, type Query, type Queryable } from './query.ts'
import type { AnySchema, EntityKey, Schema } from './relations.ts'
import type { DerivedEntity, Entity } from './schema.ts'
import { createSqlTag, type SqlTag } from './native.ts'
import { execute, type Adapter, type Context, type ExecutionEvent, type Session, type TransactionOptions } from './session.ts'

/** 实体对象在 schema 里的键 */
export type KeyOf<S extends AnySchema, E> = { [K in EntityKey<S>]: S['entities'][K] extends E ? K : never }[EntityKey<S>]

type SchemaEntity<S extends AnySchema> = S['entities'][EntityKey<S>]

/** 加上一个 CTE 实体之后的 schema：原有实体 + 名字为 N、列取自查询输出 Out 的派生实体 */
export type WithCte<S extends AnySchema, N extends string, Out> = Schema<S['entities'] & { [P in N]: DerivedEntity<N, Out> }, S['relations'] & { [P in N]: {} }>

export interface DbOptions<S extends AnySchema> {
  readonly schema: S
  readonly adapter: Adapter
  /** 每条语句执行前调用，最简单的日志 */
  readonly log?: (statement: Statement) => void
  /** 每条语句执行后调用（成功与失败都会），带耗时与行数；用来记慢 SQL、指标、链路追踪。钩子里抛错会让这条语句失败 */
  readonly onExecute?: (event: ExecutionEvent) => void
  /** 谓词与写入拦截器，见 tenant()、touch() */
  readonly interceptors?: readonly Interceptor[]
}

export class Db<S extends AnySchema> {
  private readonly ctx: Context
  private readonly adapter: Adapter
  private readonly keys: Map<Entity, string>
  private readonly inTransaction: boolean
  /** 嵌套事务的保存点序号（同一个事务里的 Db 共用） */
  private readonly savepoints: { n: number } = { n: 0 }
  /** 原生 SQL：`db.sql\`SELECT … ${value}\``（查询）、`db.sql.execute\`…\``（写入），值作为绑定参数，见 native.ts */
  readonly sql: SqlTag

  constructor(ctx: Context, adapter: Adapter, keys: Map<Entity, string>, inTransaction: boolean) {
    this.ctx = ctx
    this.adapter = adapter
    this.keys = keys
    this.inTransaction = inTransaction
    this.sql = createSqlTag(ctx)
  }

  queryable<E extends SchemaEntity<S>>(entity: E): Queryable<S, KeyOf<S, E>> {
    return newQueryable(this.ctx, this.key(entity))
  }

  insert<E extends SchemaEntity<S>>(entity: E): Insertable<S, KeyOf<S, E>> {
    return new Insertable(this.ctx, this.key(entity))
  }

  update<E extends SchemaEntity<S>>(entity: E): Updatable<S, KeyOf<S, E>> {
    return new Updatable(this.ctx, this.key(entity))
  }

  delete<E extends SchemaEntity<S>>(entity: E): Deletable<S, KeyOf<S, E>> {
    return new Deletable(this.ctx, this.key(entity))
  }

  /** schema 里某个实体的对象（join、queryable 都要传实体对象）；CTE 登记之后用它取：`tdb.queryable(tdb.entity('recent'))` */
  entity<K extends EntityKey<S>>(key: K): S['entities'][K] {
    const found = this.ctx.schema.entities[key]
    if (!found) throw new Error(`entity '${key}' is not part of the schema`)
    return found as S['entities'][K]
  }

  /**
   * 登记一个 CTE（`WITH name AS (query)`），返回能查询它的新 Db。之后的查询把它当作一个实体用，可以和别的实体 join：
   * ```ts
   * const tdb = db.with('big', db.queryable(Post).where(p => p.amount.gt('100')).select(p => ({ userId: p.userId, amount: p.amount })))
   * await tdb.queryable(User).innerJoin(tdb.entity('big'), (u, b) => b.userId.eq(u.id)).select((u, b) => ({ name: u.name, amount: b.amount })).toList()
   * ```
   * query 的 select 必须只由表达式组成；用到的 CTE 只在引用它的语句里出现，WITH 一律放在最外层。
   */
  with<N extends string, Out>(name: N, query: Query<Out>): Db<WithCte<S, N, Out>> {
    return this.extend(cteEntity(query, this.freshName(name)))
  }

  /**
   * 递归 CTE（树、层级、图的可达性）：anchor 是起点，step 用回调拿到的 self 实体写递归的那一步，两部分按列名对齐。
   * 默认 UNION ALL；传 `{ all: false }` 用 UNION，天然去重、能挡住环。HANA 没有 WITH RECURSIVE，会报不支持。
   * ```ts
   * const tdb = db.withRecursive('tree',
   *   db.queryable(Dept).where(d => d.id.eq(1)).select(d => ({ id: d.id, depth: sql<number>`0` })),
   *   (rdb, self) => rdb.queryable(Dept).innerJoin(self, (d, t) => d.parentId.eq(t.id)).select((d, t) => ({ id: d.id, depth: t.depth.plus(1) })))
   * ```
   */
  withRecursive<N extends string, Out>(
    name: N,
    anchor: Query<Out>,
    step: (db: Db<WithCte<S, N, Out>>, self: DerivedEntity<N, Out>) => Query<Out>,
    options: { all?: boolean } = {},
  ): Db<WithCte<S, N, Out>> {
    let extended: Db<WithCte<S, N, Out>> | undefined
    const entity = recursiveCteEntity(anchor, this.freshName(name), options.all ?? true, (self) => {
      extended = this.extend(self)
      return step(extended, self as DerivedEntity<N, Out>)
    })
    // 递归部分构建完成后实体才完整；Db 本身只持有实体的引用，所以直接可用
    return extended ?? this.extend(entity)
  }

  /**
   * 换表：这个 Db 上的查询把实体映射到别的表（热表 / 归档表、按月分表），导航、join、子查询、include 都跟着换，
   * 不用改任何查询代码。映射的表要有同样的列；`mapTables({ Post: 't_post_2025' })`。
   * 对应 Java 版的 TableNameMapping。
   */
  mapTables(mapping: { [K in EntityKey<S>]?: string }): Db<S> {
    const entities: Record<string, Entity> = { ...this.ctx.schema.entities }
    const keys = new Map(this.keys)
    for (const [key, table] of Object.entries(mapping) as [string, string][]) {
      const original = this.ctx.schema.entities[key]
      if (!original) throw new Error(`mapTables: entity '${key}' is not part of the schema`)
      if (original.derived) throw new Error(`mapTables: '${key}' is a derived table and has no table name to replace`)
      // 复制一份换了表名的实体放进 schema；用户手里的原实体对象仍然指向同一个键
      entities[key] = { ...original, table }
      keys.set(entities[key]!, key)
    }
    return new Db({ ...this.ctx, schema: { ...this.ctx.schema, entities } }, this.adapter, keys, this.inTransaction)
  }

  private freshName(name: string): string {
    if (name in this.ctx.schema.entities) throw new Error(`'${name}' is already an entity or CTE of this schema`)
    return name
  }

  /** 在 schema 里加一个实体（CTE），其余不变 */
  private extend<S2 extends AnySchema>(entity: Entity): Db<S2> {
    const schema = {
      entities: { ...this.ctx.schema.entities, [entity.name]: entity },
      relations: { ...this.ctx.schema.relations, [entity.name]: {} },
    }
    const keys = new Map(this.keys)
    keys.set(entity, entity.name)
    return new Db({ ...this.ctx, schema }, this.adapter, keys, this.inTransaction)
  }

  /**
   * 一个绑定了取消信号的 Db：通过它发出的所有语句（含事务里的）遵守这个信号。
   * 信号已取消时新语句直接失败；执行中取消则不再等待结果，立刻以信号的 reason 失败。
   * 这只是"客户端不再等"，数据库里的语句不会被终止。超时：`db.withSignal(AbortSignal.timeout(5000))`。
   */
  withSignal(signal: AbortSignal): Db<S> {
    return new Db({ ...this.ctx, signal }, this.adapter, this.keys, this.inTransaction)
  }

  /**
   * work 里用 tx 执行的语句在同一个事务里；work 抛错时回滚。
   * 已经在事务里再调用，开的是嵌套事务（保存点）：work 抛错只回滚到保存点，外层事务不受影响（异常仍会抛出，由调用方决定要不要吞掉）。
   */
  async transaction<T>(work: (tx: Db<S>) => Promise<T>, options?: TransactionOptions): Promise<T> {
    if (this.inTransaction) {
      if (options?.isolation || options?.readOnly) throw new Error('a nested transaction cannot change isolation or read-only; set them on the outermost transaction')
      return this.nested(work)
    }
    return this.adapter.driver.transaction((session: Session) => work(new Db({ ...this.ctx, session }, this.adapter, this.keys, true)), options)
  }

  /** 嵌套事务：SAVEPOINT，成功则释放，失败则回滚到保存点 */
  private async nested<T>(work: (tx: Db<S>) => Promise<T>): Promise<T> {
    const dialect = this.ctx.dialect
    const name = `eqts_sp_${++this.savepoints.n}`
    await execute(this.ctx, { sql: dialect.savepoint(name), params: [] })
    const release = dialect.releaseSavepoint(name)
    try {
      const result = await work(this)
      if (release) await execute(this.ctx, { sql: release, params: [] })
      return result
    } catch (error) {
      // 回滚本身失败（比如连接已断）不能盖住原来的错误
      try {
        await execute(this.ctx, { sql: dialect.rollbackToSavepoint(name), params: [] })
        if (release) await execute(this.ctx, { sql: release, params: [] })
      } catch { /* 保留 work 抛出的原始错误 */ }
      throw error
    }
  }

  /**
   * 手动开始一个事务，配合 `await using` 使用：离开作用域时没提交就自动回滚，不用多包一层回调。
   * ```ts
   * await using tx = await db.begin()
   * await tx.insert(User).values(row).execute()
   * if (bad) return                // 提前返回：自动回滚
   * await tx.commit()
   * ```
   */
  async begin(options?: TransactionOptions): Promise<Transaction<S>> {
    if (this.inTransaction) throw new Error('begin() cannot be used inside a transaction; use transaction() for a nested one')
    // 驱动只提供"回调式"事务：在回调里等一个"提交 / 回滚"的决定，决定下来回调才返回，驱动随即提交或回滚
    let decide!: (commit: boolean) => void
    const decision = new Promise<boolean>((resolve) => { decide = resolve })
    let finished!: Promise<void>
    const transaction = await new Promise<Transaction<S>>((resolve, reject) => {
      finished = this.adapter.driver.transaction(async (session: Session) => {
        resolve(new Transaction({ ...this.ctx, session }, this.adapter, this.keys, {
          finish: async (commit) => { decide(commit); await finished },
        }))
        if (!(await decision)) throw ROLLBACK
      }, options).then(() => undefined, (error: unknown) => {
        if (error !== ROLLBACK) { reject(error); throw error }
      })
    })
    return transaction
  }

  private key<K>(entity: Entity): K {
    const key = this.keys.get(entity)
    if (key === undefined) throw new Error(`entity for table '${entity.table}' is not part of the schema`)
    return key as K
  }
}

/** begin() 里用来表示"回滚"的哨兵：让驱动的回调抛出它，驱动据此回滚，再被吞掉 */
const ROLLBACK = Symbol('eqts.rollback')

/** begin() 的结果：一个 Db，外加 commit / rollback；`await using` 离开作用域时没结束就回滚 */
export class Transaction<S extends AnySchema> extends Db<S> {
  private readonly control: { finish(commit: boolean): Promise<void> }
  private done = false

  constructor(ctx: Context, adapter: Adapter, keys: Map<Entity, string>, control: { finish(commit: boolean): Promise<void> }) {
    super(ctx, adapter, keys, true)
    this.control = control
  }

  async commit(): Promise<void> {
    if (this.done) throw new Error('the transaction is already finished')
    this.done = true
    await this.control.finish(true)
  }

  /** 回滚；已经提交或回滚过则什么也不做（所以 `await using` 在提交之后离开作用域是安全的） */
  async rollback(): Promise<void> {
    if (this.done) return
    this.done = true
    await this.control.finish(false)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.rollback()
  }
}

export function createDb<S extends AnySchema>(options: DbOptions<S>): Db<S> {
  const keys = new Map<Entity, string>()
  for (const [key, entity] of Object.entries(options.schema.entities)) keys.set(entity, key)
  const ctx: Context = {
    schema: options.schema, dialect: options.adapter.dialect, session: options.adapter.driver, log: options.log, onExecute: options.onExecute, signal: undefined,
    // 列修饰器驱动的内置规则在前，用户的拦截器在后
    interceptors: new Interceptors([...columnRules(), ...(options.interceptors ?? [])]),
  }
  return new Db(ctx, options.adapter, keys, false)
}
