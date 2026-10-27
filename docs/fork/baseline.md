# 上游测试基线（easy-query 3.3.1）

上游的用例在 `sql-test/src/main/java`（JUnit 4），`mvn test` 扫不到，也没有跑测试的 CI。fork 的改动要拿它们做回归，分两层：

| 层 | 范围 | 怎么跑 | 3.3.1 基线 |
|---|---|---|---|
| CI | 不连任何外部库的 13 个类（SQL 文本断言、H2 内存库） | `sql-fork-test` 的 `UpstreamNoDatabaseSuite`，随 `mvnw install` 自动跑 | 201 / 201 通过 |
| 本地实库 | 其余 142 个类里能在本机跑的 | `bash tools/upstream-baseline/run.sh`（要先起 `infra/dev` 的 MySQL、PG、Redis） | 2125 例执行：通过 2080、失败 33、异常 24；另有 12 个类初始化失败（约 156 例没跑到） |

稳定的非通过清单：[tools/upstream-baseline/known-failures-3.3.1.tsv](../../tools/upstream-baseline/known-failures-3.3.1.tsv)。`run.sh` 最后列出"基线里没有的新失败"，只看这一段。

## 失败的原因（都与 fork 无关）

1. **本机没有的库**：SQL Server（1433）、达梦（5236）的类初始化失败；ClickHouse 用例的连接串被上游写成了达梦的；SQLite 用例写死了作者 mac 上的路径；ShardingTest 要的 `t_topic_sharding_ds` 上游脚本里没有。
2. **上游自己的断言漂移**：H2 的 DDL 空白差异（`H2QueryTest.testDDL/testDDL2`、`H2V2Test`）、迁移 DDL 的 md5 比对、两处 `LIMIT` 期望值。
3. **依赖数据或日期**：写死 2023-05-25 的用例；依赖库里预置或残留数据的用例；加密列遇到残留明文行。
4. **MySQL 配置**：8.4 默认排序规则 `utf8mb4_0900_ai_ci` 与用例建表不一致（`QueryTest14.testLikeColumn2`）；严格 sql_mode 下的 DATETIME 与默认值报错。

## 准备实库（一次）

- MySQL 3306：库 `easy-query-test`、`easy-query-test2021/2022/2023`；按顺序执行 `sql-test/src/main/resources/` 下的 `mysql-init-sqk-easy.sql`（去掉开头不带引号的建库语句，改为先 `use`）、`mysql-init-sqk-easy-sharding.sql`、`relation.sql`（都加 `--force`），再给 `t_sys_user` 补 `username`、`id_card`、`address` 三列。
- PG 54321：库 `easy-query-test` 里 `create schema if not exists "easy-query-test"`。
- Redis 55000（compose 已带）：BaseTest 的静态初始化会连它。
- 用例之间共用表、互相改数据，稳定的回归要从空库重建后再跑。

数字来自 2026-10-27 的第 4 次全量运行（双流水线约 9 分钟）。

## 运行记录

- **2026-10-28，M3b 收尾**（main 含 PR #12–#18）：与已知非通过清单对比，无回归。第一遍有 36 条"新失败"，全是 `t_sys_user` 缺 `username` / `id_card` / `address` 列：之前单独跑子集时 `doc.DocTest1` 按 `doc.entity.SysUser`（id、name、phone、age、create_time）自动同步了同名表。用 `mysql-init-sqk-easy.sql` 里的建表语句重建后重跑这 9 个类：425 过、1 个已知错误、无新增。
  **注意**：单独跑含 `doc.DocTest1` 的子集后，要先恢复 `t_sys_user` 再跑全量。
