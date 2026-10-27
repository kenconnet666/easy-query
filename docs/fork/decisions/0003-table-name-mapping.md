# 0003 查询里把实体换到别的表（热表 / 归档表）

状态：已采纳（2026-10-28，M3.1）。

## 问题

`asTable` 只改"最近的一张表"。导航的隐式 join、隐式子查询（any / none / count）、include 与 selectAutoInclude 单独拉取的关联查询，用的仍是实体的默认表。flow 读归档数据时因此要：手工按编号再查一次归档表补上实体、把导航改写成 exists 子查询、每条查询都写 `Archives.from(db, X, archived)`。

## 比较过的做法

| 做法 | 能覆盖 | 代价 |
|---|---|---|
| 渲染时经 `SQLRewriteUnit` 改表名（分表用的那条路） | 同一次 toSQL 里的表 | 改写单元在执行阶段按表实例生成，要把用户的映射穿过执行链；include 是另一次执行，覆盖不到 |
| 替换 `ExpressionBuilderFactory` 或拦截器，在建表时设 tableNameAs | 主表、隐式 join | 隐式子查询、include 各自新建 queryable，要逐处传；和 asTable 抢同一个字段 |
| **作用域（当前线程）+ 生成表名处查一次** | 主表、隐式 join、隐式子查询、include / selectAutoInclude（都在同一个终结方法里执行） | 映射跟着线程，要在作用域内执行完 |

## 决定

- `TableNameMapping`（sql-core）：不可变的"实体 → 表名"，`call(Supplier)` / `run(Runnable)` / `open()`（try-with-resources）。嵌套时内层覆盖外层同一实体。
- `TableSQLExpressionImpl.getTableName()` 在没有 `tableNameAs`（显式 asTable、分表路由都写在这里）时查当前映射——对上游的改动只有这一处。
- 跟着线程与 easy-query 的事务一致；要在作用域内执行完终结方法（toList、count、firstOrNull…）。

## 不做

- 每条查询上的 `.tableMapping(m)`：要把映射传进 include 等后续查询，第一版用作用域已覆盖 flow 的用法，等有第二个使用方再说。
- 映射 schema：目前只换表名。

## 验证

`mapping.TableNameMappingSqlTest`（主表、隐式 join、隐式子查询、select 里的子查询、只映射部分实体、asTable 优先、嵌套与恢复）；`live.TableNameMappingLiveTest`（MySQL 8.0.18：include 拉取的关联也读归档表）。
