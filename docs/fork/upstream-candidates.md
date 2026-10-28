# 可回馈上游的改动

由用户去 dromara/easy-query 开 PR。每项写的是 fork 的 squash 提交，从 `upstream/main` 开分支后 `git cherry-pick <提交>`，再去掉 `docs/fork`、`sql-fork-test` 的部分（上游没有这两个目录；测试可改写进 `sql-test`）。

提交按依赖顺序排列；标"依赖"的要先合前一项。

## 一类：缺陷修复，改动小，建议先提

| 提交 | 内容 | 上游文件 |
|---|---|---|
| `542c6a604`（部分） | 窗口函数 `PARTITION BY x` 与 `ORDER BY` 之间缺空格，不加引号的方言出错 | `ColumnObjectFunctionAvailable` |
| `7d9a88516` | `Instant` / `OffsetDateTime` / `ZonedDateTime` 算基本类型（之前被当成实体） | `EasyClassUtil` |

## 二类：独立的小能力

| 提交 | 内容 | 依赖 |
|---|---|---|
| `4244b02e0` | APT / KSP 给 `Instant` / `OffsetDateTime` / `ZonedDateTime` 生成日期时间列 | `7d9a88516` |
| `542c6a604`（部分） | `asJSONArray().size()` 暴露已有的 `jsonArrayLength` | — |
| `22f9e4810` | `nullIf`、`eqNullSafe`（MySQL `<=>`、PG `IS NOT DISTINCT FROM`） | — |
| `dc897847e` | `dateTrunc`（MySQL、PG、HANA；其它方言抛不支持） | HANA 部分依赖 `41b9bdf5b` |
| `c7246a229` | `forUpdateNoWait` / `forUpdateSkipLocked`（DB2 明确拒绝） | HANA 部分依赖 `41b9bdf5b` |
| `988217703` | `JsonValueConverter` + `JsonCodec` SPI，starter 有 Jackson 时自动注册 | — |

## 三类：改了 core 结构，先和作者讨论

| 提交 | 内容 | 说明 |
|---|---|---|
| `3b218635d` | 窗口 frame（ROWS / RANGE）、全局窗口、NTILE / PERCENT_RANK / CUME_DIST | 8 个 `*OverSQLFunction` 合成 `OverSQLFunction`，删了上游的类 |
| `a8dc19d2d` | `rollup()` / `cube()` / `grouping()` | `QueryExpressionBuilder` 加了 grouping 状态 |
| `b7c18103d` + `88ce3eb98` | `TableNameMapping`（作用域内换表）、`InsertSelect` | 新概念，见 decisions/0003 |

## 四类：新模块与方言入口（约定先要作者认可）

| 提交 | 内容 | 说明 |
|---|---|---|
| `b26301f2f` | 方言静态入口约定与 `DialectExpressions`、能力标记；MySQL JSON / 全文、PG jsonb | 见 decisions/0001；`sql-api-proxy` 以 provided 依赖进方言模块 |
| `b1e15ffeb`、`4aa04f463`、`f2f84b46a` | MySQL JSON 路径与 `edit`、PG jsonb `edit` / 数组 / 全文、`PgSQL.returning` | 依赖 `b26301f2f` |
| `41b9bdf5b` + `66c6aa7f6` | SAP HANA 方言模块（含 starter、solon 接入） | 新模块，可整体提 |
| `36fe43062` | `Hana.text` 全文检索 | 依赖 `41b9bdf5b`、`b26301f2f` |

## 不回馈

- `7afc93b66` 的 CI、`infra/dev`、`tools/`、`docs/fork`、`sql-fork-test`：fork 自己的工程设施（Maven wrapper 可以单独问作者要不要）。
- `ts/`：TS 版。
- `MySQL8Test3` 的断言改动（`542c6a604` 里）随窗口空格修复一起提，不单独提。
