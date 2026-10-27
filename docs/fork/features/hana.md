# SAP HANA 方言

模块 `sql-db-support/sql-hana`（`com.easy-query:sql-hana`），HANA 2.0。JDBC 驱动 `com.sap.cloud.db.jdbc:ngdbc` 由应用引入（实测 2.30.11；IDEA 自带的 2.17 会报 `getSubject is not supported`）。

```java
EasyQueryBootstrapper.defaultBuilderConfiguration()
    .setDefaultDataSource(dataSource)
    .useDatabaseConfigure(new HanaDatabaseConfiguration())
    .build();
```

Spring Boot / Solon：`easy-query.database=hana`。

## 与核心默认写法不同的地方

| 能力 | HANA 上的 SQL |
|---|---|
| 标识符 | 双引号；easy-query 总加引号，表名列名按实体写的大小写原样 |
| 分页、FOR UPDATE | `LIMIT n OFFSET m`、`FOR UPDATE`（同核心） |
| 插入或更新 / 忽略（`onConflictThen`） | `MERGE INTO … USING (SELECT ? AS … FROM DUMMY) …`；冲突列默认主键 |
| 带关联表的更新 | 按主键对应的 `MERGE`（要求实体有主键；关联出多行时报错而不是多次赋值） |
| 带关联表的删除 | `DELETE … WHERE EXISTS (SELECT 1 FROM DUMMY … JOIN …)` |
| 隐式子查询 any / none / anyValue | `EXISTS(SELECT 1 …)`，去掉 LIMIT（HANA 不允许关联子查询带 LIMIT） |
| 拼接、LIKE 的模式 | `||` |
| indexOf / subString / length | `LOCATE(文字, 子串) - 1` / `SUBSTRING` / `LENGTH` |
| nullOrDefault | `COALESCE` |
| 字符串聚合 joining | `STRING_AGG(值, 分隔符[ ORDER BY …])` |
| 多列极值 | `GREATEST` / `LEAST`，先用 COALESCE 补掉 NULL |
| SELECT 里的布尔值 | `CASE WHEN … THEN TRUE WHEN NOT (…) THEN FALSE ELSE NULL END` |
| 当前时间 | `CURRENT_TIMESTAMP`、`CURRENT_UTCTIMESTAMP` |
| 日期加减 | `ADD_DAYS / ADD_MONTHS / ADD_YEARS / ADD_SECONDS / ADD_NANO100` |
| 间隔 duration | `NANO100_BETWEEN`，整单位向零截断（同 MySQL 的 TIMESTAMPDIFF） |
| 格式化 format | Java 模式翻译成 `TO_NVARCHAR(值, 'YYYY-MM-DD HH24:MI:SS')`；中文等字面量用 `||` 拼 |
| 数学 | `LN`、`LOG(10, x)`、`POWER`、`CEIL`、截断 `ROUND(x, 0, ROUND_DOWN)` |
| 类型转换 cast | `BOOLEAN / SMALLINT / INTEGER / BIGINT / REAL / DOUBLE / DECIMAL(36,18) / DATE / TIME / TIMESTAMP`；转文字用 `TO_NVARCHAR`（不截短 NCLOB） |
| JSON 取值 | `JSON_VALUE(x, '$.a')`、`JSON_QUERY(x, '$.a')` |

都在 HANA 2.00.088 实库上跑过（`sql-fork-test` 的 `live.HanaDialectLiveTest`），生成的 SQL 固定在 `dialect.HanaSqlTest`。

## 限制（明确报错，不悄悄生成错的 SQL）

- 没有可插入的列的 INSERT：HANA 不接受任何零列插入写法。
- `joining(..., distinct = true)`：STRING_AGG 没有 DISTINCT，先在子查询里去重。
- JSON 数组长度（`asJSONArray().size()`）：HANA 没有对应函数。
- 按顺序取第一个的关联标量子查询（带 ORDER BY … LIMIT 1）：HANA 本身不支持，数据库报 309。
- 带格式的日期只认 yyyy yy MM dd HH hh mm ss S…（≤7 位） a 和单字母 M d H m s；其余模式字母报错。
- `length` / `indexOf` / `subString` 按 UTF-16 单元计，emoji 等补充字符与 MySQL 的按字符计数不同。

## 还没做（M2 后半）

生成键回填（`CURRENT_IDENTITY_VALUE()`）、时间按 UTC 绑定、LOB 的流式读写、迁移 DDL（`CREATE COLUMN TABLE` 等）。
