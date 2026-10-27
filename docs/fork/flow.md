# 为 flow 做的事

flow（C:\Users\lionheart\IdeaProjects\flow）是 fork 的第一个真实使用方：Java 17，持久层用 easy-query，只支持 MySQL，生产是 PolarDB MySQL 8.0.18。
下列痛点都对照 flow 源码与 easy-query 源码核实过（2026-10-27）。

## 需要 fork 做的

| fork 项 | flow 现状（文件） | 做完后 flow 怎么改 |
|---|---|---|
| M0.2 + M1.7 PolarDB 8.0.18 替身与兼容审计 | 生产 8.0.18，本地只有 8.4 | flow 的实库测试在替身上也跑一遍；fork 的 MySQL 方言不产出 8.0.19+ 才有的写法 |
| M1.4 Instant 进代理的日期时间类型 | `StatsQueries.nodes` 用 `asLocalDateTime()` 骗编译器 | 直接 `w.createdAt().duration(w.completedAt())` |
| M3.1 查询级表名映射 | `Archives.from/query` 遍布 InboxQueries、Participation；归档的待办导航指向热表，要 `attachArchivedInstances` 手工补实例；抄送的归档分支改写成 exists | 一处声明"这条查询用归档表"，导航、隐式子查询、`selectAutoInclude` 都跟着走；删掉补实例与改写的分支 |
| M3.2 类型化 INSERT … SELECT | `Archives.archiveBatch` 拼 SQL、查 `information_schema` 取列、反引号 | 用实体元数据生成列清单，不再读 information_schema、不再拼字符串 |

## flow 自己就能改、不等 fork 的

- `Archives.archiveBatch` 里的 DELETE 可以改用现有的 `deletable(X).allowDeleteStatement(true).where(x -> x.instanceId().in(ids))`（INSERT … SELECT 仍等 M3.2）。
- `StatsQueries.processes` 的行转列：改用 `count().filter(...)` 在一条分组查询里出三个数（`nodes()` 已经这样用了）。

## 不为 flow 做的

- M3.3 内置 JSON 列转换器：flow 存的是 json-wire 的 typed JSON，RunState 等形状是手写的；三个简单转换器（FormValues、Variables、ObjectJson）各两行，换成通用转换器还要写一个 codec 类，净省几乎为零。M3.3 仍对一般用户有用，但不算 flow 的验收项。
- 事务隔离级别检查的跨库写法：flow 只支持 MySQL，`SELECT @@transaction_isolation` 在 8.0.18 可用，不需要。
- 待办两段查询改 UNION：现在的写法是为了走索引，进 BACKLOG 评估。
- HANA / PG：flow 不需要。

## 验收方式

- flow 仓库本地分支 `eq-fork-acceptance`，只本地提交、不推送。
- fork 在临时 worktree 里 `versions:set 3.3.1-ext-SNAPSHOT` 后 install；flow 分支把 `easy-query.version` 指过去。
- 每项记录：改了哪些文件、净减多少行、flow 实库测试（MySQL 8.4 与 PolarDB 替身）是否全过。
