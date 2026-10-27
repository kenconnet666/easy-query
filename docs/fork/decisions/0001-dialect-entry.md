# 0001 方言专属函数的入口

状态：已采纳（2026-10-27，用户选定写法；M1.1 实现）。

## 问题

上游的类型化列函数写在固定接口的 default 方法里（`ColumnStringFunctionAvailable` 等），对所有方言可见。要加一个只有某个库才有的函数，要么改通用接口（补全里混进各库的方法，错方言到运行时才报），要么用 `rawSQLStatement`（没有类型、不能链式）。

## 决定

- **按列包装的静态入口，放在方言模块里**：`MySQL.json(u.attrs()).contains("\"vip\"", "$.tags")`、`PgSQL.jsonb(u.attrs()).hasKey("tags")`、`MySQL.match(u.title()).against("easy")`。入口类 `com.easy.query.<db>.<Db>`，视图类在 `com.easy.query.<db>.proxy`。
- **条件方法是语句**（void，加到当前 where / having / on，受 or 分组约束），与 `u.name().eq(..)` 一致；得到值的方法（如全文的 `score`）返回类型化表达式，可放 select、orderBy、继续链式。不让条件方法返回值：在 where 里写成语句时返回值会被静默丢掉，条件就没了。
- **方言标记**：方言在自己的 `DatabaseConfiguration` 里注册一个标记类（`MySQLDialectMarker`、`PgSQLDialectMarker`），入口构造表达式时检查，用在别的方言上立刻报 `UnsupportedOperationException`（消息含函数名与当前方言）。兼容的方言注册同一个标记即可共用。标记类不依赖代理 API。
- **一个公共工具**：`sql-api-proxy` 的 `DialectExpressions`（`require`、`predicate`、`bool`、`string`、`number`）。内置入口与用户自写的扩展都只用它，写法没有差别。列参数用上游现成的 `PropTypeColumn.acceptAnyValue`（列、列函数原样引用，其余写成 `?` 参数）。
- **依赖**：方言模块以 `provided` 依赖 `sql-api-proxy`。用代理 API 的项目本来就有；只用 client API 的项目不加载这些类。
- **不改 core**；对上游已有文件的改动只有：两个方言 pom 加依赖、两个 `DatabaseConfiguration` 各加一行注册。

## 不做

- 与已有能力重叠的函数：读 JSON 值（`asJSONObject().getString(..)`）、`JSON_CONTAINS_PATH`（`containsKey`）不进入口。
- 函数注册表 / SPI：第三个变化点出现前不加。

## 验证

`sql-fork-test`：`DialectEntrySqlTest`（where、or 分组、隐式子查询、select、orderBy、错方言、用户自写函数）；`live` 包在 MySQL 8.4、MySQL 8.0.18、PG 17 实库执行。
