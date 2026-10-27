# STATUS

更新于 2026-10-27。保持 40 行以内：只写当前在做什么、最近完成什么、待决什么。

## 当前

- 分支 `chore/m0-foundation`：M0 进行中（0.1 已完成，规划文档已写）。

## 最近完成

- 本地测试库（MySQL 8.4、PG 17、HANA 2.00.088）在 WSL Docker 运行，IDEA 已建数据源；明文连接在 `.local/connections.md`。
- JDK 8u181 下 26 个模块构建通过；`sql-springboot4-starter` 需要 JDK 17。
- 样板验证：方言静态入口在 where / 链式 / 隐式子查询 / select / orderBy 都生效，错方言报错，不改 core。

## 待决（不阻塞，用户有空时看）

- 生产 PolarDB 版本串 `8.0.18-X-Cluster-1.0.4`：请在生产执行 `SELECT @@version, @@version_comment;`，核对本地替身是否同一内核系列。
- TS 版 T0 设计文档写完后按推荐继续 T1；若用户想先审，告诉我暂停 M5。
