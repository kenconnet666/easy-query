# easy-query fork 工作约定

本仓库 fork 自 [dromara/easy-query](https://github.com/dromara/easy-query)（remote `upstream`），目标：更好的扩展性、更方便的用法、更多方言能力（含 SAP HANA），以及一版 TS 实现（`ts/`）。
规划在 [docs/fork/ROADMAP.md](docs/fork/ROADMAP.md)，当前进度与待决在 [docs/fork/STATUS.md](docs/fork/STATUS.md)。每次开工先读这两份。

## 不变的原则

- **软 fork**：持续合并上游。新能力优先放新文件、新模块；改上游已有文件要小、要能单独做成回馈上游的 PR。不改上游的版本号与发布配置。
- **核心能力不另起炉灶**：隐式子查询、lambda 代理、表达式 AST、DTO 导航、VO 对象树映射是骨架。新函数/新能力必须在 普通 where、隐式子查询（any/none/count）、select 到 DTO/VO 三种场景都能用。
- **方言专属能力用静态入口按列包装**：`MySQL.json(u.attrs()).contains(...)`；用户自写扩展与内置同形；错方言在构造表达式时明确报错。
- **Java 8**：业务模块用 `C:\soft\jdk1.8.0_181` 验证；`sql-springboot4-starter` 要求 17，用 `~/.jdks/jbr-17.0.14`。

## 每个工作项的流程

1. 在 ROADMAP 里认领一项，开分支 `feat/…`、`fix/…`、`chore/…`、`docs/…`。
2. **四问**写进 PR 描述：已有能力？（先搜源码与 sql-test 用例）现有写法够方便吗？用户能不改源码扩展吗？半年后不看文档能懂吗？
3. 先写用户侧示例（测试里的调用），再实现。
4. 测试放 `sql-fork-test`（标准 `src/test/java`）：SQL 文本断言进 CI；实库用例放 `live` profile，本地跑。
5. 每个特性一页 `docs/fork/features/<name>.md`：用法、方言支持矩阵、限制。不写过程流水账。
6. 推送、开 PR，CI 绿后 squash 合并到 main，更新 STATUS。

## 遇到这些情况：写进 STATUS 的"待决"，换下一个独立工作项，不猜

- 规划外的新公共顶层概念、或要改上游公共签名、或 core 改动超出小 helper；
- 新增第三方依赖；
- 上游自己的测试由绿变红而原因不在本次改动；
- 需要账号或凭据的事（建仓库、发布、推上游、打 tag——`release.yml` 由 tag 触发，**不要推 tag**）；
- 实库环境起不来。

## 防膨胀

- 边角情况记一行进 [docs/fork/BACKLOG.md](docs/fork/BACKLOG.md)，正确性 bug 除外；除给出清晰报错外不做防御性拒绝。
- 同一变化点第三次出现才抽象；不加只有一个实现的接口。
- 每个里程碑结束：合并上游 main → 全量构建 → 跑上游基线 → 更新 STATUS。

## 常用命令

```bash
# 测试库（WSL Docker；连接与明文密码在 .local/connections.md）
wsl -d Debian -- bash -lc 'cd /mnt/c/Users/lionheart/IdeaProjects/easy-query && bash infra/dev/db.sh up -d'
wsl -d Debian -- bash -lc 'cd /mnt/c/Users/lionheart/IdeaProjects/easy-query && bash infra/dev/db.sh --profile hana up -d'
```

```powershell
# JDK 8 构建全部模块并跑 sql-fork-test（除 springboot4 starter；sql-test 不 install，所以 fork 测试要和它在同一个 reactor 里）
$env:JAVA_HOME='C:\soft\jdk1.8.0_181'; .\mvnw.cmd -B -T 4 '-Dgpg.skip=true' '-Dmaven.javadoc.skip=true' '-Dmaven.source.skip=true' '-pl' '!sql-extension/sql-springboot4-starter' install
# 只改了 fork 测试或单个模块时
$env:JAVA_HOME='C:\soft\jdk1.8.0_181'; .\mvnw.cmd -B -T 4 '-Dgpg.skip=true' '-Dmaven.javadoc.skip=true' '-Dmaven.source.skip=true' -pl sql-fork-test -am test
# 只改了 sql-fork-test 时的快循环（其余模块已 install；sql-test 的 POM 用了 basedir 的 system 依赖，装进仓库后无效，必须同在 reactor 里）
$env:JAVA_HOME='C:\soft\jdk1.8.0_181'; .\mvnw.cmd -B -o '-Dgpg.skip=true' '-Dmaven.javadoc.skip=true' '-Dmaven.source.skip=true' -pl sql-test,sql-fork-test test
# 实库用例（infra/dev 已起；MySQL 8.4、8.0.18 基线、PG）：再加 -Plive，可配 '-Dtest=*LiveTest' '-Dsurefire.failIfNoSpecifiedTests=false'
```

```bash
# 上游实库基线（MySQL、PG、Redis 已起；输出到 target/upstream-baseline）
bash tools/upstream-baseline/run.sh
```

```powershell
# TS 版（ts/，Node 24 直接跑 .ts，pnpm）：类型检查（含类型样板）+ SQLite 单测；设了 EQTS_MYSQL_URLS / EQTS_PG_URLS 时再跑 MySQL / PG 实库套件
cd ts; pnpm install; pnpm run typecheck; $env:EQTS_MYSQL_URLS='mysql://root:root@127.0.0.1:3318,mysql://root:root@127.0.0.1:3306'; $env:EQTS_PG_URLS='postgres://postgres:postgres@127.0.0.1:54321/easy-query-test'; pnpm test
```
