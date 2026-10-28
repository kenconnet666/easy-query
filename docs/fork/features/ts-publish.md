# TS：构建与发布

开发和测试**直接跑 `src` 里的 `.ts`**（Node 24 类型剥离），不需要先构建；发布时才产出 `dist`。

```bash
cd ts
pnpm run build          # tsc -b tsconfig.build.json：按依赖顺序构建所有要发布的包
pnpm run check          # typecheck + build + test
```

## 怎么做的

- 每个包有 `tsconfig.build.json`（继承 `ts/tsconfig.build.base.json`），用 **TypeScript 项目引用**（`composite`）：依赖核心包的包在构建时读取核心产出的 `.d.ts`，不会把核心的源码再编译一遍。
- 源码里的相对导入写 `.ts`（Node 直接运行需要），构建时由 `rewriteRelativeImportExtensions` 改成 `.js`。
- `package.json` 里 `exports` 指向 `src/index.ts`（开发），`publishConfig.exports / main / types` 指向 `dist`；`pnpm pack` / `pnpm publish` 时用 `publishConfig` 覆盖，`workspace:^` 会换成真实版本号。**Node 不会对 `node_modules` 里的 `.ts` 做类型剥离**，所以不能把 `src` 当入口发布。`prepack` 会先构建，保证 `dist` 是最新的。
- `@zerodep-dev/easy-query-ts-hana` 的 d.ts 不再引用 `hdb` 的类型（`HdbClientOptions` 自己声明），使用者不需要给 `hdb` 补类型。
- CI 的 ts job 在 typecheck 之后跑 `pnpm run build`。

## 包

| npm 包 | 内容 |
|---|---|
| `@zerodep-dev/easy-query-ts` | 核心（实体、关系、查询与写入构建器、方言基类），零依赖 |
| `@zerodep-dev/easy-query-ts-sqlite` | SQLite（`node:sqlite`） |
| `@zerodep-dev/easy-query-ts-mysql` | MySQL / PolarDB（`mysql2`，peer） |
| `@zerodep-dev/easy-query-ts-pg` | PostgreSQL（`pg`，peer） |
| `@zerodep-dev/easy-query-ts-hana` | SAP HANA（`hdb`，peer） |
| `@zerodep-dev/easy-query-ts-decimal` | decimal.js 列类型（`decimal.js`，peer） |
| `@zerodep-dev/easy-query-ts-date` | `@internationalized/date` 列类型（peer） |

`@zerodep-dev/easy-query-ts-test` 是测试模块，不发布（`private`）。**核心包在其余包里是 peer 依赖**：适配器、列类型包与你的代码必须共用同一份核心（表达式靠 `instanceof` 识别），重复安装会失灵。

## 发布步骤

由维护者在本机手动执行，CI 不发布（做法同 json-wire）。

1. 要发布的提交已合并到 `main`，GitHub Actions 全部通过；各包 `version` 一致（首发 `0.1.0`）。
2. 本机预检：`cd ts; pnpm install --frozen-lockfile; pnpm run check`。
3. 依次发布，**核心先发**（其余包的 peer 依赖它）。先发到 `next` 标签，在干净项目里验证后再提升到 `latest`：

   ```powershell
   cd ts/packages
   foreach ($p in 'core','sqlite','mysql','pg','hana','decimal','date') {
     pnpm --dir $p publish --access public --tag next
   }
   # 验证通过后：npm dist-tag add @zerodep-dev/easy-query-ts@0.1.0 latest（其余包同理）
   ```

   需要已登录的账号（`npm whoami`）和二次验证码。已发布的版本不能覆盖，npm 的撤销也有严格限制。
4. 发布后打 tag。**仓库的 `release.yml` 由 tag 触发**，tag 名先对照它的触发规则，别误触发 Java 的发布。

## 发布记录

- 2026-10-28：7 个包的 `0.1.0` 发布到 npm（先 `next`，npm 首发时自动把 `latest` 也指向它），随后从真实仓库在干净项目里安装、运行并做类型检查通过。刚发布的包在公共仓库上有几分钟的传播延迟（期间 `npm install` 会 404，已认证的 `npm access list packages` 能看到）。
- 发布用的是环境里的 `NPM_TOKEN`，没有要求二次验证码。
- Maven：`3.3.1-zd.1` 已在 Central（2026-10-28 11:13 UTC+8 发布）；Central 不允许覆盖已发布版本，重复部署会报 `Component … already exists`。下次有 Java 改动要发，先用 `tools/zerodep/release.sh 3.3.1-zd.2` 升版本。springboot4 starter 要用 JDK 17 单独部署。

## 已验证

把 7 个包用 `pnpm pack` 打成 tarball，在干净目录里 `npm install`：Node 直接 `import` 全部包并跑通 SQLite 的建表 + 插入 + `sum`（Decimal、CalendarDate 往返），核心只有一份；用 TypeScript 5.9 做消费者，类型检查通过。`@zerodep-dev/easy-query-ts*` 这些名字在 npm 上尚未被占用，`@zerodep-dev` 组织属于维护者。
