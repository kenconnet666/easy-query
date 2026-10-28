# TS：`in(子查询)`、派生表、`union`、CTE（含递归）

## 思路

子查询的结果被当作一个**合成的派生实体**：列名取 `select` 的键，类型取查询的输出类型，列在 SQL 里的名字是子查询的输出别名。因此派生表、union 的结果、CTE 都能直接用 `where / orderBy / groupBy / limit / toPage / count / 聚合`，不另起一套查询构建器。

## `in(子查询)` 与标量子查询

```ts
db.queryable(User).where(u => u.id.in(db.queryable(Post).select(p => p.userId)))             // 有帖子的用户
db.queryable(User).where(u => u.id.notIn(db.queryable(Post).select(p => p.userId)))
const average = db.queryable(Post).groupBy(() => ({})).select(g => g.avg(p => p.amount))      // 一行一列
db.queryable(Post).where(p => p.amount.gt(average))                                          // 标量子查询
```

子查询必须只选一列（否则报错）；它是独立的语句，**不能引用外层的表**——相关子查询请用一对多导航的 `any / count / sum`。子查询里的租户等拦截器条件照常生效。

## 派生表 `asTable()`

```ts
db.queryable(Post)
  .select(p => ({ id: p.id, userId: p.userId, rn: win.rowNumber(w => w.partitionBy(p.userId).orderBy(p.amount.desc())) }))
  .asTable()                      // FROM (子查询) 别名
  .where(t => t.rn.eq(1))         // 对窗口结果再过滤（QUALIFY）
```

用途：对窗口函数的结果过滤、对分组结果再分页、先 `limit` 再排序。`select` 必须只由表达式组成（或不写 `select`，即整行）；含 `toList()`、嵌套对象或 join 整行的形状不能变成表。派生表只有它自己的列，**不能再 join 别的实体**（要 join 请用 CTE）。

## `union` / `unionAll`

```ts
const adults = db.queryable(User).where(u => u.age.gt(20)).select(u => ({ name: u.name, age: u.age }))
const minors = db.queryable(User).where(u => u.age.lt(20)).select(u => ({ age: u.age, name: u.name }))   // 列顺序不同没关系
adults.union(minors).orderBy(r => r.name.asc()).limit(10).toList()
```

两边按**列名**对齐（输出类型必须一致），结果是一张派生表，可继续 `where / orderBy / limit / offset / count / toPage`，也可继续 `union`。成员不能带 `orderBy / limit / offset`（SQLite 不允许成员加括号，各库语义也含糊），需要时先 `asTable()`。

## CTE：`db.with` / `db.withRecursive`

```ts
const adb = db.with('big', db.queryable(Post).where(p => p.amount.gt('100')).select(p => ({ userId: p.userId, amount: p.amount })))
const rows = await adb.queryable(User)
  .innerJoin(adb.entity('big'), (u, b) => b.userId.eq(u.id))        // CTE 当作实体，能和真实实体 join
  .select((u, b) => ({ name: u.name, amount: b.amount })).toList()

// 递归：起点 + 递归的一步（用回调里的 self 实体）。默认 UNION ALL；{ all: false } 用 UNION，天然去重、能挡住环
const tdb = db.withRecursive('tree',
  db.queryable(Dept).where(d => d.id.eq(1)).select(d => ({ id: d.id, depth: sql<number>`0` })),
  (rdb, self) => rdb.queryable(Dept).innerJoin(self, (d, t) => d.parentId.eq(t.id)).select((d, t) => ({ id: d.id, depth: t.depth.plus(1) })))
```

- `with` 返回**新的 Db**（类型里多了这个实体），`entity('名字')` 取实体对象；链式的 `with` 可以建立在前一个之上，WITH 里按依赖顺序排好，参数按出现顺序绑定。
- WITH 一律放在最外层语句；子查询里用到的 CTE 会上提。只引用到的 CTE 才出现在语句里；toList 的第二条查询是独立语句，只带自己用到的。
- 递归部分与起点按列名对齐。**HANA 没有 `WITH RECURSIVE`**，用到时渲染报 `recursive CTEs are not supported by the hana dialect`（层级查询要用 HIERARCHY 函数，进 BACKLOG）。

## 验证与限制

SQLite、MySQL 8.0.18 / 8.4、PG 17 实测（含递归 CTE）；HANA 随 CI 验证（递归用例已关闭）。实测发现并修了一个会影响所有 UNION 的问题：绑定参数必须按 SQL 文本出现的顺序收集，先渲染成员再渲染主体会让参数错位。
