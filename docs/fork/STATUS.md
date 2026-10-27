# STATUS

更新于 2026-10-28。保持 40 行以内：只写当前在做什么、最近完成什么、待决什么。

## 当前

- 下一步：M3b 收尾（合并上游 main、全量构建、跑上游基线），然后 M4（HANA 全文 / 层级、PG jsonb / 数组 / 全文、MySQL JSON / 全文），再回 TS 的 T3。
- flow 验收分支 `eq-fork-acceptance`（本地，不推送）：每个工作项前 fetch 并 merge flow 的 origin/master。

## 最近完成

- M3b 全部完成（PR #12–#18）：3.3 JsonValueConverter + JsonCodec、3.4 窗口 frame / 全局窗口 / ntile 等、3.5 rollup / cube / grouping、3.6 eqNullSafe / nullIf、3.7 dateTrunc、3.8 PgSQL.returning、3.9 forUpdateNoWait / forUpdateSkipLocked；每项在 MySQL 8.0.18、PG 17、HANA 实测（3.8 仅 PG）。
- M5 T0–T2：TS 版（`ts/`：@eqts/core、@eqts/sqlite、@eqts/mysql），共用实库套件在 SQLite、MySQL 8.0.18、8.4 上通过；设计与实现差异见 `decisions/0002-ts-design.md` 末节。
- flow M3a 验收：归档改用 TableNameMapping + InsertSelect，5 文件净减 42 行，flow-it 两库各 100 个用例通过（见 `flow.md` 验收记录）。
- M3.1 TableNameMapping、M3.2 InsertSelect；M2 HANA 方言（查询、函数、MERGE upsert、生成键回填、DST 安全的 LocalDateTime）。
- M1：方言静态入口（MySQL.json / PgSQL.jsonb …）、Instant/OffsetDateTime/ZonedDateTime 列、窗口空格修复、JSON 数组 size、MySQL 8.0.18 审计。
- json-wire 改为 Java 8（本地分支 `feat/java8`，已 install `0.1.0-SNAPSHOT`；发布由用户手动做）。
- 本地测试库：MySQL 8.4（3306/3316）、8.0.18（3318，profile polardb）、PG 17（54321）、Redis（55000）、HANA 2.00.088（39041，profile hana）。

## 更正

- 之前说的 PolarDB 替身 `polardbx-engine-2.0:80-8.0.18` 实际报告 MySQL 8.0.30，已弃用；改用官方 `mysql:8.0.18` 作为与生产内核一致的兼容基线。

## 待决（不阻塞，用户有空时看）

- TS 版草案里待确认的 5 点按原方案实施（列与关系分开定义、数组条件、默认值映射、显式 tx、包名 `@eqts/*`）；有异议时改动集中在 `ts/packages/core/src/schema.ts`、`relations.ts`。
