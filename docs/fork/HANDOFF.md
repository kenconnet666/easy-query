# 交接：在另一台机器上继续

更新于 2026-10-28。进度看 [STATUS.md](STATUS.md)，规划看 [ROADMAP.md](ROADMAP.md)。

## 现在停在哪

- fork 的 `main` 包含 PR #1–#28，CI 绿；没有未合并的 PR。上游 `801aba896` 已经合进来（截至今天上游没有更新的提交）。
- ROADMAP 的"成熟"条件已经满足，M6 收尾里文档索引和回馈清单已完成。没做完的一项：合并上游后重跑全量构建与上游实库基线（这次上游没有新提交，所以没跑；下次合到上游新提交时要跑）。
- 下一步可选：TS 的 T4 `pull`，或者 [BACKLOG.md](BACKLOG.md) 里的条目，或者按 [upstream-candidates.md](upstream-candidates.md) 去上游开 PR。

## 只在旧机器上、不在 git 里的东西

| 东西 | 在哪 | 新机器怎么办 |
|---|---|---|
| 测试库密码与连接串 | `.local/db.env`、`.local/connections.md`（已 gitignore） | 第一次跑 `infra/dev/db.sh` 会自动生成新的一份；想沿用旧密码就把这两个文件拷过去 |
| flow 验收分支 `eq-fork-acceptance`（提交 `8deaf1c`，比 flow master 多 4 个提交） | `C:\Users\lionheart\IdeaProjects\flow-eq-fork`（flow 的 worktree），**按约定从没推送** | 拷贝整个 flow 仓库过去，或 `git bundle create eq-fork.bundle master..eq-fork-acceptance` 后在新机器 `git fetch eq-fork.bundle eq-fork-acceptance:eq-fork-acceptance` |
| json-wire 的 Java 8 分支 `feat/java8`（`917aabf`） | `C:\Users\lionheart\IdeaProjects\json-wire`，只在本地，已 install `0.1.0-SNAPSHOT` 到本机 `~/.m2` | flow 依赖它；同样拷贝仓库或 bundle，新机器上 `mvn install` 一次 |
| 本机 Maven 仓库里的 fork 快照 | `~/.m2` | 新机器全量构建一次即可 |

## 新机器环境

1. JDK 8（业务模块）和 JDK 17（只给 `sql-springboot4-starter`）；仓库带 Maven wrapper，不用另装 Maven。
2. WSL + Docker，起测试库：
   ```bash
   bash infra/dev/db.sh up -d                    # MySQL 8.4、8.0.18（PolarDB 替身）、PG 17、Redis
   bash infra/dev/db.sh --profile hana up -d     # HANA 2.0（镜像约十几 GB，内存至少 8 GB）
   ```
   端口：MySQL 3306 / 3316，8.0.18 在 3318，PG 54321，Redis 55000，HANA 39041。上游基线需要的库和表见 [baseline.md](baseline.md)"准备实库"一节。
3. Node 24 与 pnpm 11（TS 版，`cd ts && pnpm install`）。
4. 全量构建（JDK 8，见仓库根 CLAUDE.md"常用命令"），确认 fork 测试全过；再按需 `-Plive` 跑实库用例。

## 约定提醒

- 只在 fork（`kenconnet666/easy-query`）上开分支、推送、开 PR，CI 绿后 squash 合并；`gh` 命令一律带 `--repo kenconnet666/easy-query`。
- 不推上游、不发布、**不推 tag**（`release.yml` 由 tag 触发）。
- flow 只在本地分支改，不推送；定期把 flow 的 `origin/master` 合进 `eq-fork-acceptance`，把新代码改成 fork 的写法。
- 密钥只放用户级环境变量（`GITHUB_TOKEN`、`CONTEXT7_API_KEY`）和 `.local/`，不进文件与提交。
