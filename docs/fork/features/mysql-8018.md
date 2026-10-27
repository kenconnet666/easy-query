# MySQL 8.0.18（PolarDB）兼容

生产的 PolarDB MySQL 版报告内核 `8.0.18-X-Cluster-1.0.4`，MySQL 方言的输出按 8.0.18 能执行为准。

## 审计结果（2026-10-28）

- 静态检查：core 默认 SQL 与 MySQL 方言里没有 8.0.19+ 才有的写法（`INSERT … AS 别名`、`VALUES ROW`、`TABLE` 语句、`INTERSECT`/`EXCEPT`、`JSON_VALUE`、`CAST … AS DOUBLE` 等都没有）。upsert 用的是 `ON DUPLICATE KEY UPDATE c = VALUES(c)`，8.0.18 可用（8.0.20 起只是"不推荐"）。
- fork 新增的 MySQL 函数里，`JSON_OVERLAPS`、`MEMBER OF` 要 8.0.17+，其余 5.7 起就有；都在 8.0.18 实库上跑过（`MySQLDialectEntryLiveTest`）。
- flow 的实库测试整套在 8.0.18 上通过（见 flow.md）。

## 本地基线

`bash infra/dev/db.sh --profile polardb up -d`：官方 `mysql:8.0.18`，端口 3318，root/root。fork 的 live 用例同时跑 8.4 与 8.0.18。

## 以后加 MySQL 功能时

新函数在文档里写明最低版本；高于 8.0.18 的，要么换写法，要么在 8.0.18 上明确报错。
