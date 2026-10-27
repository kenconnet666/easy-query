# Instant / OffsetDateTime / ZonedDateTime 的代理列

实体上这三种类型的属性，APT 与 KSP 生成的代理列现在是日期时间列（`SQLInstantTypeColumn` 等），和 `LocalDateTime` 一样能用 `format`、`plusDays`、`duration`、取年月日、比较：

```java
// 以前：Instant 列是 SQLAnyTypeColumn，要先 asLocalDateTime() 才有 duration
w.createdAt().duration(w.completedAt()).toSeconds().avg()
```

- 生成的 SQL 与 LocalDateTime 列相同。
- 值的绑定与读取没有改：没注册 JdbcTypeHandler 时走 JDBC 的 `setObject` / `getObject`，驱动怎么处理就怎么处理。要按 UTC 存取，自己注册处理器（`runtime.getJdbcTypeHandlerManager().appendHandler(Instant.class, ...)`）。
- 兼容性：以前对这些列调用的方法（`eq`、`asLocalDateTime()` 等）都还在；代码里显式写了 `SQLAnyTypeColumn` 类型的变量要改成新类型。
