# @eqts/test：TS 版的独立测试模块

所有跨方言共用的测试资产都在这里；方言包（mysql / pg / hana）只保留依赖各自驱动的实库测试，并从这里取夹具与共用套件。

| 位置 | 内容 |
|---|---|
| `src/fixture.ts` | 各方言共用的测试实体（Company / User / Post / Comment）与种子数据 |
| `src/suite.ts` | `liveSuite`：同一套用例在 SQLite、MySQL、PG、HANA 上各跑一遍 |
| `src/sqlite-env.ts` | 建好表的 SQLite 内存库（零基础设施，CI 与本地都能跑） |
| `test/*.test.ts` | SQLite 上的 SQL 文本断言与特性测试（按特性分文件） |
| `test/*.check.ts` | 只参与 `tsc` 的类型检查：结果类型正例（`Equal`）与负例（`@ts-expect-error`）、50 实体样板 |

约定：

- 新特性先在 `test/<特性>.test.ts` 里写 SQLite 用例（SQL 文本 + 真实执行），方言差异再到各方言包补实库用例。
- 测试里的每个 `describe` / `it` 描述行为而非实现；非直观的断言前写一行中文注释说明"为什么是这个结果"。
- `stress.check.ts` 由 `tools/gen-stress.ts` 生成，不要手改。
