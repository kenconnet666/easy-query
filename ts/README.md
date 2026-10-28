# easy-query TS 版（@zerodep-dev/easy-query-ts*）

与 Java 版 easy-query 同一套思路：实体 + 导航、lambda 里写条件、隐式 join、隐式子查询、对象树结果；结果类型全由 TS 推导，不需要代码生成。
设计与取舍见 [docs/fork/decisions/0002-ts-design.md](../docs/fork/decisions/0002-ts-design.md)。

```ts
import { DatabaseSync } from 'node:sqlite'
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts'
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite'

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
| `@zerodep-dev/easy-query-ts` | 实体、关系、表达式、语法树、方言基类、查询/写入构建器、结果拼装 |
| `@zerodep-dev/easy-query-ts-sqlite` | `node:sqlite`（Node 自带，测试零依赖） |
| `@zerodep-dev/easy-query-ts-mysql` | `mysql2/promise` 连接池；MySQL 8.0.18（PolarDB）起 |
| `@zerodep-dev/easy-query-ts-pg` | `pg`（node-postgres）连接池；PG 12+，自增主键用 RETURNING 取回 |
| `@zerodep-dev/easy-query-ts-hana` | `hdb`（SAP 的纯 JS 驱动，免原生编译）+ 自带小连接池；HANA 2.0，upsert 写成 MERGE，多行插入写成 SELECT … FROM DUMMY UNION ALL |
| `@zerodep-dev/easy-query-ts-decimal` | decimal.js 的 `Decimal` 列（`decimalJs()`）；decimal.js 是 peer 依赖 |
| `@zerodep-dev/easy-query-ts-date` | `@internationalized/date` 的 `CalendarDate / CalendarDateTime / ZonedDateTime / Time` 列；该库是 peer 依赖 |
| `@zerodep-dev/easy-query-ts-test` | 独立测试模块：共用夹具、跨方言套件、类型检查、SQLite 测试（见 [packages/test/README.md](packages/test/README.md)） |

## 开发

```bash
pnpm install
pnpm run typecheck     # tsc（含 50 实体类型样板与类型正负例，在 packages/test/test）
pnpm test              # node --test 直接跑 .ts；设 EQTS_MYSQL_URLS / EQTS_PG_URLS / EQTS_HANA_URL 时再跑对应的实库套件（HANA 不在 CI，本地跑）
```

源码只用可擦除的 TS 语法（`erasableSyntaxOnly`），Node 不经编译直接运行。各方言共用的实库用例在 `packages/test/src/suite.ts`。
