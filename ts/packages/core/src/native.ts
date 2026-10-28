/**
 * 原生 SQL 入口：`db.sql` 与 `db.sql.execute`。用在构建器表达不了的语句上（DDL、方言专有语法、一次性的维护脚本）。
 * ```ts
 * const rows = await db.sql<{ id: number; name: string }>`SELECT id, name FROM t_user WHERE age > ${18} AND id IN (${[1, 2, 3]})`
 * const affected = await db.sql.execute`UPDATE ${db.sql.ident('t_user')} SET age = age + 1 WHERE id = ${id}`
 * ```
 * 插进来的值一律作为绑定参数（数组展开成逗号分隔的多个参数，空数组报错），不会拼进 SQL 文本；表名、列名用 `ident` 包装后按方言加引号。
 * 结果是驱动读出的原始值，没有列 codec：MySQL 的 DECIMAL / BIGINT / 日期是文字，其它库可能是 number / Date，需要类型时在 SQL 里 CAST 或自己转换；
 * 泛型 T 只是你对结果形状的断言，不会被检查。
 */
import { SqlWriter, type Dialect, type Statement } from './dialect.ts'
import { execute, query, type Context } from './session.ts'

/** 需要按方言加引号的标识符（表名、列名）；表名可以带 schema 前缀（a.b） */
export class SqlIdent {
  readonly name: string

  constructor(name: string) {
    this.name = name
  }
}

export interface SqlTag {
  /** 执行查询，返回行 */
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>
  /** 执行写入 / DDL，返回影响的行数 */
  execute(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>
  /** 标识符：`${db.sql.ident('t_user')}` */
  ident(name: string): SqlIdent
}

export function createSqlTag(ctx: Context): SqlTag {
  // async：渲染阶段的错误（undefined、空数组）也走 Promise 的拒绝，调用方只需要一种错误处理方式
  const tag = (async <T>(strings: TemplateStringsArray, ...values: unknown[]) => (await query(ctx, render(ctx.dialect, strings, values))) as T[]) as SqlTag
  tag.execute = async (strings, ...values) => (await execute(ctx, render(ctx.dialect, strings, values))).affected
  tag.ident = (name) => new SqlIdent(name)
  return tag
}

/** 模板 + 值 → 带占位符的语句；导出给单元测试 */
export function render(dialect: Dialect, strings: TemplateStringsArray, values: readonly unknown[]): Statement {
  const w = new SqlWriter()
  let sql = strings[0] ?? ''
  values.forEach((value, i) => {
    sql += bind(dialect, w, value, `\${${i}}`) + (strings[i + 1] ?? '')
  })
  return { sql, params: w.params }
}

function bind(dialect: Dialect, w: SqlWriter, value: unknown, where: string): string {
  if (value instanceof SqlIdent) return dialect.table(value.name)
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error(`db.sql: the array at ${where} is empty; an empty IN (...) list is not valid SQL`)
    return value.map((item) => bind(dialect, w, item, where)).join(', ')
  }
  // undefined 多半是漏传的变量：直接报错，而不是让驱动把它绑成 NULL 或抛出含糊的错误
  if (value === undefined) throw new Error(`db.sql: the value at ${where} is undefined; pass null for NULL`)
  return dialect.bindParam(value === null ? null : dialect.encodeParam(value), w)
}
