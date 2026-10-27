# ROADMAP

状态：`[ ]` 未开始、`[~]` 进行中、`[x]` 完成、`[!]` 待决（原因写在 STATUS）。每项一个分支一个 PR，规则见根目录 CLAUDE.md。
"已有/缺失"的依据是 2026-10-27 的核查（源码 + sql-test 用例 + 官方文档仓库 xuejmnet/easy-query-doc），不要重做已有能力。

**成熟的定义**：M0–M4 完成且 CI 绿、上游基线不退化；M5 的 T0–T3 完成；flow 验收分支跑通。到此停下汇报。

## 执行顺序

M0 → M1 → M2 → M3a（flow 用得上的 3.1–3.3）→ M5（T0–T2）→ M3b（3.4–3.9）→ M4 → M5（T3）→ M6。
某项进入"待决"时跳到顺序里下一个不依赖它的项。

## M0 地基

- [x] 0.1 本地测试库 `infra/dev`：MySQL 8.4（3306/3316）、PG 17（54321）、HANA 2.00.088（39041），端口账号对齐上游 sql-test
- [ ] 0.2 PolarDB 本地替身：`polardbx/polardbx-engine-2.0:80-8.0.18-*`（MySQL 8.0.18 内核，X-Cluster），profile `polardb`，端口 3318
- [ ] 0.3 Maven wrapper（mvnw，3.9.x）
- [ ] 0.4 新模块 `sql-fork-test`：标准 `src/test/java`、JUnit 4、测试源走 APT；默认只跑 SQL 文本断言，`-Plive` 连本地库
- [ ] 0.5 CI `.github/workflows/ci.yml`：PR 与 push main 触发；JDK 8 构建（除 springboot4 starter）+ fork 测试；JDK 17 构建 springboot4 starter；不碰 release.yml、不推 tag
- [ ] 0.6 上游测试基线：可重跑的脚本 + `docs/fork/baseline.md`（总数、通过、失败按原因分类）
- [ ] 0.7 文档骨架（CLAUDE.md、ROADMAP、STATUS、BACKLOG、features/、decisions/），合并 M0

## M1 扩展点与小修（都能单独回馈上游）

- [ ] 1.1 方言静态入口约定（decisions/0001）：入口类 `com.easy.query.<db>.<Db>`（如 `MySQL`、`PgSQL`、`Hana`）放在方言模块里，`sql-api-proxy` 以 provided 依赖引入；方言在自己的 `DatabaseConfiguration` 里注册能力标记，兼容库（PolarDB 用 MySQL 方言）共用；构造表达式时查标记，错方言明确报错。列参数一律用现成的 `PropTypeColumn.acceptAnyValue`
- [ ] 1.2 首批专属函数（不与已有的 `asJSONObject()/asJSONArray()` 重叠）：MySQL `jsonContains`、`memberOf`、`jsonOverlaps`、全文 `match(...).against(...)`（全部 8.0.18 可用）；PG jsonb `@>`、`?`，数组 `&&`、`= ANY`
- [ ] 1.3 文档 `features/custom-dialect-function.md`：用户写自己的方言函数，与内置同形
- [ ] 1.4 `Instant`/`OffsetDateTime`/`ZonedDateTime`：APT（ProxyGenerateProcessor）与 KSP 映射到日期时间列类型；默认 JdbcTypeHandler（语义在 decisions 里定）
- [ ] 1.5 缺陷：窗口函数 `PARTITION BY x` 与 `ORDER BY` 之间缺空格（ColumnObjectFunctionAvailable.offset），不加引号的方言会出错
- [ ] 1.6 代理 API 暴露已有的 `jsonArrayLength`
- [ ] 1.7 MySQL 8.0.18 兼容审计：MySQL 方言的 SQL 文本用例与 fork 实库用例在 PolarDB 替身上跑一遍，列出依赖 8.0.19+ 的写法并修正或标注

## M2 SAP HANA 方言（新模块 `sql-db-support/sql-hana`，以 sql-db2 为模板；实测知识来自 easy_query_pro/docs/hana-*.md，只取知识不取其补丁式架构，Java 17 语法降到 8）

- [ ] 2.1 骨架：SQLKeyword（双引号、大写折叠）、`LIMIT/OFFSET`、`FROM DUMMY`、ExpressionFactory；springboot starter、solon 插件、README 接入
- [ ] 2.2 SQLFunc：`||` 拼接、SUBSTRING/LOCATE（UTF-16 计数）、STRING_AGG、ADD_DAYS 等日期加减与格式 token 翻译、SELECT 里布尔值用 CASE、JSON_VALUE/JSON_QUERY、IFNULL
- [ ] 2.3 写入：upsert 用 `MERGE INTO … USING (… FROM DUMMY)`；生成键用同连接 `SELECT CURRENT_IDENTITY_VALUE() FROM DUMMY`（表上有启用的 INSERT 触发器时拒绝回填）；批量走 JDBC batch；零列插入明确报错
- [ ] 2.4 关联更新与删除：UPDATE 用按主键关联的 MERGE，DELETE 用 EXISTS
- [ ] 2.5 类型：时间按 UTC Calendar 绑定与读取、LOB 用流 setter、DECIMAL 参数加 CAST 提示
- [ ] 2.6 迁移：`CREATE COLUMN TABLE`、`ALTER TABLE t ALTER (…)`、注释、索引、反查 SYS 视图
- [ ] 2.7 实库用例（`-Plive`，eq-dev-hana）+ `features/hana.md` 支持矩阵

## M3 通用缺口（每项都有 MySQL 8.0.18 / PG 17 / HANA 支持矩阵，不支持的方言渲染时报错）

M3a（flow 用得上，先做；验收 = 在 flow 本地分支改写对应代码）：
- [ ] 3.1 查询级表名映射：一条查询里把实体 A、B… 映射到别的表，导航、隐式 join、隐式子查询、include 都跟随（现状：`asTable` 只改最近一张表，已用样板证实）。先在 decisions 里比较 `ExpressionBuilderFactory` 替换与拦截器两条路，再定 API。验收：flow 的 InboxQueries / Participation 去掉热表归档表分支
- [ ] 3.2 类型化 INSERT … SELECT（含插入到另一张同结构表）。验收：flow 的 Archives 去掉 information_schema 与拼接 SQL
- [ ] 3.3 内置 JSON 列转换器 + JsonCodec SPI：按字段泛型类型（List<Foo>、Map<String,Object>）编解码，codec 可换（Jackson / 用户自带）。验收：flow 的 JsonColumns 缩短

M3b：
- [ ] 3.4 窗口：ROWS/RANGE frame、空 partition 的全局窗口（rank/sum 等现在要求 partitionBy）、ntile / percent_rank / cume_dist
- [ ] 3.5 ROLLUP / CUBE / GROUPING SETS 与 `grouping()` 标记
- [ ] 3.6 NULLIF；null-safe 等值（MySQL `<=>`、PG `IS NOT DISTINCT FROM`，其他方言用等价 CASE）
- [ ] 3.7 日期截断（年/季/月/周/日/时）
- [ ] 3.8 RETURNING（PG 等支持的方言；MySQL/HANA 明确报错）
- [ ] 3.9 FOR UPDATE 的 NOWAIT / SKIP LOCKED

不做（已有）：QUALIFY（嵌套 queryable + `Select.PART` 已能表达）、聚合 `filter`、lag/lead/first/last/nth、union/unionAll、onConflictThen、JSON 取值。

## M4 方言专属能力（用 M1 的入口）

- [ ] 4.1 HANA：全文 `CONTAINS(…, FUZZY)` 与 `SCORE()`、层级 `HIERARCHY` 函数、表函数与计算视图传参（PLACEHOLDER）
- [ ] 4.2 PG：jsonb 运算全集、数组、全文 tsvector/tsquery
- [ ] 4.3 MySQL / PolarDB：JSON 全集（8.0.18 可用的）、全文检索；PolarDB 专属语法本地无法实测的进 BACKLOG

## M5 TS 版（本仓库 `ts/`，pnpm workspace；不追求与 Java 生成逐字相同的 SQL，只共享概念与命名）

- [ ] T0 设计文档 `decisions/0002-ts-design.md`：schema 对象定义实体与关系；查询 `db.queryable(User).where(u => [...]).select(u => ({...}))`，条件返回表达式（数组里 false/undefined 跳过）；导航与隐式子查询 `u.posts.any(...)`；对象树 select 结果类型全推导；方言开放注册、专属函数与 Java 同形；驱动可选 peer 依赖；类型性能预算。用最新稳定版 TypeScript，Node ESM
- [ ] T1 核心 AST + SQLite（node:sqlite，零基础设施）+ MySQL（mysql2）：单表 CRUD、where/select/orderBy/分页、事务
- [ ] T2 导航：隐式 join、隐式子查询（any/none/count/sum/max/min/toList）、include、对象树 select
- [ ] T3 PG（pg）、HANA（@sap/hana-client）与方言静态入口
- [ ] T4 `pull`：从现有库生成 schema 文件（进 BACKLOG，T3 后视情况）
- CI 加 node job：`tsc --noEmit`、单测、类型性能用例

## M6 成熟收尾

- [ ] 合并上游、全量构建、上游基线对比
- [ ] 文档索引 `docs/fork/README.md`
- [ ] 列出可回馈上游的分支与说明（由用户去开上游 PR）

## flow 验收（M3a 起）

- flow 仓库建本地分支 `eq-fork-acceptance`，**只提交本地、不推送**。
- fork 产物在临时 worktree 里 `versions:set 3.3.1-ext-SNAPSHOT` 后 install，主线 pom 不改版本。
- 每项验收记录：改写了哪些文件、减少多少行、flow 实库测试（MySQL 8.4 与 PolarDB 替身）是否全过。
