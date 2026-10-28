# TS：构建与发布

开发和测试**直接跑 `src` 里的 `.ts`**（Node 24 类型剥离），不需要先构建；发布时才产出 `dist`。

```bash
cd ts
pnpm run build          # tsc -b tsconfig.build.json：按依赖顺序构建 core、sqlite、mysql、pg、hana、decimal、date
pnpm run check          # typecheck + build + test
```

## 怎么做的

- 每个包有 `tsconfig.build.json`（继承 `ts/tsconfig.build.base.json`），用 **TypeScript 项目引用**（`composite`）：依赖 `@eqts/core` 的包在构建时读取 core 产出的 `.d.ts`，不会把 core 的源码再编译一遍。
- 源码里的相对导入写 `.ts`（Node 直接运行需要），构建时由 `rewriteRelativeImportExtensions` 改成 `.js`。
- `package.json` 里 `exports` 指向 `src/index.ts`（开发），`publishConfig.exports / main / types` 指向 `dist`；`pnpm pack` / `pnpm publish` 时用 `publishConfig` 覆盖，`workspace:*` 会换成真实版本号。**Node 不会对 `node_modules` 里的 `.ts` 做类型剥离**，所以不能把 `src` 当入口发布。
- `@eqts/hana` 的 d.ts 不再引用 `hdb` 的类型（`HdbClientOptions` 自己声明），使用者不需要给 `hdb` 补类型。
- `@eqts/test` 不发布。CI 的 ts job 在 typecheck 之后跑 `pnpm run build`。

## 已验证

把 `core / sqlite / decimal / date` 用 `pnpm pack` 打成 tarball，在干净目录里 `npm install`：Node 直接 `import` 并跑通 SQLite 的插入 + `sum`（Decimal、CalendarDate 往返）；用 TypeScript 5.9 做消费者，类型检查通过。

## 还没做（需要你定）

- 各包仍是 `private: true`，包名 `@eqts/*` 是暂定的（见 [0002](../decisions/0002-ts-design.md)）；发布到 npm 需要账号和最终包名，按 CLAUDE.md 属于"需要账号或凭据的事"，没有动。
- 发布流程（版本号、变更日志、provenance）等包名定了再写。
