# 0002 TS 版设计（草案，待用户审阅）

状态：草案。T0 的类型样板（见末节）通过、用户认可后才开始 T1。

## 目标与边界

- 用法与 easy-query 相似：实体 + 导航、lambda 里写条件、隐式 join、隐式子查询（any/none/count/sum）、include、对象树结果。
- 发挥 TS 的长处：结果类型全自动推导（不用写 DTO 类）、条件可以是数组里的短路表达式、标签模板写原生 SQL 片段。
- **不做**：与 Java 版逐字相同的 SQL；实体追踪 / 工作单元；浏览器运行时；代码生成作为类型来源（`pull` 只是从现有库生成 schema 文件的可选工具，放 T4）。
- 位置：本仓库 `ts/`（pnpm workspace），包名暂用 `@eqts/*`（发布前再定）。Node 24+、ESM、TypeScript 最新稳定版。

## 1. 定义实体与关系

列与关系分开写。关系里 A 引用 B、B 又引用 A 时，写在同一个初始化表达式里会触发 TS 的"在自身初始化中被引用"循环推导错误（Drizzle 也因此把 relations 单独定义）。

```ts
import { entity, col, defineSchema } from '@eqts/core'

export const Company = entity('t_company', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(),
})

export const User = entity('t_user', {
  id: col.bigint().primaryKey().generated(),
  name: col.string(),
  age: col.int().nullable(),
  companyId: col.bigint().nullable(),
  attrs: col.json<{ tags: string[] }>(),
  createdAt: col.datetime(),
})

export const Post = entity('t_post', {
  id: col.bigint().primaryKey().generated(),
  userId: col.bigint(),
  title: col.string(),
  amount: col.decimal(12, 2),
})

export const schema = defineSchema({ Company, User, Post }, r => ({
  User: {
    company: r.one('Company', { from: 'companyId', to: 'id' }),   // companyId 可空 → 导航结果可空
    posts: r.many('Post', { from: 'id', to: 'userId' }),
  },
  Post: { user: r.one('User', { from: 'userId', to: 'id' }) },
}))

export type UserRow = Row<typeof User>    // { id: number; name: string; age: number | null; ... }
```

列名默认按属性名转下划线（`companyId` → `company_id`），`col.string().named('USER_NAME')` 覆盖。

**值类型的默认映射**（都可用 `col.custom({ read, write })` 或 `.codec(...)` 换）：

| 列 | TS 类型 | 说明 |
|---|---|---|
| `int`、`bigint` | `number` | bigint 超出安全整数读时报错；`col.bigint({ mode: 'bigint' \| 'string' })` 可改 |
| `decimal` | `string` | 不经过浮点 |
| `datetime`、`timestamp` | `Date` | 按 UTC 读写，可配置时区 |
| `date`、`time` | `string` | `'2026-10-27'`、`'08:30:00'`，避免时区平移 |
| `json<T>()` | `T` | 读写时 JSON 编解码，codec 可换 |
| `boolean` | `boolean` | |

## 2. 创建 db

```ts
import { createDb } from '@eqts/core'
import { mysql } from '@eqts/mysql'          // 方言 + 驱动适配（mysql2 是可选 peer 依赖）

const db = createDb({
  schema,
  dialect: mysql({ pool }),                 // 也有 pg()、sqlite()、hana()
  interceptors: [tenant(() => currentTenantId()), touch('updatedAt')],
  logSql: true,
})
```

拦截器对应 easy-query 的谓词拦截与写入拦截：查询时给有租户列的表加条件，插入/更新时补值；单条查询可 `.noInterceptor('tenant')`。

## 3. 查询

```ts
const list = await db.queryable(User)
  .where(u => [
    u.name.like('ts'),
    age != null && u.age.ge(age),                 // false / undefined / null 自动跳过
    u.posts.any(p => p.title.startsWith('orm')),  // 隐式子查询 EXISTS
    or(u.age.isNull(), u.age.lt(18)),
  ])
  .orderBy(u => [u.createdAt.desc(), u.id])
  .select(u => ({
    id: u.id,
    companyName: u.company.name,                   // 隐式 LEFT JOIN，推导为 string | null
    postCount: u.posts.count(),                    // 关联子查询
    total: u.posts.where(p => p.amount.gt('0')).sum(p => p.amount),   // string | null
    posts: u.posts.orderBy(p => p.id).toList(p => ({ title: p.title })), // 对象树，第二条查询按 IN 拉取后拼装
  }))
  .toList()
// list 的类型：{ id: number; companyName: string | null; postCount: number; total: string | null; posts: { title: string }[] }[]
```

- 终结方法：`toList()`、`first()`（可能 undefined）、`single()`（不存在抛错）、`count()`、`any()`、`toPage(page, size)` → `{ rows, total }`。
- 不写 `select` 时返回整行 `UserRow`；`.include(u => u.posts, q => q.where(...))` 把导航挂到整行上，类型变成 `UserRow & { posts: PostRow[] }`。
- 条件组合：数组 = AND；`or(...)`、`and(...)`、`not(...)` 是普通函数；比较方法 `eq ne gt ge lt le in notIn like startsWith endsWith isNull isNotNull between`。
- 隐式子查询：`any / none / count / sum / avg / max / min / toList / first`；可先 `.where(...)` 再聚合。

分组：

```ts
const stats = await db.queryable(Post)
  .groupBy(p => ({ userId: p.userId, year: p.createdAt.year() }))
  .having(g => g.count().gt(3))
  .select(g => ({ ...g.key, n: g.count(), total: g.sum(p => p.amount), big: g.count(p => p.amount.gt('1000')) }))
  .toList()
```

窗口（与 Java 版 M3.4 同步）：`p.amount.sum().over(w => w.partitionBy(p.userId).orderBy(p.id).rows('unboundedPreceding', 'currentRow'))`。

## 4. 写入

```ts
const id = await db.insert(User).values({ name: 'a', companyId: null, attrs: { tags: [] }, createdAt: new Date() }).returnId()
await db.insert(User).values(rows)                                   // 批量
await db.insert(User).values(row).onConflict(u => u.id).merge(u => [u.name])   // upsert；.ignore() 为忽略
const n = await db.update(User).set(u => ({ name: 'b', age: u.age.plus(1) })).where(u => u.id.eq(id)).execute()
await db.update(User).entity(row)                                    // 按主键整行更新
await db.delete(User).where(u => u.id.eq(id)).execute()              // 无 where 的删除要显式 .all()
```

`values` 的参数类型由列推导：`generated()`、带默认值、可空的列是可选的。

## 5. 事务

```ts
await db.transaction(async tx => {
  const user = await tx.queryable(User).where(u => u.id.eq(id)).forUpdate().single()
  await tx.update(User).set({ age: 1 }).where(u => u.id.eq(user.id)).execute()
}, { isolation: 'read committed' })
```

用显式的 `tx` 传递，不依赖 AsyncLocalStorage 的隐式上下文（读代码时一眼看出哪些语句在事务里）。

## 6. 方言专属与原生 SQL

```ts
import { mysql } from '@eqts/mysql'
import { hana } from '@eqts/hana'

db.queryable(User).where(u => mysql.jsonContains(u.attrs, ['vip'], '$.tags'))
db.queryable(Doc).where(d => hana.contains(d.body, 'easy query', { fuzzy: 0.8 }))
  .select(d => ({ id: d.id, score: hana.score() }))

// 原生片段：标签模板，列与参数自动绑定，泛型给出结果类型
db.queryable(User).where(u => sql<boolean>`${u.name} REGEXP ${pattern}`)
  .select(u => ({ len: sql<number>`JSON_LENGTH(${u.attrs})` }))
```

方言入口与 Java 版同形：按列包装，用错方言在构造表达式时报错。用户自己写的方言函数用同一个 `defineFunction` 帮助函数，与内置无差别。

## 7. 包结构

```
ts/
  packages/core      AST、类型、查询构建、渲染基类、执行与结果拼装
  packages/sqlite    node:sqlite（测试零基础设施）
  packages/mysql     mysql2；8.0.18 基线（PolarDB）
  packages/pg        pg
  packages/hana      @sap/hana-client
  test/              跨方言用例（SQL 文本快照 + 本地实库）
```

## 8. T0 类型样板（通过才进 T1）

- 50 个实体、互相引用的关系、5 层导航的 select：`tsc --noEmit` 在限定时间内完成，无 `TS2589`（实例化过深）、无循环推导错误。
- 负例用 `@ts-expect-error` 固定：用错列类型比较、select 引用不存在的列、insert 缺必填列。
- IDE：VS Code / WebStorm 里补全不卡（人工抽查，记录在本文件）。

## 待用户确认的点

1. 列与关系分开定义（`entity` + `defineSchema`）可以接受吗？
2. 条件用数组 + 短路（`age != null && u.age.ge(age)`）作为主要写法，可以吗？
3. 默认值映射：bigint→number（超范围报错）、decimal→string、date→string、datetime→Date。
4. 事务用显式 `tx`，不做隐式上下文。
5. 包名 `@eqts/*` 暂定。
