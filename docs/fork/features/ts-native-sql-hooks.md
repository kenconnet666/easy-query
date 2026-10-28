# TS：原生 SQL（`db.sql`）与执行钩子（`onExecute`）

## 原生 SQL

构建器表达不了的语句（DDL、方言专有语法、一次性的维护脚本）：

```ts
const rows = await db.sql<{ id: number; name: string }>`
  SELECT id, name FROM t_user WHERE age > ${18} AND id IN (${[1, 2, 3]})`
const affected = await db.sql.execute`UPDATE ${db.sql.ident('t_user')} SET age = age + 1 WHERE id = ${id}`
```

- 插进来的值**一律是绑定参数**，不会拼进 SQL 文本；数组展开成逗号分隔的多个参数（空数组报错，因为 `IN ()` 不是合法 SQL）；`null` 绑成 NULL；`undefined` 报错（多半是漏传的变量）。
- 表名、列名用 `db.sql.ident('名字')`，按方言加引号（支持 `schema.table`）。各库对不加引号的名字处理不同（HANA 折成大写），要跨库就用 `ident`。
- 日期、布尔等的编码与构建器一致（`Date` 按 UTC 文字，SQLite / MySQL 的布尔写 1 / 0）。
- 事务里用 `tx.sql`。
- 结果是**驱动读出的原始值**，没有列 codec：MySQL 的 DECIMAL / BIGINT / 日期是文字，其它库可能是 number / Date。泛型只是你对形状的断言，不会被检查。

## 执行钩子

```ts
const db = createDb({
  schema, adapter,
  log: s => console.log(s.sql),                              // 执行前，最简单的日志
  onExecute: e => {                                          // 执行后（成功与失败都会）
    metrics.timing('db', e.durationMs, { kind: e.kind, ok: e.error === undefined })
    if (e.durationMs > 500) logger.warn('slow sql', e.statement.sql, e.statement.params)
  },
})
```

`ExecutionEvent`：`statement`、`kind`（`query` 读 / `execute` 写）、`durationMs`、`rows`（读返回的行数 / 写影响的行数，失败为 0）、`error`（失败时的错误，错误仍会照常抛给调用方）。构建器、`db.sql`、事务里的语句都经过同一个钩子。钩子里抛错会让这条语句失败（不吞错）。

对应 Java 的 `JdbcExecutorListener`；链路追踪（OpenTelemetry）可以在这里接，不需要核心依赖它。

## 验证

SQLite、MySQL 8.0.18 / 8.4、PG 17 实测；HANA 未跑。
