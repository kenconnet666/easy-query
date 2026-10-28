/**
 * PostgreSQL 专属函数，与 Java 版同名同形（Java 的 PgSQL.* 在这里叫 Pg.*）：
 * ```ts
 * db.queryable(User).where(u => [Pg.jsonb(u.attrs).contains('{"vip":true}'), Pg.array(u.tags).has('java')])
 * db.queryable(Post).where(p => Pg.fulltext(p.body).matches('easy -jdbc')).orderBy(p => Pg.fulltext(p.body).rank('easy').desc())
 * ```
 * 生成带 {@code pg.} 前缀的函数节点，只有 PG 方言认得；用在别的方言上 toSQL 时报不支持。
 */
import { and, codecs, dialectFn, or, type Expr, type FunctionRenderer, type Node, type Pred } from '@zerodep-dev/easy-query-ts'

const pred = (name: string, args: unknown[]): Pred => dialectFn<boolean>(name, args, codecs.boolean)

/** 文本搜索配置名写进 SQL（要与表达式索引一致才走索引），所以只接受标识符 */
function config(name: string): Node {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`text search config must be an identifier, got ${name}`)
  return { k: 'lit', sql: `'${name}'` }
}

export const Pg = {
  jsonb: (column: Expr<unknown>) => ({
    /** 包含 document（JSON 文字）：{@code col::jsonb @> ?::jsonb} */
    contains: (document: string) => pred('pg.jsonb_contains', [column, document]),
    containedBy: (document: string) => pred('pg.jsonb_contained_by', [column, document]),
    /** 顶层有这个键：{@code jsonb_exists(col::jsonb, ?)}（不用 ? 运算符，避免与占位符混淆） */
    hasKey: (key: string) => pred('pg.jsonb_exists', [column, key]),
  }),
  array: (column: Expr<unknown>) => {
    const has = (value: unknown) => pred('pg.any', [value, column])
    return {
      /** 含有 value：{@code ? = ANY(col)} */
      has,
      hasAll: (...values: unknown[]) => and(...values.map(has)),
      hasAny: (...values: unknown[]) => or(...values.map(has)),
      /** 元素个数：{@code cardinality(col)} */
      length: () => dialectFn<number | null>('pg.cardinality', [column], codecs.int),
    }
  },
  /** 全文检索；config 默认 'simple'（只按空白与标点分词），英文可用 'english' */
  fulltext: (column: Expr<string | null>, cfg = 'simple') => ({
    /** websearch_to_tsquery 语法：{@code a b}、{@code "a b"}、{@code a or b}、{@code -a} */
    matches: (query: string) => pred('pg.ts_match', [config(cfg), column, query]),
    rank: (query: string) => dialectFn<number>('pg.ts_rank', [config(cfg), column, query], codecs.double),
  }),
}

/** 加进 PG 方言的函数表 */
export const pgFunctions: Record<string, FunctionRenderer> = {
  'pg.jsonb_contains': (a) => `(${a[0]})::jsonb @> (${a[1]})::jsonb`,
  'pg.jsonb_contained_by': (a) => `(${a[0]})::jsonb <@ (${a[1]})::jsonb`,
  'pg.jsonb_exists': (a) => `jsonb_exists((${a[0]})::jsonb, ${a[1]})`,
  'pg.any': (a) => `${a[0]} = ANY(${a[1]})`,
  'pg.cardinality': (a) => `cardinality(${a[0]})`,
  'pg.ts_match': (a) => `to_tsvector(${a[0]}, ${a[1]}) @@ websearch_to_tsquery(${a[0]}, ${a[2]})`,
  'pg.ts_rank': (a) => `ts_rank(to_tsvector(${a[0]}, ${a[1]}), websearch_to_tsquery(${a[0]}, ${a[2]}))`,
}
