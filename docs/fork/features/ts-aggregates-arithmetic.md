# TS：根查询聚合、数值算术、批量插入分块

## 根查询聚合（7.1）

不必借 `groupBy`，整条查询直接折成一个值，沿用 `where` 和拦截器（租户等）条件，排序被丢掉：

```ts
const total = await db.queryable(Post).where(p => p.userId.eq(1)).sum(p => p.amount)   // decimal 列得到数值文字，没有行时 null
const newest = await db.queryable(User).max(u => u.createdAt)                           // Date | null
const buyers = await db.queryable(Post).countDistinct(p => p.userId)                    // number
```

`sum / avg / max / min / countDistinct`。`sum`、`avg` 只接受数值列（类型见下），对字符串列调用编译不过。同时调用 `limit()` / `offset()` 会报错：聚合发生在分页之后没有意义，悄悄返回错误数字比报错更糟。

## 数值算术（7.2）

`plus / minus / times / div` 以及 `sum / avg`、窗口里的 `win.sum / win.avg` 接受 `Numeric`：

| 列 | JS 类型 | 算术右边可以写 |
|---|---|---|
| `col.int()` / `col.double()` | `number` | `number`、同类型表达式 |
| `col.bigint({ mode: 'bigint' })` | `bigint` | `bigint`、表达式（不混入 number，免得把浮点数带进 64 位运算） |
| `col.decimal()` | 数值文字 `` `${number}` `` | 数值文字、`number`、表达式 |
| `decimalJs()`（@zerodep-dev/easy-query-ts-decimal） | `Decimal` | `Decimal`、`number`、表达式 |

decimal 列的 JS 类型是 `` `${number}` `` 而不是 `string`：`'10.50'` 这样的字面量可以直接写入，普通字符串列不会误用算术。需要表示"来自变量的数值文字"时用 `as const` 或 `` `${n}` ``。

`Numeric` 和 `Temporal` 是**声明合并的扩展点**：第三方数值 / 日期类型在自己的包里登记，核心不依赖任何库，登记后算术、聚合、`year()/month()/day()` 自动认它（见 [ts-column-types.md](ts-column-types.md)）。

## 批量插入分块（7.3）

`values(rows)` 按方言的绑定参数上限自动切成多条语句（每条至少一行），不用自己分批：

| 方言 | `maxBindParams` |
|---|---|
| SQLite | 32766 |
| MySQL、PG | 65535 |
| HANA | 32766（保守值，未实测上限） |

超长的 `in(...)` 列表没法这样拆（总参数数是整条语句的限制）：渲染时超过上限直接报 `statement binds more than N parameters …`，而不是等数据库返回含糊的错误。超大列表请分批查询，或改用临时表 / PG 的数组参数（`= ANY($1)`，进 BACKLOG）。

## 验证

SQLite、MySQL 8.0.18、MySQL 8.4、PG 17 实测（`packages/test/src/suite.ts`）；HANA 未跑。
