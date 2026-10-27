/**
 * 插入、更新、删除。更新与删除没有条件时拒绝执行，要整表操作显式调用 all()；条件全被跳过（例如 `id && u.id.eq(id)` 里 id 为空）同样算没有条件。
 */
import { checkAliases, type Node } from './ast.ts'
import { SqlWriter, type Statement } from './dialect.ts'
import { condNode, Expr, toNode, type Cond } from './expr.ts'
import { REF, Scope, type Ref } from './ref.ts'
import type { AnySchema, EntityKey } from './relations.ts'
import type { Entity, Insert, ValueOf } from './schema.ts'
import { execute, query, type Context } from './session.ts'

type EntityOf<S extends AnySchema, K extends EntityKey<S>> = S['entities'][K]

export class Insertable<S extends AnySchema, K extends EntityKey<S>> {
  private readonly ctx: Context
  private readonly key: K

  constructor(ctx: Context, key: K) {
    this.ctx = ctx
    this.key = key
  }

  /** 一行或多行；多行时列不同的行分成几条语句 */
  values(rows: Insert<EntityOf<S, K>> | readonly Insert<EntityOf<S, K>>[]): InsertValues {
    const list = (Array.isArray(rows) ? rows : [rows]) as readonly Record<string, unknown>[]
    return new InsertValues(this.ctx, this.ctx.schema.entities[this.key]!, list)
  }
}

export class InsertValues {
  private readonly ctx: Context
  private readonly entity: Entity
  private readonly rows: readonly Record<string, unknown>[]

  constructor(ctx: Context, entity: Entity, rows: readonly Record<string, unknown>[]) {
    this.ctx = ctx
    this.entity = entity
    this.rows = rows
  }

  /** 返回影响的行数 */
  async execute(): Promise<number> {
    let affected = 0
    for (const statement of this.toSQL()) affected += (await execute(this.ctx, statement)).affected
    return affected
  }

  /** 单行插入，返回自增主键 */
  async returnId(): Promise<number | bigint> {
    const statements = this.toSQL()
    if (this.rows.length !== 1 || statements.length !== 1) throw new Error('returnId() needs exactly one row')
    if (this.ctx.dialect.generatedKeys === 'returning') return this.returnIdByReturning(statements[0]!)
    const result = await execute(this.ctx, statements[0]!)
    if (result.insertId === undefined) throw new Error(`the ${this.ctx.dialect.name} driver did not report a generated key`)
    return result.insertId
  }

  private async returnIdByReturning(statement: Statement): Promise<number | bigint> {
    const key = this.entity.primaryKey[0]
    if (key === undefined) throw new Error(`returnId() needs a primary key on ${this.entity.table}`)
    const rows = await query(this.ctx, { sql: statement.sql + this.ctx.dialect.returning(this.entity.columnNames[key]!), params: statement.params })
    const value = rows[0] ? Object.values(rows[0])[0] : undefined
    if (value === undefined || value === null) throw new Error(`insert into ${this.entity.table} returned no key`)
    if (typeof value === 'number' || typeof value === 'bigint') return value
    // int8 以文字返回：安全范围内给 number，超出给 bigint
    const n = Number(value)
    return Number.isSafeInteger(n) ? n : BigInt(String(value))
  }

  toSQL(): Statement[] {
    if (this.rows.length === 0) return []
    const groups = new Map<string, Record<string, unknown>[]>()
    for (const row of this.rows) {
      const props = Object.keys(this.entity.columns).filter((p) => row[p] !== undefined)
      const id = props.join(',')
      let group = groups.get(id)
      if (!group) groups.set(id, (group = []))
      group.push(row)
    }
    return [...groups].map(([id, rows]) => {
      const props = id === '' ? [] : id.split(',')
      if (props.length === 0) throw new Error(`insert into ${this.entity.table} has no values`)
      const w = new SqlWriter()
      const sql = this.ctx.dialect.insert({
        table: this.entity.table,
        columns: props.map((p) => this.entity.columnNames[p]!),
        rows: rows.map((r) => props.map((p) => toNode(r[p], this.entity.columns[p]!.codec))),
      }, w)
      return { sql, params: w.params }
    })
  }
}

/** set 里每列可以是值或表达式（`u.age.plus(1)`） */
export type SetValues<S extends AnySchema, K extends EntityKey<S>> = {
  [C in keyof EntityOf<S, K>['columns']]?: ValueOf<EntityOf<S, K>['columns'][C]> | Expr<ValueOf<EntityOf<S, K>['columns'][C]>>
}

interface WriteState {
  readonly where: readonly ((r: any) => Cond)[]
  readonly all: boolean
}

abstract class Filtered {
  protected readonly ctx: Context
  protected readonly key: string
  protected readonly state: WriteState

  constructor(ctx: Context, key: string, state: WriteState) {
    this.ctx = ctx
    this.key = key
    this.state = state
  }

  /** 新的构建现场：不允许 join（各库对 UPDATE/DELETE 带 JOIN 的写法不一致） */
  protected scope(): { scope: Scope; root: any; where: Node[] } {
    const scope = new Scope(this.ctx.schema, { n: 0 }, false)
    const root = scope.root(this.key)
    const where = this.state.where.map((f) => condNode(f(root))).filter((n): n is Node => n !== undefined)
    if (where.length === 0 && !this.state.all) {
      throw new Error(`refusing to ${this.verb} every row of ${this.ctx.schema.entities[this.key]!.table} without a condition; call .all() if that is intended`)
    }
    return { scope, root, where }
  }

  protected abstract readonly verb: string

  async execute(): Promise<number> {
    return (await execute(this.ctx, this.toSQL())).affected
  }

  abstract toSQL(): Statement
}

export class Updatable<S extends AnySchema, K extends EntityKey<S>> extends Filtered {
  protected readonly verb = 'update'
  private readonly values: ((r: any) => Record<string, unknown>) | undefined

  constructor(ctx: Context, key: K, state: WriteState = { where: [], all: false }, values?: (r: any) => Record<string, unknown>) {
    super(ctx, key, state)
    this.values = values
  }

  set(values: SetValues<S, K> | ((r: Ref<S, K>) => SetValues<S, K>)): Updatable<S, K> {
    const fn = typeof values === 'function' ? values : () => values
    return new Updatable(this.ctx, this.key as K, this.state, fn as (r: any) => Record<string, unknown>)
  }

  where(filter: (r: Ref<S, K>) => Cond): Updatable<S, K> {
    return new Updatable(this.ctx, this.key as K, { ...this.state, where: [...this.state.where, filter] }, this.values)
  }

  all(): Updatable<S, K> {
    return new Updatable(this.ctx, this.key as K, { ...this.state, all: true }, this.values)
  }

  toSQL(): Statement {
    if (!this.values) throw new Error('update needs set(...)')
    const { root, where } = this.scope()
    const entity = this.ctx.schema.entities[this.key]!
    const values = this.values(root)
    const set = Object.entries(values)
      .filter(([, v]) => v !== undefined)
      .map(([p, v]) => {
        const column = entity.columns[p]
        if (!column) throw new Error(`${entity.table} has no column '${p}'`)
        return { column: entity.columnNames[p]!, e: toNode(v, column.codec) }
      })
    if (set.length === 0) throw new Error(`update of ${entity.table} sets no columns`)
    const node = { from: { table: entity.table, alias: root[REF].alias }, set, where }
    checkAliases(node)
    const w = new SqlWriter()
    return { sql: this.ctx.dialect.update(node, w), params: w.params }
  }
}

export class Deletable<S extends AnySchema, K extends EntityKey<S>> extends Filtered {
  protected readonly verb = 'delete'

  constructor(ctx: Context, key: K, state: WriteState = { where: [], all: false }) {
    super(ctx, key, state)
  }

  where(filter: (r: Ref<S, K>) => Cond): Deletable<S, K> {
    return new Deletable(this.ctx, this.key as K, { ...this.state, where: [...this.state.where, filter] })
  }

  all(): Deletable<S, K> {
    return new Deletable(this.ctx, this.key as K, { ...this.state, all: true })
  }

  toSQL(): Statement {
    const { root, where } = this.scope()
    const entity = this.ctx.schema.entities[this.key]!
    const node = { from: { table: entity.table, alias: root[REF].alias }, where }
    checkAliases(node)
    const w = new SqlWriter()
    return { sql: this.ctx.dialect.delete(node, w), params: w.params }
  }
}
