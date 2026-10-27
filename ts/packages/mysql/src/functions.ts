/**
 * MySQL 专属函数，与 Java 版同名同形：按列包装，条件返回 Pred、值返回 Expr。
 * ```ts
 * db.queryable(User).where(u => [MySQL.json(u.attrs).contains('"vip"', '$.tags'), MySQL.match(u.name).against('easy')])
 * ```
 * 生成的是带 {@code mysql.} 前缀的函数节点，只有 MySQL 方言的函数表认得；用在别的方言上 toSQL 时报
 * "function 'mysql.json_contains' is not supported by the postgres dialect"。
 */
import { codecs, dialectFn, type Expr, type FunctionRenderer, type Pred } from '@eqts/core'

const fn = (name: string, args: unknown[]): Pred => dialectFn<boolean>(name, args, codecs.boolean)

export type MatchMode = 'natural' | 'boolean' | 'expansion'

const MODES: Record<MatchMode, string> = {
  natural: 'IN NATURAL LANGUAGE MODE',
  boolean: 'IN BOOLEAN MODE',
  expansion: 'WITH QUERY EXPANSION',
}

export const MySQL = {
  json: (column: Expr<unknown>) => ({
    /** 文档（或 path 处）包含 candidate（JSON 文字）：{@code JSON_CONTAINS(col, ?[, ?])} */
    contains: (candidate: string, path?: string) => fn('mysql.json_contains', path === undefined ? [column, candidate] : [column, candidate, path]),
    /** 有共同元素或键值对：{@code JSON_OVERLAPS(col, ?)}（8.0.17+） */
    overlaps: (document: string) => fn('mysql.json_overlaps', [column, document]),
    /** 数组（或 path 处的数组）含有 value：{@code ? MEMBER OF(col)}（8.0.17+） */
    hasMember: (value: string | number, path?: string) => (path === undefined ? fn('mysql.member_of', [value, column]) : fn('mysql.member_of_path', [value, column, path])),
    /** 至少一个 path 存在：{@code JSON_CONTAINS_PATH(col, 'one', ?, …)} */
    containsPath: (...paths: string[]) => fn('mysql.json_contains_path_one', [column, ...nonEmpty(paths)]),
    /** 所有 path 都存在 */
    containsAllPaths: (...paths: string[]) => fn('mysql.json_contains_path_all', [column, ...nonEmpty(paths)]),
  }),
  match: (...columns: Expr<string | null>[]) => ({
    /** 全文匹配（要有 FULLTEXT 索引）：{@code MATCH(cols) AGAINST(? IN NATURAL LANGUAGE MODE)} */
    against: (words: string, mode: MatchMode = 'natural') => fn(`mysql.match_${mode}`, [...nonEmpty(columns), words]),
    /** 相关度，select / orderBy 用 */
    score: (words: string, mode: MatchMode = 'natural') =>
      dialectFn<number>(`mysql.match_${mode}`, [...nonEmpty(columns), words], codecs.double),
  }),
}

function nonEmpty<T>(items: T[]): T[] {
  if (items.length === 0) throw new Error('at least one argument is required')
  return items
}

/** 加进 MySQL 方言的函数表 */
export const mysqlFunctions: Record<string, FunctionRenderer> = {
  'mysql.json_contains': (a) => `JSON_CONTAINS(${a.join(', ')})`,
  'mysql.json_overlaps': (a) => `JSON_OVERLAPS(${a[0]}, ${a[1]})`,
  'mysql.member_of': (a) => `${a[0]} MEMBER OF(${a[1]})`,
  'mysql.member_of_path': (a) => `${a[0]} MEMBER OF(JSON_EXTRACT(${a[1]}, ${a[2]}))`,
  'mysql.json_contains_path_one': (a) => `JSON_CONTAINS_PATH(${a[0]}, 'one', ${a.slice(1).join(', ')})`,
  'mysql.json_contains_path_all': (a) => `JSON_CONTAINS_PATH(${a[0]}, 'all', ${a.slice(1).join(', ')})`,
  ...Object.fromEntries((Object.keys(MODES) as MatchMode[]).map((mode) => [
    `mysql.match_${mode}`,
    (a: string[]) => `MATCH(${a.slice(0, -1).join(', ')}) AGAINST(${a[a.length - 1]} ${MODES[mode]})`,
  ])),
}
