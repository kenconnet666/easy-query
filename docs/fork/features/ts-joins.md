# TS：显式 join（`innerJoin` / `leftJoin`）

导航（`u.company.name`）只能沿着声明过的关系隐式 LEFT JOIN。显式 join 补上三件事：内连接、join 没声明过关系的表、把一对多**展平**成"父子对"。

```ts
const rows = await db.queryable(User)
  .innerJoin(Post, (u, p) => p.userId.eq(u.id))                     // on 收到此前所有表引用加上新表引用
  .leftJoin(Comment, (_u, p, c) => c.postId.eq(p.id))               // 第三张表；c 的列都可空
  .where((u, p, c) => [u.age.ge(18), p.amount.gt('5')])            // 之后的 lambda 按 join 顺序收到所有表引用
  .orderBy((_u, p) => p.id)
  .select((u, p, c) => ({ name: u.name, title: p.title, body: c.body }))   // body: string | null
  .toPage(1, 20)
```

- **结果类型**：`select` 里按用到的引用推导，left join 那张表的列可空。不写 `select` 时是每张表的整行，按实体名分组：`{ User: Row, Post: Row, Comment: Row | null }`（left join 没匹配上时整行是 `null`）。
- **自连接 / 同一实体 join 两次**：必须写 `select` 来命名列，否则报 `the same entity is joined more than once`。
- **聚合与分组**：`groupBy((u, p) => …)`、`g.sum((u, p) => p.amount)`、根聚合 `sum((u, p) => …)`、`count()`、`toPage` 都认 join。注意内连接一对多后 `count()` 数的是连接后的行数。
- **导航照常**：join 来的表上也能用导航（`p.user.name`），隐式 join 排在显式 join 之后。
- **拦截器**（租户等）作用在每张 join 的表上，条件放进它自己的 `ON`：left join 不会因此丢掉主表的行。
- **ON 必须有条件**：条件全被跳过时报错，免得悄悄变成笛卡尔积。
- **顺序**：`innerJoin / leftJoin` 必须在 `select` 之前调用（之后形状已经定死），否则报错。

## 方言

只用标准的 `INNER JOIN` / `LEFT JOIN`，各库写法一致：SQLite、MySQL 8.0.18 / 8.4、PG 17 实测通过；HANA 随 CI 验证。

## 限制（进了 BACKLOG）

- 没有 `rightJoin`：把表顺序对调写成 `leftJoin` 即可，右连接会让之前所有表的列都变成可空，类型要整串重算，等有具体用例再做。
- 导航本身的 inner 语义（`u.company` 强制内连接）没做；要内连接请显式 `innerJoin(Company, …)`。
- 更新 / 删除里仍不允许 join（各库写法不一致），用一对多的 `any()`。
