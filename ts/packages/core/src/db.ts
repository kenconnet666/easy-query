/**
 * 入口。
 * ```ts
 * const db = createDb({ schema, adapter: sqlite(new DatabaseSync(':memory:')), log: s => console.log(s.sql) })
 * const users = await db.queryable(User).where(u => u.name.like('a')).toList()
 * await db.transaction(async tx => { await tx.insert(User).values({ ... }).execute() })
 * ```
 */
import type { Statement } from './dialect.ts'
import { Interceptors, type Interceptor } from './interceptor.ts'
import { Deletable, Insertable, Updatable } from './mutation.ts'
import { newQueryable, type Queryable } from './query.ts'
import type { AnySchema, EntityKey } from './relations.ts'
import type { Entity } from './schema.ts'
import type { Adapter, Context, Session, TransactionOptions } from './session.ts'

/** 实体对象在 schema 里的键 */
export type KeyOf<S extends AnySchema, E> = { [K in EntityKey<S>]: S['entities'][K] extends E ? K : never }[EntityKey<S>]

type SchemaEntity<S extends AnySchema> = S['entities'][EntityKey<S>]

export interface DbOptions<S extends AnySchema> {
  readonly schema: S
  readonly adapter: Adapter
  /** 每条语句执行前调用 */
  readonly log?: (statement: Statement) => void
  /** 谓词与写入拦截器，见 tenant()、touch() */
  readonly interceptors?: readonly Interceptor[]
}

export class Db<S extends AnySchema> {
  private readonly ctx: Context
  private readonly adapter: Adapter
  private readonly keys: Map<Entity, string>
  private readonly inTransaction: boolean

  constructor(ctx: Context, adapter: Adapter, keys: Map<Entity, string>, inTransaction: boolean) {
    this.ctx = ctx
    this.adapter = adapter
    this.keys = keys
    this.inTransaction = inTransaction
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

  /** work 里用 tx 执行的语句在同一个事务里；work 抛错时回滚 */
  async transaction<T>(work: (tx: Db<S>) => Promise<T>, options?: TransactionOptions): Promise<T> {
    if (this.inTransaction) throw new Error('nested transactions are not supported; use the outer tx')
    return this.adapter.driver.transaction((session: Session) => work(new Db({ ...this.ctx, session }, this.adapter, this.keys, true)), options)
  }

  private key<K>(entity: Entity): K {
    const key = this.keys.get(entity)
    if (key === undefined) throw new Error(`entity for table '${entity.table}' is not part of the schema`)
    return key as K
  }
}

export function createDb<S extends AnySchema>(options: DbOptions<S>): Db<S> {
  const keys = new Map<Entity, string>()
  for (const [key, entity] of Object.entries(options.schema.entities)) keys.set(entity, key)
  const ctx: Context = {
    schema: options.schema, dialect: options.adapter.dialect, session: options.adapter.driver, log: options.log,
    interceptors: new Interceptors(options.interceptors ?? []),
  }
  return new Db(ctx, options.adapter, keys, false)
}
