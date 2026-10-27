# 用查询结果插入：InsertSelect

```java
long moved = InsertSelect.from(db.queryable(WorkItemEntity.class).where(w -> w.instanceId().in(ids)))
    .into("flow_work_item_archive")       // 目标表；不写时是实体自己的表（受 TableNameMapping 作用域影响）
    .column("archived_at", now)          // 只在目标表上有的列，每行同一个值
    .executeRows();
```

生成 `INSERT INTO 目标 (列…, archived_at) SELECT eq_src.列…, ? FROM (源查询) eq_src`：

- 列清单来自实体的元数据（与源查询默认选出的列一致、顺序相同），不读数据库的列信息，也不拼 SQL 字符串。
- 源查询照常生成：条件、参数、值转换、拦截器（如租户）都和普通查询一样；不需要租户条件时在源查询上 `noInterceptor(..)`。
- 源查询不要自己 `select` 别的列：要的是实体默认的整行。
- `toSQL()` 可看生成的语句。

在 MySQL 8.0.18、PostgreSQL 17、SAP HANA 2.0 上实测（`live.InsertSelectLiveTest`）。
