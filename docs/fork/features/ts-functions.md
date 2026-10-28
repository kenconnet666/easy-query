# TS：`caseWhen` 与函数库

## CASE WHEN

```ts
import { caseWhen } from '@zerodep-dev/easy-query-ts'

db.queryable(User).select(u => ({
  name: u.name,
  group: caseWhen(u.age.lt(18), 'minor').when(u.age.lt(65), 'adult').else('unknown'),   // string
  label: caseWhen(u.age.isNull(), u.name.upper()).end(),                                  // 没有 ELSE：string | null
}))
```

结果类型是各分支值类型的并集。条件必须是真正的表达式（不接受 `cond && x` 的跳过写法：CASE 里"跳过"没有明确含义）。可以放在 `where`、`select`、聚合参数里（`sum(p => caseWhen(p.amount.gt('5'), 1).else(0))`）。PG 推断不出 CASE 分支里参数的类型，方言会给字面量加 `CAST`。

## 函数

下标一律按 JS 的习惯（0 起，`substring(start, end)` 左闭右开）；不会悄悄交换写反的下标，而是报错。

| 方法 | 含义 | SQLite | MySQL | PG | HANA* |
|---|---|---|---|---|---|
| `substring(start, end?)` | 子串 | `SUBSTR` | `SUBSTRING` | `SUBSTRING` | `SUBSTRING` |
| `replace(search, to)` | 替换 | `REPLACE` | `REPLACE` | `REPLACE` | `REPLACE` |
| `indexOf(text)` | 位置，没有为 -1 | `INSTR - 1` | `POSITION - 1` | `POSITION - 1` | `LOCATE - 1` |
| `left(n)` / `right(n)` | 前 / 后 n 个字符 | `SUBSTR` + `MAX` 夹边 | `LEFT/RIGHT` | `LEFT/RIGHT` | `LEFT/RIGHT` |
| `abs() floor() ceil()` | 数学 | `floor/ceil` 用取整加修正（不依赖数学函数编译选项） | 原生 | 原生 | 原生 |
| `round(digits = 0)` | 四舍五入 | `ROUND` | `ROUND` | `ROUND(CAST(x AS NUMERIC), d)` | `ROUND` |
| `mod(divisor)` | 取余 | `%` | `MOD` | `MOD` | `MOD` |
| `addDays(n)` / `addMonths(n)` | 加天 / 月（n 可负） | `datetime(x, 'n days')`，结果不带毫秒 | `DATE_ADD … INTERVAL` | `x + INTERVAL 'n day'` | `ADD_DAYS / ADD_MONTHS` |
| `diffDays(other)` | 整天数差 | `julianday(date(a)) - julianday(date(b))` | `DATEDIFF` | `CAST(a AS DATE) - CAST(b AS DATE)` | `DAYS_BETWEEN(b, a)` |
| `nullIf(v)` | 相等得 NULL | 原生 | 原生 | 原生 | 原生 |
| `cast('string' \| 'int' \| 'bigint' \| 'double' \| 'decimal' \| 'date' \| 'datetime')` | 类型转换（decimal 要给精度与小数位） | 见 `SqliteDialect` | `CHAR / SIGNED / DOUBLE …` | 标准类型名，字符串用 `TEXT` | `NVARCHAR(5000) / DOUBLE …` |

\* HANA 一栏按官方文档写，**本机没有 HANA 实例，未实库验证**；SQLite、MySQL 8.0.18 / 8.4、PG 17 均实测通过。

限制：

- 位置、长度、天数、月数写成整数字面量（校验为整数后直接进 SQL），不占绑定参数——PG 的 `SUBSTRING` 等对参数类型很挑。
- `diffDays` 只看日期部分；`addMonths` 遇到月末按各库自己的规则收敛。
- 对 `Expr<string>` 以外的类型调用字符串函数、对非数值调用数学函数，编译期报错（`this` 参数限定）。

## 自己加函数

在方言函数表里登记名字，再用 `dialectFn('名字', [参数…])` 构造表达式；写法见 [dialect-functions.md](dialect-functions.md) 的"自写扩展"，TS 版同形（`Dialect.functions()` + `dialectFn`）。
