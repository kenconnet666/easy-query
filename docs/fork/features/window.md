# 窗口函数：全局窗口、frame、分布函数

上游的 `expression().xxxOver(...)` 原来必须 `partitionBy(...)`，也不能写 frame。fork 补上：

```java
// 全局窗口：OVER (ORDER BY …) / OVER ()
p.expression().rowNumberOver().over().orderByDescending(p.amount())
p.expression().sumOver(p.amount()).over()

// frame：累计和、移动平均
p.expression().sumOver(p.amount()).partitionBy(p.userId()).orderBy(p.id())
    .rows(Bound.unboundedPreceding(), Bound.currentRow())
p.expression().avgOver(p.amount()).over().orderBy(p.id()).rows(Bound.preceding(2), Bound.currentRow())
p.expression().maxOver(p.amount()).over().orderBy(p.amount()).range(Bound.currentRow(), Bound.unboundedFollowing())

// 分布
p.expression().ntileOver(4).over().orderBy(p.amount())                       // 组号 1..4
p.expression().percentRankOver().partitionBy(p.userId()).orderBy(p.amount())  // 0..1
p.expression().cumeDistOver().over().orderBy(p.amount())                      // (0, 1]
```

`Bound` 是 `com.easy.query.core.func.def.WindowFrame.Bound`：`unboundedPreceding()`、`preceding(n)`、`currentRow()`、`following(n)`、`unboundedFollowing()`；偏移量只接受非负整数，直接写进 SQL。
frame 写在 `orderBy` 之后。RANGE 带偏移量时各库对 ORDER BY 列类型的要求不同，由数据库校验。

实现上，原来 ROW_NUMBER / RANK / DENSE_RANK / COUNT / SUM / AVG / MAX / MIN 各一个 SQLFunction 与 builder（渲染代码复制了 8 份），
现在收成 `OverSQLFunction` 与 `OverBuilder`；原有的 builder 类型保留为薄子类，已有代码不用改，生成的 SQL 与原来逐字相同（上游相关用例回归通过）。

实测：MySQL 8.0.18、PG 17、HANA 2.0（`WindowLiveTest`）。
