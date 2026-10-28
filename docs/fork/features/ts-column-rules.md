# TS：列修饰器（逻辑删除、乐观锁、默认值、枚举、加密）

列定义上的链式修饰器同时写运行时元数据和 TS 类型，对应 Java 的 `@LogicDelete`、`@Version`、`@Encryption` 等注解；因为 TS 的装饰器改不了类型、Node 直接跑 `.ts` 也不认装饰器，所以用链式修饰器（见 [0002 设计](../decisions/0002-ts-design.md)）。

```ts
const Doc = entity('t_doc', {
  id: col.bigint().primaryKey().generated().$type<DocId>(),            // 品牌类型：不同表的 id 不会混用
  status: col.enum(['draft', 'published'] as const).defaulted(),       // 字符串枚举：写入与读出都校验
  deleted: col.boolean().softDelete(),                                 // 逻辑删除
  version: col.int().version(),                                        // 乐观锁
  token: col.string().$default(() => crypto.randomUUID()),             // 插入时没给就生成
  updatedAt: col.datetime().nullable().$onUpdate(() => new Date()),    // 更新时没给就填
  createdBy: col.string().insertOnly(),                                // 更新永远不碰
  secret: col.string().encrypted({ encrypt, decrypt }),                // 透明加解密
})
```

| 修饰器 | 行为 | 插入时 |
|---|---|---|
| `$default(fn)` | 插入时没给值就调用 fn | 可省 |
| `$onUpdate(fn)` | 更新时没给值就调用 fn | — |
| `$type<U>()` | 只改 TS 类型（品牌类型） | — |
| `col.enum([...] as const)` | TS 类型是字面量并集；写入、读出都校验，库里有不认识的值会报错 | — |
| `softDelete()` | 见下 | 可省（写 active） |
| `version()` | 见下 | 可省（写 0） |
| `insertOnly()` | `set` 里给它赋值报错；`entity(row)` 自动跳过它 | — |
| `encrypted({ encrypt, decrypt })` | 写入前加密、读出后解密；要用 `eq` 查询，策略必须是确定性的 | — |

## 逻辑删除

- `delete(X)…` 改写成把标记列设为"已删除"的 `update`，条件不变；**读、改、删**（含导航的 JOIN 与一对多子查询、toList 的第二条查询、多对多的中间表）都自动只看未删除的行——它是内置拦截器，名字 `softDelete`。
- 布尔列默认 `false` / `true`，整数列默认 `0` / `1`；其它类型显式给：`col.datetime().nullable().softDelete({ active: null, deleted: () => new Date() })`（`active: null` 渲染为 `IS NULL`）。
- 单条查询 `noInterceptor('softDelete')` 能看到已删除的行；`delete(X).hard()` 物理删除（绕过过滤，已被逻辑删除的行也会删掉）。

## 乐观锁

- `update(X).entity(row)`：版本列作为条件、同时写入加 1 后的版本；一行都没更新到（被别人改过或删除）抛 `optimistic lock failed`。
- 其它更新（表达式更新、批量更新）没有版本条件，但同样让版本加 1，别人手里的旧版本随之失效。

## 验证与限制

SQLite、MySQL 8.0.18 / 8.4、PG 17 实测；HANA 随 CI 验证。每个实体只支持一个逻辑删除列。`encrypted` 只用于字符串列；非确定性的加密不能用在 `eq` 条件里。Java 的 `@ColumnIgnore` 没有对应物（TS 版的实体和表一一对应，不需要不落库的属性）。
