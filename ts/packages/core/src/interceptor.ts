/**
 * 拦截器：对应 easy-query 的谓词拦截与写入拦截。在 createDb 时注册，作用于所有查询、更新、删除、插入：
 * ```ts
 * createDb({ schema, adapter, interceptors: [tenant('tenantId', () => currentTenant()), touch('updatedAt')] })
 * db.queryable(User).noInterceptor('tenant').toList()   // 单条查询关掉
 * ```
 * 条件会加到主表、多对一导航的 JOIN（ON 里）、一对多导航的子查询与 toList 的第二条查询上。
 */
import type { Node } from './ast.ts'
import { condNode, type Cond } from './expr.ts'
import { refColumn, REF, type AnyRef } from './ref.ts'
import type { ColumnOptions, Entity } from './schema.ts'

/** afterWrite 收到的事件：哪个实体、什么操作、影响了多少行（逻辑删除的 delete 仍然是 'delete'） */
export interface WriteEvent {
  readonly kind: 'insert' | 'update' | 'delete'
  readonly entity: Entity
  readonly affected: number
}

export interface Interceptor {
  /** 用于 noInterceptor(name) */
  readonly name: string
  /** 给这个实体的读、改、删加条件；返回假值表示不加 */
  filter?(ref: AnyRef, entity: Entity): Cond
  /** 插入前补值；row 是这一行的副本，可以直接改 */
  beforeInsert?(row: Record<string, unknown>, entity: Entity): void
  /** 更新前补 set 的值；set 是副本，可以直接改 */
  beforeUpdate?(set: Record<string, unknown>, entity: Entity): void
  /** 写入语句成功执行之后（在同一个事务里）调用：审计日志、发事件、失效缓存。抛错会让这次写入失败（事务里则回滚） */
  afterWrite?(event: WriteEvent): void | Promise<void>
  /** 删除前询问：返回值表示"不要物理删除，改成把这些列更新成这些值"（逻辑删除）；返回 undefined 表示照常删除 */
  deleteAs?(entity: Entity): Record<string, unknown> | undefined
}

/** 某个实体上带有指定选项的列（属性名 + 选项） */
function columnsWith<K extends keyof ColumnOptions>(entity: Entity, option: K): { prop: string; value: NonNullable<ColumnOptions[K]> }[] {
  const found: { prop: string; value: NonNullable<ColumnOptions[K]> }[] = []
  for (const [prop, column] of Object.entries(entity.columns)) {
    const value = column.options[option]
    if (value !== undefined && value !== false) found.push({ prop, value: value as NonNullable<ColumnOptions[K]> })
  }
  return found
}

/** 逻辑删除列的值：deleted 可以是函数（如当前时间），每次用时求值 */
const valueOf = (v: unknown): unknown => (typeof v === 'function' ? (v as () => unknown)() : v)

/**
 * 由列修饰器驱动的内置拦截器，createDb 自动安装（用户的拦截器排在后面）：
 * - defaults：`$default` 在插入时补值、`$onUpdate` 在更新时补值、version 列插入为 0；
 * - softDelete：逻辑删除列的读过滤、插入默认值、delete 改写成 update。可以用 `noInterceptor('softDelete')` 关掉。
 */
export function columnRules(): Interceptor[] {
  const defaults: Interceptor = {
    name: 'defaults',
    beforeInsert: (row, entity) => {
      for (const { prop, value } of columnsWith(entity, 'defaultFn')) if (row[prop] === undefined) row[prop] = value()
      for (const { prop } of columnsWith(entity, 'version')) if (row[prop] === undefined) row[prop] = 0
    },
    beforeUpdate: (set, entity) => {
      for (const { prop, value } of columnsWith(entity, 'onUpdateFn')) if (set[prop] === undefined) set[prop] = value()
    },
  }
  const softDelete: Interceptor = {
    name: 'softDelete',
    filter: (ref, entity) => {
      const found = columnsWith(entity, 'softDelete')[0]
      if (!found) return false
      const column = refColumn(ref, found.prop)
      return found.value.active === null ? column.isNull() : column.eq(found.value.active as never)
    },
    beforeInsert: (row, entity) => {
      const found = columnsWith(entity, 'softDelete')[0]
      if (found && row[found.prop] === undefined) row[found.prop] = found.value.active
    },
    deleteAs: (entity) => {
      const found = columnsWith(entity, 'softDelete')[0]
      return found ? { [found.prop]: valueOf(found.value.deleted) } : undefined
    },
  }
  return [defaults, softDelete]
}

/**
 * 多租户：有 prop 列的实体，读、改、删都加 {@code prop = value()}，插入时没给值就填上 value()。value() 每条语句求值一次。
 */
export function tenant(prop: string, value: () => unknown): Interceptor {
  return {
    name: 'tenant',
    filter: (ref, entity) => prop in entity.columns && refColumn(ref, prop).eq(value() as never),
    beforeInsert: (row, entity) => {
      if (prop in entity.columns && row[prop] === undefined) row[prop] = value()
    },
  }
}

/** 有 prop 列的实体，插入和更新时写入 now()（默认当前时间）；已显式给值时不覆盖 */
export function touch(prop: string, now: () => unknown = () => new Date()): Interceptor {
  const fill = (values: Record<string, unknown>, entity: Entity) => {
    if (prop in entity.columns && values[prop] === undefined) values[prop] = now()
  }
  return { name: `touch:${prop}`, beforeInsert: fill, beforeUpdate: fill }
}

/** 一条语句里生效的拦截器 */
export class Interceptors {
  static readonly none = new Interceptors([])

  private readonly list: readonly Interceptor[]

  constructor(list: readonly Interceptor[]) {
    this.list = list
  }

  without(names: readonly string[]): Interceptors {
    return names.length === 0 ? this : new Interceptors(this.list.filter((i) => !names.includes(i.name)))
  }

  /** 这张表引用上的附加条件 */
  filters(ref: AnyRef, entity: Entity): Node[] {
    const nodes: Node[] = []
    for (const interceptor of this.list) {
      const n = interceptor.filter ? condNode(interceptor.filter(ref, entity)) : undefined
      if (n) nodes.push(n)
    }
    return nodes
  }

  async afterWrite(event: WriteEvent): Promise<void> {
    for (const interceptor of this.list) await interceptor.afterWrite?.(event)
  }

  /** 这个实体的 delete 要不要改写成 update：返回要更新的列，undefined 表示物理删除 */
  deleteAsUpdate(entity: Entity): Record<string, unknown> | undefined {
    let set: Record<string, unknown> | undefined
    for (const interceptor of this.list) {
      const part = interceptor.deleteAs?.(entity)
      if (part) set = { ...set, ...part }
    }
    return set
  }

  beforeInsert(row: Record<string, unknown>, entity: Entity): Record<string, unknown> {
    const copy = { ...row }
    for (const interceptor of this.list) interceptor.beforeInsert?.(copy, entity)
    return copy
  }

  beforeUpdate(set: Record<string, unknown>, entity: Entity): Record<string, unknown> {
    const copy = { ...set }
    for (const interceptor of this.list) interceptor.beforeUpdate?.(copy, entity)
    return copy
  }
}

/** 表引用的实体 */
export function refEntity(ref: AnyRef): Entity {
  const info = ref[REF]
  return info.schema.entities[info.key]!
}
