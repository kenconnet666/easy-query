# TS：写入补全（`save`、`returnEntity`、批量更新、`afterWrite`）

## `save`：保存一个实体和它的子行

```ts
const saved = await db.save(User,
  { id: 1, name: 'alice2', posts: [{ id: 5, title: 'changed' }, { title: 'new' }] },
  { cascade: ['posts'], prune: true })
```

- **整个过程在一个事务里**（已经在事务里就用当前的）：任何一步失败，父行也不会留下。
- **父行**：带完整主键——行已存在就**只更新你给出的列**（没给的保持原值，`$onUpdate` 照常生效），不存在就插入；没给主键（自增）就插入并取回新主键。
- **cascade**：列出的一对多导航，子行的关联列自动设成父行的值（刚插入的父行用取回的新主键），子行同样按主键存在与否更新 / 插入。只支持**一层、直连的一对多**（多对多、多对一、更深层的子孙不支持，传错会报 `not a plain one-to-many navigation`）。
- **prune**：库里属于这个父行、但不在这份列表里的子行删掉（要求子表是单列主键；列表为空就删光；有逻辑删除的子表是逻辑删除）。
- 必填列的检查交给数据库：插入新行时少了必填列会报错（连带整个事务回滚）。返回保存后的父行。
- 为什么"先查再改"而不是 upsert：`INSERT … ON CONFLICT` 先校验新行的 NOT NULL，只给部分列时，即使行已存在也会失败。代价是并发插入同一主键时可能撞唯一约束。

## `returnEntity`：插入并拿回完整的行

```ts
const doc = await db.insert(Doc).values({ title: 't', createdBy: 'x', secret: 'hush' }).returnEntity()
// doc.id（自增）、doc.status（库里的默认值）、doc.token（$default）、doc.version（乐观锁初值）都在里面
```

PG、SQLite 用 `RETURNING` 一条语句；MySQL、HANA 先插入拿到主键再按主键查回来（走拦截器过滤，逻辑删除、租户等照常）。`$default` 生成的值（如随机 uuid）只算一次，插入和回查用同一份。需要单行；没有主键的实体不能用。

## 批量更新

`db.update(Post).entities(rows).execute()`：每行按主键一条 `entity(row)` 语句（带乐观锁条件、跳过 `insertOnly` 列），返回总更新行数。不自带事务，要原子请放进 `db.transaction`。批量删除用已有的 `delete(X).where(x => x.id.in(ids))`。

## `afterWrite` 拦截器钩子

```ts
const audit = { name: 'audit', afterWrite: (e) => log(`${e.kind} ${e.entity.table} ${e.affected}`) }
createDb({ schema, adapter, interceptors: [audit] })
```

`insert / update / delete`（含 `returnId`、`returning`、`fromQuery`、批量更新、逻辑删除）成功执行之后调用，参数是种类（逻辑删除的 delete 仍是 `'delete'`）、实体和影响的行数。**钩子在同一个事务里**，抛错会让这次写入失败、事务回滚——可以当作"否决"用；做审计日志也在这里。`noInterceptor` 对写入无效（它只作用于查询）。

## 验证与限制

SQLite、MySQL 8.0.18 / 8.4、PG 17 实测（含 `save` 失败整体回滚、afterWrite 抛错回滚事务）。Java 版 `Savable` 的多层级联、多对多保存、按差异比较保存没有做。
