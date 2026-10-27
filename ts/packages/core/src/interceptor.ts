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
import type { Entity } from './schema.ts'

export interface Interceptor {
  /** 用于 noInterceptor(name) */
  readonly name: string
  /** 给这个实体的读、改、删加条件；返回假值表示不加 */
  filter?(ref: AnyRef, entity: Entity): Cond
  /** 插入前补值；row 是这一行的副本，可以直接改 */
  beforeInsert?(row: Record<string, unknown>, entity: Entity): void
  /** 更新前补 set 的值；set 是副本，可以直接改 */
  beforeUpdate?(set: Record<string, unknown>, entity: Entity): void
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
