# UPDATE / DELETE … RETURNING（PostgreSQL）

把受影响的行一次读回，省掉"先查再改"的第二条语句：

```java
// 更新后的值
List<Account> after = PgSQL.returning(db.updatable(Account.class)
        .setColumns(a -> a.balance().increment(10))
        .where(a -> a.id().eq(id)))
    .toList();

// 删掉的行
List<Job> done = PgSQL.returning(db.deletable(Job.class).where(j -> j.status().eq("done"))).toList();

// 只看 SQL
PgSQL.returning(...).toSQL();   // … RETURNING *
```

- 语句与参数用 updatable / deletable 自己生成的：拦截器、逻辑删除（逻辑删除时实际是 UPDATE … RETURNING）都照常生效。
- 结果按列名映射回实体（与 `sqlQuery` 相同）。
- 方言专属：入口在 `PgSQL`，在非 PG 方言上调用时立即抛 `UnsupportedOperationException("PgSQL.returning is not supported by …")`。
  MySQL 与 HANA 没有 RETURNING；INSERT 的自增主键回填已由 `insertable(...).executeRows(true)` 覆盖。

实测：PG 17（`ReturningLiveTest`：UPDATE 返回更新后的金额，DELETE 返回删掉的两行）。
