# 小计与总计：rollup() / cube() / grouping()

```java
// 每个用户的金额小计 + 总计；grouping(key) 为 1 的是总计行（key 为 NULL）
List<Draft3<String, Number, Integer>> rows = db.queryable(Post.class)
    .groupBy(p -> GroupKeys.of(p.userId()))
    .rollup()
    .select(g -> Select.DRAFT.of(g.key1(), g.groupTable().amount().sum(), g.expression().grouping(g.key1())))
    .toList();

// 多个键：ROLLUP(a, b) 出 (a,b)、(a)、() 三级；CUBE(a, b) 出所有组合
.groupBy(p -> GroupKeys.of(p.userId(), p.title())).cube()
```

`rollup()` / `cube()` 写在 `groupBy` 之后、`select` 之前；没有 groupBy 时报错。

| 方言 | rollup() | cube() |
|---|---|---|
| PG、HANA、Oracle、SQL Server、DB2 等 | `GROUP BY ROLLUP(a, b)` | `GROUP BY CUBE(a, b)` |
| MySQL 8（含 8.0.18 / PolarDB） | `GROUP BY a, b WITH ROLLUP` | 不支持（报错） |

方言要换写法时覆盖 `SQLFunc.groupBy(GroupingEnum, String)`。

实现：分组键在构建期保持普通的列表（select 里按键取列不受影响），生成 SQL 表达式时才包上 ROLLUP / CUBE，所以各方言自己的 `GROUP BY` 拼接代码都不用改。

GROUPING SETS（任意指定的分组组合）还没做，见 BACKLOG。

实测：MySQL 8.0.18、PG 17、HANA 2.0（`GroupingLiveTest`：两个用户的小计 + 总计，GROUPING 标出总计行）。
