# 日期截断：dateTrunc

```java
// 按月汇总
.groupBy(o -> GroupKeys.of(o.createTime().dateTrunc(DateTruncEnum.MONTH)))
// 本周（周一开始）的记录
.where(o -> o.createTime().dateTrunc(DateTruncEnum.WEEK).eq(mondayOfThisWeek))
```

粒度 `DateTruncEnum`：YEAR、QUARTER、MONTH、WEEK（周一开始，ISO）、DAY、HOUR、MINUTE、SECOND。截到该粒度的起点，更小的部分清零，结果是日期时间。

| 方言 | 写法 |
|---|---|
| PostgreSQL | `DATE_TRUNC('month', x)` |
| MySQL（含 8.0.18 / PolarDB） | `CAST(DATE_FORMAT(x,'%Y-%m-01 00:00:00') AS DATETIME)`；季度、周再 `DATE_SUB` 月 / 天的偏移 |
| HANA 2.0 | `TO_SECONDDATE(TO_VARCHAR(x,'YYYY-MM') \|\| '-01 00:00:00', …)`；季度、周用 `ADD_MONTHS` / `ADD_DAYS` 回退 |
| 其它 | 调用时抛 `UnsupportedOperationException("dateTrunc(DAY) is not supported by …")`；方言覆盖 `SQLDateTimeFunc.dateTrunc` 即可支持 |

季度与周的写法里列出现两次：列是带参数的表达式时，参数各绑定一次（模板占位符不重复）。

实测：MySQL 8.0.18、PG 17、HANA 2.0 的 8 种粒度与 where 比较（`DateTruncLiveTest`）。
