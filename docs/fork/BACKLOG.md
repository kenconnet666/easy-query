# BACKLOG

规划外、暂不做的事，一行一条：`- [来源] 描述（为什么暂缓）`。做之前先过四问，进 ROADMAP 再动手。

- [M1] 上游 87 处 `instanceof DSLSQLFunctionAvailable` 样板可改用现成的 `PropTypeColumn.acceptAnyValue`（纯整理，改动面大、易与上游冲突，等上游意向）
- [M2] HANA 零列插入（H03）：HANA 拒绝 DEFAULT VALUES 等全部写法，先明确报错
- [M2] HANA 带 distinct 的 STRING_AGG（H08）：先明确报错，替代写法见 easy_query_pro/docs/hana-functions.md
- [flow] 待办两段查询（落到我的 + 我能认领的）合并分页目前在内存里做，可评估 UNION ALL 各段 top-N 的写法
- [M2] HANA 按顺序取第一个的关联标量子查询（ORDER BY … LIMIT 1）：HANA 不支持，可评估改写成窗口函数 + 派生表
- [M2] HANA 的 length / indexOf / subString 按 UTF-16 单元计；要与 MySQL 的按字符计数一致可用 OCCURRENCES_REGEXPR 改写（代价高，先不做）
- [M2] HANA JSON 数组长度：没有内置函数，easy_query_pro 的做法是部署一个 SQLScript 函数
- [M2] 核心的 LocalDateTimeTypeHandler 经 Timestamp.valueOf 按 JVM 时区换算：JVM 时区有夏令时时，跳过那一小时里的时刻会被挪动（所有方言都受影响，HANA 已改用 UTC 日历）；可做成回馈上游的修复
- [M2] HANA 迁移 DDL（2.6）挪到 M3a 之后：flow 用 Flyway 脚本，ERP 是库优先，目前没人等它
- [M3.3] Spring Boot 4 的 Jackson 3（`tools.jackson.databind`）自动适配 JsonCodec：现在只认 Jackson 2，只有 Jackson 3 时用户要自己提供 JsonCodec bean
- [M3.3] PG json/jsonb 列写入字符串参数要 `stringtype=unspecified`；可评估让 PG 方言把 JsonValueConverter 的参数包成 PGobject / `?::jsonb`
- [M3.7] dateTrunc 只实现了 PG、MySQL、HANA；SQL Server（DATETRUNC 2022+ / DATEADD+DATEDIFF）、Oracle（TRUNC(x, 'MM')）、H2 / DuckDB / Kingbase / GaussDB（DATE_TRUNC）待有人用时补
- [M3.9] DB2 的 `SKIP LOCKED DATA` 未实测，现在明确报不支持；SQL Server 可用 `WITH (UPDLOCK, ROWLOCK, READPAST)` 表提示实现 skip locked
- [M3.5] GROUPING SETS（任意指定的分组组合）：需要"键的集合的集合"这种 API，等有具体用例再设计；ROLLUP / CUBE 已覆盖常见的小计总计
- [M4.3] MySQL JSON_TABLE（把 JSON 数组展开成行，可做 join）、JSON_SEARCH、JSON_KEYS 未做；PolarDB 专属语法（并行查询 hint、IMCI 列存）本地 8.0.18 镜像无法实测
