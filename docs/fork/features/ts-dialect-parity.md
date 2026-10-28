# TS：对齐 Java 版的方言能力

与 Java 版 M3b 同名同形的一组能力，TS 版的写法：

| 能力 | 写法 | 说明 |
|---|---|---|
| null 安全相等 | `u.age.eqNullSafe(null)` / `.eqNullSafe(30)` / `.eqNullSafe(u.other)` | 两边都是 NULL 也算相等 |
| 日期截断 | `u.createdAt.dateTrunc('month')` | 单位 `year quarter month week day hour minute second`，周从星期一开始 |
| 行锁不等待 | `.forUpdateNoWait()` / `.forUpdateSkipLocked()` | 在事务里用 |
| 小计与总计 | `groupBy(…).rollup()` / `.cube()` + `g.grouping(r => r.col)` | 键在结果里变成可空 |
| 换表 | `db.mapTables({ Post: 't_post_2025' })` | 导航、join、子查询、include 全跟着换 |
| INSERT … SELECT | `db.insert(Archive).fromQuery(query).execute()` | 数据不经过应用 |
| RETURNING | `insert/update/delete(…).returning('id', 'name').execute()` | 不写列名是整行 |

## 方言支持矩阵

| | SQLite | MySQL 8.0.18 / 8.4 | PG 17 | HANA* |
|---|---|---|---|---|
| `eqNullSafe` | `IS` | `<=>` | `IS NOT DISTINCT FROM` | `(a = b OR (a IS NULL AND b IS NULL))` |
| `dateTrunc` | `strftime` | `DATE_FORMAT` 取整再 `CAST` | `DATE_TRUNC` | 不支持（报错） |
| `forUpdateNoWait` / `SkipLocked` | 空操作（没有行锁） | `NOWAIT` / `SKIP LOCKED` | 同左 | `NOWAIT` / `IGNORE LOCKED` |
| `rollup` | 不支持 | `WITH ROLLUP` | `ROLLUP(…)` | `ROLLUP(…)` |
| `cube` | 不支持 | 不支持 | `CUBE(…)` | `CUBE(…)` |
| `grouping()` | — | ✓ | ✓ | ✓ |
| `mapTables` / `fromQuery` | ✓ | ✓ | ✓ | ✓ |
| `returning` | ✓（3.35+） | 不支持 | ✓ | 不支持 |

\* HANA 一栏按文档写，未实库验证，随 CI。不支持的组合渲染时报明确的错（如 `cube() is not supported by MySQL`、`returning() is not supported by the mysql dialect`）。

## 要点

- **`dateTrunc`**：MySQL 没有 `DATE_TRUNC`，用 `DATE_FORMAT` 取整再转回 `DATETIME`；结果的类型跟源列一致（`Date` 列得到 `Date`）。按月 / 周分组统计：`groupBy(u => ({ month: u.createdAt.dateTrunc('month') }))`。
- **行锁**：SQLite 只有一条连接、没有行锁，这两个方法是空操作。MySQL 按**没有索引的列**加锁会锁住扫描过的所有行（InnoDB），抢任务要按主键 / 索引列取。
- **`rollup`**：`g.grouping(...)` 在小计行为 1，用来区分"小计行的 NULL"和"数据本身的 NULL"。`rollup()`、`cube()` 之后 `select` 里的键类型是可空的。
- **`mapTables`**：返回新的 `Db`，原来的 `db` 不变；传实体在 schema 里的键（`Post`），不是实体对象。映射的表要有同样的列。事务里也可以先映射再开事务。
- **`fromQuery`**：select 的键就是目标列名，值类型要与目标列一致、必填列都要有（类型检查）。**不经过插入拦截器**（租户、默认值、版本、逻辑删除的默认值都要在 select 里自己给）。
- **`returning`**：多行插入被拆成几条语句时，每条都带 `RETURNING`，结果合并；逻辑删除的 `delete(…).returning()` 返回被标记的行。

## 验证

SQLite、MySQL 8.0.18 / 8.4、PG 17 实测（行锁用两条连接真实对抗：一个事务持锁，另一个 `SKIP LOCKED` 拿到其余行、`NOWAIT` 立即报错）。
