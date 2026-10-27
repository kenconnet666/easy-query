# 行锁不等待：forUpdateNoWait / forUpdateSkipLocked

上游有 `forUpdate()`（事务内、单表）。fork 加两种不等待的写法：

```java
// 拿不到锁立即报错，不在锁上排队
db.queryable(Order.class).whereById(id).forUpdateNoWait().singleNotNull();

// 多个消费者抢任务：跳过别人锁住的行，各拿各的
List<Job> jobs = db.queryable(Job.class)
    .where(j -> j.status().eq("ready"))
    .orderBy(j -> j.id().asc())
    .limit(10)
    .forUpdateSkipLocked()
    .toList();
```

| 方言 | NOWAIT | SKIP LOCKED |
|---|---|---|
| MySQL 8（含 8.0.18 / PolarDB）、PG、Oracle | `FOR UPDATE NOWAIT` | `FOR UPDATE SKIP LOCKED` |
| HANA 2.0 | `FOR UPDATE NOWAIT` | `FOR UPDATE IGNORE LOCKED` |
| DB2 | 不支持（报错） | 未实测，先报错 |
| SQL Server、ClickHouse、DuckDB | 不支持（报错，与 forUpdate 相同） | 同左 |

约束与 `forUpdate()` 相同：必须在事务里、只支持单表、只能调用一次。NOWAIT 失败时抛出驱动的锁冲突错误（MySQL 3572、PG 55P03、HANA 146）。

方言要换写法时覆盖 `QuerySQLExpressionImpl.lockClause(QueryLockEnum)`。

顺手修复：SQL Server / ClickHouse / DuckDB 原来只拦 `FOR_UPDATE`，新增的两种模式会被悄悄忽略，现在一律报不支持。

实测：MySQL 8.0.18、PG 17、HANA 2.0（`LockWaitLiveTest`：一个事务锁住 p1，另一个 NOWAIT 立即失败、SKIP LOCKED 只拿到 p2、p3）。
