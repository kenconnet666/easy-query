# NULLIF 与 null 安全的相等

```java
// 两边都为 NULL 也算相等：where name 与参数"相同"，参数可以是 null
u.name().eqNullSafe(name)
// 两列：join 条件里 NULL 对 NULL
.innerJoin(ForkUser.class, (p, u) -> u.id().eqNullSafe(p.userId()))

// NULLIF：等于给定值时变成 NULL，常用于把空串当 NULL
u.name().nullIf("").isNull()                          // name 为 NULL 或 ''
u.name().nullIf("").nullOrDefault("-")                // 空串与 NULL 都显示成 "-"
```

| 方言 | eqNullSafe 的写法 |
|---|---|
| MySQL（含 8.0.18 / PolarDB） | `a <=> b` |
| PostgreSQL | `a IS NOT DISTINCT FROM b` |
| 其它（HANA 等） | `((a = b) OR (a IS NULL AND b IS NULL))`，两边各渲染两次（参数各绑定两次） |

方言要换写法时覆盖 `SQLFunc.nullSafeEquals(left, right)`。比较值经过列的 ValueConverter（与 `eq` 一样）。

实测：MySQL 8.0.18、PG 17、HANA 2.0（`NullSafeLiveTest`）。
