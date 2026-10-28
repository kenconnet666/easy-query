/**
 * HANA 专属函数，与 Java 版同名同形：
 * ```ts
 * db.queryable(Doc).where(d => Hana.text(d.title, d.body).fuzzy('easy qurey', 0.8)).orderBy(d => Hana.text(d.title).score().desc())
 * ```
 * 列上要有 FULLTEXT INDEX，否则 CONTAINS 按整列值匹配。生成带 {@code hana.} 前缀的函数节点，别的方言 toSQL 时报不支持。
 */
import { codecs, dialectFn, type Expr, type FunctionRenderer, type Pred } from '@zerodep-dev/easy-query-ts'

export const Hana = {
  text: (...columns: Expr<string | null>[]) => {
    if (columns.length === 0) throw new Error('Hana.text needs at least one column')
    return {
      /** EXACT：按词，支持 "短语"、OR、-排除、* */
      contains: (query: string): Pred => dialectFn<boolean>('hana.contains', [...columns, query], codecs.boolean),
      /** 容错匹配，threshold 0–1（写进 SQL） */
      fuzzy: (query: string, threshold: number): Pred => {
        if (!(threshold >= 0 && threshold <= 1)) throw new RangeError(`fuzzy threshold must be between 0 and 1, got ${threshold}`)
        return dialectFn<boolean>('hana.contains_fuzzy', [...columns, query, { k: 'lit', sql: String(threshold) }], codecs.boolean)
      },
      /** 本查询里 CONTAINS 的相关度 */
      score: () => dialectFn<number>('hana.score', [], codecs.double),
    }
  },
}

const columnList = (cols: string[]) => (cols.length === 1 ? cols[0]! : `(${cols.join(', ')})`)

/** 加进 HANA 方言的函数表 */
export const hanaFunctions: Record<string, FunctionRenderer> = {
  // 通用函数里与标准写法不同的部分（HANA 的 LOCATE 参数顺序是 字符串、子串）
  index_of: (a) => `(LOCATE(${a[0]}, ${a[1]}) - 1)`,
  add_days: (a) => `ADD_DAYS(${a[0]}, ${a[1]})`,
  add_months: (a) => `ADD_MONTHS(${a[0]}, ${a[1]})`,
  diff_days: (a) => `DAYS_BETWEEN(${a[1]}, ${a[0]})`,
  cast_string: (a) => `CAST(${a[0]} AS NVARCHAR(5000))`,
  cast_double: (a) => `CAST(${a[0]} AS DOUBLE)`,
  'hana.contains': (a) => `CONTAINS(${columnList(a.slice(0, -1))}, ${a[a.length - 1]})`,
  'hana.contains_fuzzy': (a) => `CONTAINS(${columnList(a.slice(0, -2))}, ${a[a.length - 2]}, FUZZY(${a[a.length - 1]}))`,
  'hana.score': () => 'SCORE()',
}
