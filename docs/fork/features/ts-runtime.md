# TS：流式读取、取消、嵌套事务、`await using`、只读事务

## 流式读取 `stream()`

```ts
for await (const order of db.queryable(Order).orderBy(o => o.id).stream({ batchSize: 500 })) {
  await export(order)            // 不把整个结果集读进内存
}
```

| 方言 | 实现 |
|---|---|
| MySQL | mysql2 的结果流；池级会话借一条专用连接，读完归还，**中途 `break` 就销毁这条连接**（服务端随之终止查询）；事务里中途放弃时把剩余的行读掉丢弃，事务照常可用 |
| PG | 服务端游标：`DECLARE … CURSOR` + 分批 `FETCH`（池级自动开临时事务，事务里直接声明），不需要 `pg-cursor` 依赖 |
| SQLite | `node:sqlite` 的 `iterate` |
| HANA | 驱动没有流：退化成一次读完再分批产出（API 一致，没有省内存） |

不能和 `toList()` 导航（对象树）一起用——对象树要先拿到所有父行，会报错。`onExecute` 在流结束（或被放弃）时触发，`rows` 是实际产出的行数。

## 取消 `withSignal`

```ts
const rows = await db.withSignal(AbortSignal.timeout(5000)).queryable(Order).toList()
```

通过这个 Db 发出的所有语句（含事务、`db.sql`、`stream()`）遵守信号：已取消的信号让新语句直接失败；执行中取消则**不再等待**，立刻以信号的 `reason` 失败（超时是 `TimeoutError`）。**这只是"客户端不再等"，数据库里的语句不会被终止**——真正终止要各驱动的取消协议（MySQL `KILL QUERY`、PG `pg_cancel_backend`），没有做。

## 嵌套事务（保存点）

```ts
await db.transaction(async tx => {
  await tx.insert(A).values(a).execute()
  try {
    await tx.transaction(async inner => { await inner.insert(B).values(b).execute(); throw new Error('x') })
  } catch { /* B 回滚了，A 还在 */ }
})
```

在事务里再调用 `transaction()` 开的是保存点：成功就释放，失败只回滚到保存点，异常仍然抛出（由你决定吞不吞）。嵌套事务不能改隔离级别或只读（要在最外层设）。HANA 没有 `RELEASE SAVEPOINT`，跳过这一步。

## `await using`（Node 24 / TS 5.2+）

```ts
await using tx = await db.begin({ isolation: 'repeatable read' })
await tx.insert(User).values(row).execute()
if (bad) return                  // 提前返回：离开作用域自动回滚
await tx.commit()                // 提交之后再离开作用域是安全的（回滚是空操作）
```

`begin()` 用驱动现有的回调式事务实现：回调里等一个"提交 / 回滚"的决定，决定下来回调才返回，驱动随即提交或回滚，所以各库行为与 `transaction()` 完全一致。`commit()` / `rollback()` 只能各用一次，已结束再 `commit()` 报错。

## 只读事务

`db.transaction(work, { readOnly: true })`：MySQL `START TRANSACTION READ ONLY`、PG `BEGIN … READ ONLY`、HANA `SET TRANSACTION READ ONLY`；SQLite 没有只读事务，用 `PRAGMA query_only` 让写入被拒绝，事务结束后还原。

## 验证与限制

SQLite、MySQL 8.0.18 / 8.4、PG 17 实测；HANA 随 CI（流式读取、保存点释放、只读事务的 HANA 写法按文档，未实库验证）。实测中发现并修了 MySQL 池级流式读取中途放弃会泄漏连接的问题。
