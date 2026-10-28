# easy-query fork 文档索引

fork 自 [dromara/easy-query](https://github.com/dromara/easy-query)，软 fork：持续合并上游，新能力尽量放新文件、新模块。工作约定见仓库根的 [CLAUDE.md](../../CLAUDE.md)。

## 先读

| 文档 | 内容 |
|---|---|
| [HANDOFF.md](HANDOFF.md) | 换机器 / 换人接手：环境怎么搭、哪些东西只在本机 |
| [ROADMAP.md](ROADMAP.md) | 里程碑与工作项 |
| [STATUS.md](STATUS.md) | 当前进度、待决 |
| [BACKLOG.md](BACKLOG.md) | 记下但暂不做的边角情况 |
| [baseline.md](baseline.md) | 上游测试基线与运行记录 |
| [upstream-candidates.md](upstream-candidates.md) | 可单独回馈上游的改动 |
| [flow.md](flow.md) | 真实使用方 flow 的验收记录 |

## 设计决定

- [0001 方言静态入口](decisions/0001-dialect-entry.md)：`MySQL.json(col)…`、能力标记、错方言报错
- [0002 TS 版设计](decisions/0002-ts-design.md)
- [0003 TableNameMapping](decisions/0003-table-name-mapping.md)

## 特性（Java）

| 特性 | 页面 |
|---|---|
| 方言专属函数（MySQL JSON / 全文、PG jsonb / 数组 / 全文、HANA 全文）与自写扩展 | [dialect-functions.md](features/dialect-functions.md) |
| SAP HANA 方言 | [hana.md](features/hana.md) |
| `Instant` / `OffsetDateTime` / `ZonedDateTime` 列 | [zoned-time-columns.md](features/zoned-time-columns.md) |
| MySQL 8.0.18（PolarDB）兼容审计 | [mysql-8018.md](features/mysql-8018.md) |
| 作用域内换表（热表 / 归档） | [table-name-mapping.md](features/table-name-mapping.md) |
| `INSERT … SELECT` | [insert-select.md](features/insert-select.md) |
| JSON 列转换器（JsonCodec SPI） | [json-converter.md](features/json-converter.md) |
| 窗口 frame、全局窗口、NTILE 等 | [window.md](features/window.md) |
| `rollup()` / `cube()` / `grouping()` | [grouping.md](features/grouping.md) |
| null 安全比较、`nullIf` | [null-safe.md](features/null-safe.md) |
| `dateTrunc` | [date-trunc.md](features/date-trunc.md) |
| PG `RETURNING` | [returning.md](features/returning.md) |
| `forUpdateNoWait` / `forUpdateSkipLocked` | [lock-wait.md](features/lock-wait.md) |

## TS 版

[ts/README.md](../../ts/README.md)：`@eqts/core` 与 sqlite、mysql、pg、hana 四个适配包。

## 代码在哪

- 方言入口：`sql-db-support/sql-{mysql,pgsql,hana}/…/{MySQL,PgSQL,Hana}.java` 与同模块的 `proxy/` 包
- HANA 方言：`sql-db-support/sql-hana`
- fork 测试：`sql-fork-test`（SQL 文本断言进 CI，`-Plive` 连本地库）
- 本地测试库：`infra/dev`；上游基线脚本：`tools/upstream-baseline`

## 特性（TS 版，`ts/`）

| 特性 | 页面 |
|---|---|
| 根查询聚合、数值算术、批量插入分块 | [ts-aggregates-arithmetic.md](features/ts-aggregates-arithmetic.md) |
| `caseWhen` 与字符串 / 数学 / 日期 / `cast` 函数 | [ts-functions.md](features/ts-functions.md) |
| 列类型：decimal.js、64 位整数、`@internationalized/date`、二进制，与 json-wire 对接，扩展点 | [ts-column-types.md](features/ts-column-types.md) |
| 原生 SQL `db.sql`、执行钩子 `onExecute` | [ts-native-sql-hooks.md](features/ts-native-sql-hooks.md) |
| `in(子查询)`、派生表 `asTable()`、`union`、CTE 与递归 CTE | [ts-subqueries.md](features/ts-subqueries.md) |
| 多对多导航（经中间表）与复合外键 | [ts-relations.md](features/ts-relations.md) |
| 显式 join（innerJoin / leftJoin，多表 lambda、自连接、分组聚合） | [ts-joins.md](features/ts-joins.md) |
| 独立测试模块 `@eqts/test` | [ts/packages/test/README.md](../../ts/packages/test/README.md) |
