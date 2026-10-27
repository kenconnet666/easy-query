# easy-query TS 版（@eqts/*）

与 Java 版 easy-query 同一套思路：实体 + 导航、lambda 里写条件、隐式 join、隐式子查询、对象树结果；结果类型全由 TS 推导，不需要代码生成。
设计与取舍见 [docs/fork/decisions/0002-ts-design.md](../docs/fork/decisions/0002-ts-design.md)。

```ts
import { DatabaseSync } from 'node:sqlite'
import { col, createDb, defineSchema, entity } from '@eqts/core'
import { sqlite } from '@eqts/sqlite'

const User = entity('t_user', { id: col.bigint().primaryKey().generated(), name: col.string(), companyId: col.bigint().nullable() })
const Company = entity('t_company', { id: col.bigint().primaryKey().generated(), name: col.string() })
const schema = defineSchema({ User, Company }, {
  User: (r) => ({ company: r.one('Company', { from: 'companyId', to: 'id' }) }),
  Company: (r) => ({ users: r.many('User', { from: 'id', to: 'companyId' }) }),
})

const db = createDb({ schema, adapter: sqlite(new DatabaseSync('app.db')) })
const rows = await db.queryable(Company)
  .where((c) => c.users.any((u) => u.name.startsWith('a')))
  .select((c) => ({ name: c.name, users: c.users.orderBy((u) => u.id).toList((u) => ({ id: u.id, name: u.name })) }))
  .toList()
// rows: { name: string; users: { id: number; name: string }[] }[]
```

| 包 | 内容 |
|---|---|
| `@eqts/core` | 实体、关系、表达式、语法树、方言基类、查询/写入构建器、结果拼装 |
| `@eqts/sqlite` | `node:sqlite`（Node 自带，测试零依赖） |
| `@eqts/mysql` | `mysql2/promise` 连接池；MySQL 8.0.18（PolarDB）起 |
| `@eqts/pg` | `pg`（node-postgres）连接池；PG 12+，自增主键用 RETURNING 取回 |

## 开发

```bash
pnpm install
pnpm run typecheck     # tsc（含 50 实体类型样板与类型正负例）
pnpm test              # node --test 直接跑 .ts；设 EQTS_MYSQL_URLS / EQTS_PG_URLS 时再跑 MySQL / PG 实库套件
```

源码只用可擦除的 TS 语法（`erasableSyntaxOnly`），Node 不经编译直接运行。各方言共用的实库用例在 `packages/core/test/suite.ts`。
