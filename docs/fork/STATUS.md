# STATUS

更新于 2026-10-28。保持 40 行以内：只写当前在做什么、最近完成什么、待决什么。

## 当前

- **已发布（2026-10-28）**：npm 的 7 个包 `@zerodep-dev/easy-query-ts`、`-sqlite`、`-mysql`、`-pg`、`-hana`、`-decimal`、`-date` 的 0.1.0（`latest` 与 `next`），已从真实仓库在干净项目里装过、跑过、类型检查过；Maven `org.dpdns.zerodep.easyquery:*:3.3.1-zd.1` 早已在 Central 上（含 springboot4 starter），Java 没有新改动，不需要重发。M7（TS 版补全）全部完成并合并（#29、#30、#31），418 个用例在 SQLite、MySQL 8.0.18 / 8.4、PG 17 上通过。HANA 不在本机验证，靠 CI/CD：新增写法在 CI 跑过之前**未实库验证**（现有 ci.yml 的 ts job 没有 HANA 步骤）。
- M6 收尾完成：文档索引 `README.md`、交接 `HANDOFF.md`（换机器先读）、回馈上游清单 `upstream-candidates.md`。
- flow 验收分支 `eq-fork-acceptance`（本地，不推送）：每个工作项前 fetch 并 merge flow 的 origin/master。

## 最近完成

- M7 第一批（TS）：独立测试模块 `@zerodep-dev/easy-query-ts-test`；根查询聚合；数值算术与 `Numeric` / `Temporal` 扩展点；插入分块；`caseWhen` 与函数库；`@zerodep-dev/easy-query-ts-decimal`、`@zerodep-dev/easy-query-ts-date`、`col.bytes()`、精确 64 位整数（与 json-wire 种类表对接，端到端往返已验证）；`db.sql`；`onExecute` 钩子。修了 MySQL 适配器 bigint 参数被 mysql2 当字符串、按 DOUBLE 运算丢精度的问题。
- M5 T3 完成（PR #23–#27）：TS 版 PG（pg）、HANA（hdb）适配；拦截器 tenant / touch；upsert（HANA 为 MERGE）；窗口函数 win.*；toList limit / first；方言入口 MySQL / Pg / Hana；update(X).entity(row)。五个库共 147 个用例通过。
- M4 完成（PR #20–#22）：MySQL JSON 路径条件与 `edit`（8.0.18 实测）、PG jsonb `edit` / `PgSQL.array` / `PgSQL.fulltext`、HANA `Hana.text` 全文检索（需 FULLTEXT INDEX）。HANA 层级函数、计算视图传参进 BACKLOG。
- M3b 收尾的上游实库基线：无回归（见 baseline.md 运行记录）。
- M3b 全部完成（PR #12–#18）：3.3 JsonValueConverter + JsonCodec、3.4 窗口 frame / 全局窗口 / ntile 等、3.5 rollup / cube / grouping、3.6 eqNullSafe / nullIf、3.7 dateTrunc、3.8 PgSQL.returning、3.9 forUpdateNoWait / forUpdateSkipLocked；每项在 MySQL 8.0.18、PG 17、HANA 实测（3.8 仅 PG）。
- M5 T0–T2：TS 版（`ts/`：@zerodep-dev/easy-query-ts、@zerodep-dev/easy-query-ts-sqlite、@zerodep-dev/easy-query-ts-mysql），共用实库套件在 SQLite、MySQL 8.0.18、8.4 上通过；设计与实现差异见 `decisions/0002-ts-design.md` 末节。
- flow M3a 验收：归档改用 TableNameMapping + InsertSelect，5 文件净减 42 行，flow-it 两库各 100 个用例通过（见 `flow.md` 验收记录）。
- M3.1 TableNameMapping、M3.2 InsertSelect；M2 HANA 方言（查询、函数、MERGE upsert、生成键回填、DST 安全的 LocalDateTime）。
- M1：方言静态入口（MySQL.json / PgSQL.jsonb …）、Instant/OffsetDateTime/ZonedDateTime 列、窗口空格修复、JSON 数组 size、MySQL 8.0.18 审计。
- json-wire 改为 Java 8（本地分支 `feat/java8`，已 install `0.1.0-SNAPSHOT`；发布由用户手动做）。
- 本地测试库：MySQL 8.4（3306/3316）、8.0.18（3318，profile polardb）、PG 17（54321）、Redis（55000）、HANA 2.00.088（39041，profile hana）。

## 更正

- 之前说的 PolarDB 替身 `polardbx-engine-2.0:80-8.0.18` 实际报告 MySQL 8.0.30，已弃用；改用官方 `mysql:8.0.18` 作为与生产内核一致的兼容基线。

## 待决（不阻塞，用户有空时看）

- 新增第三方依赖（用户已在对话中明确要求）：`decimal.js` 10.6.0、`@internationalized/date` 3.12.4，均为独立包的 peer 依赖，核心零依赖；版本与 json-wire / vue-tsx-pro 一致。
- 本机 `127.0.0.1:54321`（PG）被拒但 WSL 地址可达，实库测试 PG 用 WSL 的 eth0 地址；HANA 镜像要本地构建（12G 内存），未起。

- TS 版草案里待确认的 5 点按原方案实施（列与关系分开定义、数组条件、默认值映射、显式 tx、包名 `@zerodep-dev/easy-query-ts*`）；有异议时改动集中在 `ts/packages/core/src/schema.ts`、`relations.ts`。
