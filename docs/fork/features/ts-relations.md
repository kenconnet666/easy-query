# TS：多对多导航与复合外键

## 多对多

经中间表连接两个实体，中间表也是 schema 里的一个实体（常常是复合主键）：

```ts
const schema = defineSchema({ User, Role, UserRole }, {
  User: r => ({ roles: r.manyToMany('Role', { through: 'UserRole', throughFrom: 'userId', throughTo: 'roleId' }) }),
  Role: r => ({ users: r.manyToMany('User', { through: 'UserRole', throughFrom: 'roleId', throughTo: 'userId' }) }),
})

db.queryable(User).where(u => u.roles.any(r => r.name.eq('admin')))        // EXISTS，经中间表
db.queryable(User).select(u => ({
  name: u.name,
  roles: u.roles.orderBy(r => r.name).toList(r => ({ name: r.name })),        // 第二条查询把中间表 inner join 进来，按 IN 拼装
  top: u.roles.orderBy(r => r.name.desc()).first(r => ({ name: r.name })),    // 每个用户最多一个
}))
```

`any / none / count / sum / … / toList / first / limit` 与一对多导航完全一样。`from` / `to` 是本表与目标表上被中间表引用的列，省略时用各自的主键；`throughFrom` / `throughTo` 是中间表上的列，类型检查只允许中间表的列名。拦截器（租户、逻辑删除等）也作用在中间表上，条件放进它的 ON。

## 复合外键

`from` / `to` 写成列的数组，两边个数必须相同（定义时检查），按位置一一对应：

```ts
Member: r => ({ notes: r.many('Note', { from: ['tenantId', 'id'], to: ['tenantId', 'memberId'] }) }),
Note: r => ({ member: r.one('Member', { from: ['tenantId', 'memberId'], to: ['tenantId', 'id'] }) }),
```

多对一的 JOIN、一对多的子查询、toList 的第二条查询都按整组列匹配。toList 的复合键写成 `(a = ? AND b = ?) OR …`，单列时仍是 `IN`（行值 `IN` 各库支持不一，这样处处可用）。多对一里任何一个 `from` 列可空，目标就可空。

## 验证与限制

SQLite、MySQL 8.0.18 / 8.4、PG 17 实测；HANA 随 CI 验证（只用标准 JOIN / EXISTS）。关系的 `from` / `to` 在运行时统一成数组，`Relation` 类型里是 `readonly string[]`。复合键个数不一致在类型层面检查不了，定义时报错。
