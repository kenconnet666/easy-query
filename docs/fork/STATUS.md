# STATUS

更新于 2026-10-27。保持 40 行以内：只写当前在做什么、最近完成什么、待决什么。

## 当前

- M0 收尾：PR `chore/m0-foundation` 等 CI。

## 最近完成

- json-wire 改为 Java 8（本地分支 `feat/java8`，已 install 到本机 `0.1.0-SNAPSHOT`；发布由用户手动做）。
- 本地测试库：MySQL 8.4（3306/3316）、PG 17（54321）、Redis（55000）、HANA 2.00.088（39041，profile hana）、MySQL 8.0.18（3318，profile polardb）。
- `sql-fork-test` 模块：fork 冒烟 + 上游不连库的 13 个类，JDK 8 下 202/202 通过。
- 上游实库基线（docs/fork/baseline.md）：通过 2080、稳定非通过 57 条，均与 fork 无关。

## 更正

- 之前说的 PolarDB 替身 `polardbx-engine-2.0:80-8.0.18` 实际报告 MySQL 8.0.30，已弃用；改用官方 `mysql:8.0.18` 作为与生产内核一致的兼容基线。

## 待决（不阻塞，用户有空时看）

- TS 版设计草案 `decisions/0002-ts-design.md` 待用户审阅；审阅前只做类型样板，不开始 T1。
