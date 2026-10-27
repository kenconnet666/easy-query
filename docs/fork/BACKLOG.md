# BACKLOG

规划外、暂不做的事，一行一条：`- [来源] 描述（为什么暂缓）`。做之前先过四问，进 ROADMAP 再动手。

- [M1] 上游 87 处 `instanceof DSLSQLFunctionAvailable` 样板可改用现成的 `PropTypeColumn.acceptAnyValue`（纯整理，改动面大、易与上游冲突，等上游意向）
- [M2] HANA 零列插入（H03）：HANA 拒绝 DEFAULT VALUES 等全部写法，先明确报错
- [M2] HANA 带 distinct 的 STRING_AGG（H08）：先明确报错，替代写法见 easy_query_pro/docs/hana-functions.md
- [flow] 待办两段查询（落到我的 + 我能认领的）合并分页目前在内存里做，可评估 UNION ALL 各段 top-N 的写法
- [M2] HANA 按顺序取第一个的关联标量子查询（ORDER BY … LIMIT 1）：HANA 不支持，可评估改写成窗口函数 + 派生表
- [M2] HANA 的 length / indexOf / subString 按 UTF-16 单元计；要与 MySQL 的按字符计数一致可用 OCCURRENCES_REGEXPR 改写（代价高，先不做）
- [M2] HANA JSON 数组长度：没有内置函数，easy_query_pro 的做法是部署一个 SQLScript 函数
