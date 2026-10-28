# TS：列类型（decimal.js、64 位整数、`@internationalized/date`、二进制）与扩展

核心不依赖任何第三方库。decimal.js 与 `@internationalized/date` 各是一个独立小包，库本身是 **peer 依赖**（版本由应用决定，避免装两份）。

```ts
import { col, entity } from '@eqts/core'
import { decimalJs } from '@eqts/decimal'
import { calendarDate, calendarDateTime, timeOfDay, zonedDateTime } from '@eqts/date'

export const Order = entity('t_order', {
  id: col.bigint({ mode: 'bigint' }).primaryKey().generated(),   // bigint；超过 2^53 也不丢精度
  amount: decimalJs(12, 2),                                      // decimal.js 的 Decimal
  day: calendarDate(),                                           // CalendarDate
  startsAt: calendarDateTime(),                                  // CalendarDateTime（无时区的墙上时间）
  paidAt: zonedDateTime('Asia/Shanghai'),                        // ZonedDateTime（库里按 UTC 存时刻）
  opensAt: timeOfDay(),                                          // Time
  receipt: col.bytes(),                                          // Uint8Array
})
```

## 与 json-wire、vue-tsx-pro 对接

这些类型正好是 json-wire（zerodep 的 typed JSON 库，Java 与 TypeScript 两边同一套写法）的种类表在 TypeScript 一侧的类型，也是 vue-tsx-pro 日期组件接受的值类型，所以**查询结果可以直接 `stringifyWire(row)` 发给前端，前端 `parseWireJson` 还原后能原样写回**，中间不需要转换：

| 列 | JS 类型 | json-wire 种类 | 库里 |
|---|---|---|---|
| `col.bigint({ mode: 'bigint' })` | `bigint` | `bigint` | BIGINT / DECIMAL(p,0) |
| `decimalJs()` | `Decimal` | `decimal` | DECIMAL / NUMERIC |
| `calendarDate()` | `CalendarDate` | `date` | DATE |
| `timeOfDay()` | `Time` | `time` | TIME |
| `calendarDateTime()` | `CalendarDateTime` | `timestamp` | DATETIME / TIMESTAMP（无时区） |
| `zonedDateTime(zone)`、`col.datetime()` | `ZonedDateTime`、`Date` | `timestamptz` | DATETIME / TIMESTAMP，按 UTC 存 |
| `col.bytes()` | `Uint8Array` | `bytes` | BLOB / BYTEA |

已用 json-wire 的 TypeScript 包做过一次端到端检查：数据库行 → `stringifyWire`（`$types` 自动标出 `decimal / bigint / date / timestamp / timestamptz / time / bytes`）→ `parseWireJson` → 写回数据库，两边的行一致。注意 json-wire 用 `instanceof` 判断类型，应用里 `decimal.js` 与 `@internationalized/date` 必须只有一份（peer 依赖正常安装就是这样）。

## 行为说明

- **bigint**：MySQL 读写走文字，PG 的 int8 以文字返回，都不丢精度；SQLite 要在适配器上打开 `sqlite(db, { bigInts: true })`，否则 node:sqlite 把大于 2^53 的整数读成 number。MySQL 适配器把 bigint 参数写成整数字面量——mysql2 把它当带引号的字符串插值，`BIGINT + '1'` 会按 DOUBLE 运算而丢精度（实测踩到过）。
- **Decimal**：读写都走文字（`toFixed()`，不会写成 `1e+21`），不依赖驱动把 DECIMAL 读成 number 还是 string；`sum / avg` 保持 Decimal。
- **日期**：`calendarDate` 不经过时区；`calendarDateTime` 原样存取墙上时间；`zonedDateTime(zone)` 存时刻（UTC），读出换算到指定时区，所以不同机器、不同会话时区读出的结果一致。三者都可以用 `year() / month() / day() / addDays() / diffDays()`。
- **二进制**：读出的是普通 `Uint8Array`（不是 Buffer）。

## 加自己的类型（扩展点）

三步，和 `@eqts/decimal` 一样，不用改核心：

```ts
import { col } from '@eqts/core'

// 1. 列工厂：kind 是读写口径（未知的 kind 当普通值处理；'decimal' 会让 avg 保持这个类型）
export const money = () => col.custom<Money>('decimal', raw => Money.parse(String(raw)), m => m.toFixed())

// 2.（可选）让算术 / 聚合认它：声明合并
declare module '@eqts/core' { interface NumericExtensions { money: Money } }
// 日期时间类型同理登记到 TemporalExtensions，之后 year() / month() / day() 就能用在它上面
```

## 限制

- HANA 未验证这些类型（建表语句未加进 HANA 实库套件）。
- `Time` 不登记到 `TemporalExtensions`（没有年月日）。
- 直接写 `db.sql\`…\`` 读出的是驱动原始值，不经过列 codec。

## JSON 列与 Standard Schema

```ts
import { z } from 'zod'      // 或 valibot、arktype：任何实现了 Standard Schema 的校验器
const Profile = z.object({ tags: z.array(z.string()), level: z.number().int().min(0) })
const Account = entity('t_account', { id: col.bigint().primaryKey().generated(), profile: col.json(Profile) })
// 行类型里 profile 的类型取自校验器：{ tags: string[]; level: number }
```

- **读出和写入都校验**：写入不合格在发 SQL 之前抛错，读出时库里的旧数据不再符合 schema 也会抛错，消息带上失败的路径（`write: invalid JSON value: level: …`）。
- 只依赖协议里的 `~standard.validate`（核心不引入任何校验库，接口在 `@eqts/core` 里以 `StandardSchema` 导出）；**校验器必须是同步的**，异步的会明确报错。
- 只写泛型的 `col.json<Tags>()` 仍然可用，不做运行时校验。
- 用 zod 4.6.7 验证过（zod 只是测试的开发依赖）。
