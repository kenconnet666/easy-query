/**
 * SQL 语法树。查询构建器产出它，方言（Dialect）把它渲染成 SQL 文本；与具体数据库无关。
 */
import type { Codec } from './schema.ts'

export type Node =
  | { readonly k: 'col'; readonly alias: string; readonly name: string }
  /** 绑定参数；codec 是与它比较的列的编码（例如 Date → UTC 文字） */
  | { readonly k: 'param'; readonly value: unknown; readonly codec: Codec<any> | undefined }
  /** 受信任的 SQL 片段（数字常量、NULL 等），不来自用户输入 */
  | { readonly k: 'lit'; readonly sql: string }
  /** sql`...` 标签模板：parts 是文字，args 插在其间 */
  | { readonly k: 'raw'; readonly parts: readonly string[]; readonly args: readonly Node[] }
  | { readonly k: 'op'; readonly op: BinaryOp; readonly l: Node; readonly r: Node }
  | { readonly k: 'and' | 'or'; readonly items: readonly Node[] }
  | { readonly k: 'not'; readonly e: Node }
  | { readonly k: 'null'; readonly e: Node; readonly not: boolean }
  | { readonly k: 'in'; readonly e: Node; readonly list: readonly Node[]; readonly not: boolean }
  /** e [NOT] IN (子查询)；子查询是独立的语句，不引用外层的表 */
  | { readonly k: 'in_sub'; readonly e: Node; readonly q: SelectNode; readonly not: boolean }
  | { readonly k: 'between'; readonly e: Node; readonly lo: Node; readonly hi: Node }
  /** LIKE；pattern 已经转义过 % _ \ 并加好通配符 */
  | { readonly k: 'like'; readonly e: Node; readonly pattern: Node; readonly not: boolean }
  /** 方言函数表里的函数（upper、year …），由方言决定写法 */
  | { readonly k: 'fn'; readonly name: string; readonly args: readonly Node[] }
  | { readonly k: 'agg'; readonly fn: AggregateFn; readonly arg: Node | undefined; readonly distinct: boolean }
  | { readonly k: 'case'; readonly when: readonly (readonly [Node, Node])[]; readonly else: Node | undefined }
  | { readonly k: 'exists'; readonly q: SelectNode; readonly not: boolean }
  /** 窗口函数：fn OVER (PARTITION BY … ORDER BY … frame) */
  | { readonly k: 'over'; readonly fn: Node; readonly partition: readonly Node[]; readonly order: readonly OrderNode[]; readonly frame: string | undefined }
  /** 标量子查询 */
  | { readonly k: 'sub'; readonly q: SelectNode }

export type BinaryOp = '=' | '<>' | '>' | '>=' | '<' | '<=' | '+' | '-' | '*' | '/'
export type AggregateFn = 'count' | 'sum' | 'avg' | 'max' | 'min'

export interface TableRef {
  readonly table: string
  readonly alias: string
  /** 派生表：FROM (子查询) alias；有它时 table 不用 */
  readonly sub?: SelectNode
}

export interface Join extends TableRef {
  /** 连接方式；省略为 left（导航产生的隐式 join 都是 left） */
  readonly kind?: 'inner' | 'left'
  readonly on: Node
}

export interface OrderNode {
  readonly e: Node
  readonly desc: boolean
}

export interface SelectNode {
  readonly from: TableRef
  readonly joins: readonly Join[]
  readonly where: readonly Node[]
  readonly groupBy: readonly Node[]
  readonly having: readonly Node[]
  readonly orderBy: readonly OrderNode[]
  /** 为空时渲染为 SELECT 1 */
  readonly columns: readonly { readonly e: Node; readonly as: string }[]
  readonly distinct: boolean
  readonly limit: number | undefined
  readonly offset: number | undefined
  readonly forUpdate: boolean
  /** 复合查询：本查询 UNION [ALL] 后面这些；各成员不带 orderBy / limit / offset（需要时包一层派生表） */
  readonly unions?: readonly { readonly all: boolean; readonly q: SelectNode }[] | undefined
  /** 本语句用到的 CTE（WITH），只放在最外层的语句上，按依赖顺序排好 */
  readonly ctes?: readonly CteNode[] | undefined
}

/** WITH [RECURSIVE] name (columns) AS (q) */
export interface CteNode {
  readonly name: string
  readonly recursive: boolean
  readonly columns: readonly string[]
  readonly q: SelectNode
}

export interface InsertNode {
  readonly table: string
  readonly columns: readonly string[]
  readonly rows: readonly (readonly Node[])[]
  readonly conflict: ConflictNode | undefined
}

/** upsert：target 列冲突时，update 为空表示忽略这一行，否则用新值更新这些列 */
export interface ConflictNode {
  readonly target: readonly string[]
  readonly update: readonly string[]
}

export interface UpdateNode {
  readonly from: TableRef
  readonly set: readonly { readonly column: string; readonly e: Node }[]
  readonly where: readonly Node[]
}

export interface DeleteNode {
  readonly from: TableRef
  readonly where: readonly Node[]
}

/** 访问一棵树里引用到的表别名与声明的表别名，用来发现跨查询误用的导航 */
export function checkAliases(q: SelectNode | UpdateNode | DeleteNode, outer: ReadonlySet<string> = new Set()): void {
  const declared = new Set(outer)
  declared.add(q.from.alias)
  // 派生表是独立的语句：只能引用它自己声明的表
  if (q.from.sub) checkAliases(q.from.sub)
  // 复合查询的每个成员都是独立的语句
  if ('unions' in q) q.unions?.forEach((u) => checkAliases(u.q))
  const joins = 'joins' in q ? q.joins : []
  for (const j of joins) declared.add(j.alias)
  const visit = (n: Node): void => {
    switch (n.k) {
      case 'col':
        if (!declared.has(n.alias)) {
          throw new Error(`column ${n.alias}.${n.name} belongs to a table that is not part of this statement; a navigation from an outer query was used where only the current one is available (e.g. inside toList() filters or an update/delete)`)
        }
        return
      case 'param': case 'lit': return
      case 'raw': n.args.forEach(visit); return
      case 'op': visit(n.l); visit(n.r); return
      case 'and': case 'or': n.items.forEach(visit); return
      case 'not': case 'null': visit(n.e); return
      case 'in': visit(n.e); n.list.forEach(visit); return
      case 'in_sub': visit(n.e); checkAliases(n.q); return
      case 'between': visit(n.e); visit(n.lo); visit(n.hi); return
      case 'like': visit(n.e); visit(n.pattern); return
      case 'fn': n.args.forEach(visit); return
      case 'agg': if (n.arg) visit(n.arg); return
      case 'case': n.when.forEach(([w, t]) => { visit(w); visit(t) }); if (n.else) visit(n.else); return
      case 'over': visit(n.fn); n.partition.forEach(visit); n.order.forEach((o) => visit(o.e)); return
      case 'exists': case 'sub': checkAliases(n.q, declared); return
    }
  }
  for (const j of joins) visit(j.on)
  q.where.forEach(visit)
  if ('set' in q) q.set.forEach((s) => visit(s.e))
  if ('columns' in q) {
    q.columns.forEach((c) => visit(c.e))
    q.groupBy.forEach(visit)
    q.having.forEach(visit)
    q.orderBy.forEach((o) => visit(o.e))
  }
}
