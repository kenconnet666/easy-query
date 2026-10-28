# @zerodep-dev/easy-query-ts

核心：实体与关系、查询与写入构建器、方言基类。不依赖任何驱动。

easy-query 的 TypeScript 版（[kenconnet666/easy-query](https://github.com/kenconnet666/easy-query) 的 `ts/`）：实体 + 导航、lambda 里写条件、隐式 join 与子查询、对象树结果，结果类型全由 TS 推导，不需要代码生成。

```ts
import { col, createDb, defineSchema, entity } from '@zerodep-dev/easy-query-ts'
import { sqlite } from '@zerodep-dev/easy-query-ts-sqlite'

const User = entity('t_user', { id: col.bigint().primaryKey().generated(), name: col.string() })
const db = createDb({ schema: defineSchema({ User }), adapter: sqlite(database) })
const users = await db.queryable(User).where(u => u.name.like('a')).toList()
```

- 总览与各特性文档：https://github.com/kenconnet666/easy-query/tree/main/docs/fork
- 许可证：Apache-2.0
