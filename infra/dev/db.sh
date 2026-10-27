#!/usr/bin/env bash
# 本地开发数据库的 docker compose 包装：首次运行时在 .local/ 生成密码与连接说明，之后原样转发参数。
# 在 WSL 里从仓库任意位置执行：bash infra/dev/db.sh up -d
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
local_dir="$root/.local"
env_file="$local_dir/db.env"

if [[ ! -f $env_file ]]; then
  mkdir -p "$local_dir"
  # MySQL/PG 用上游 sql-test 写死的账号；HANA 要求 16-64 位且含大小写和数字
  hana_password="Eq$(od -An -N9 -tx1 /dev/urandom | tr -d ' \n')9"
  cat >"$env_file" <<EOF
EQ_MYSQL_ROOT_PASSWORD=root
EQ_PG_PASSWORD=postgres
EQ_POLARDB_PASSWORD=root
EQ_HANA_PASSWORD=$hana_password
EOF
  cat >"$local_dir/connections.md" <<EOF
# 本地开发数据库连接（仅本机，勿提交）

| 库 | JDBC URL | 用户 | 密码 |
|---|---|---|---|
| MySQL 8.4 | jdbc:mysql://127.0.0.1:3306/easy-query-test?serverTimezone=GMT%2B8&characterEncoding=utf-8&useSSL=false&allowMultiQueries=true&rewriteBatchedStatements=true | root | root |
| MySQL 8.4（同一实例，上游 3316 用例） | jdbc:mysql://127.0.0.1:3316/easy-query-test?allowPublicKeyRetrieval=true&useSSL=false | root | root |
| PostgreSQL 17 | jdbc:postgresql://127.0.0.1:54321/easy-query-test | postgres | postgres |
| PolarDB 兼容基线（官方 MySQL 8.0.18） | jdbc:mysql://127.0.0.1:3318/easy-query-test?useSSL=false&serverTimezone=GMT%2B8 | root | root |
| Redis 7.4（上游 BaseTest 用） | redis://127.0.0.1:55000/1 | - | redispw |
| HANA 2.00.088 租户 HXE | jdbc:sap://127.0.0.1:39041 | SYSTEM | $hana_password |
| HANA SYSTEMDB（仅管理） | jdbc:sap://127.0.0.1:39017 | SYSTEM | $hana_password |

启停：bash infra/dev/db.sh up -d ｜ bash infra/dev/db.sh --profile hana up -d ｜ bash infra/dev/db.sh --profile polardb up -d ｜ bash infra/dev/db.sh stop
EOF
  echo "created $env_file and $local_dir/connections.md"
fi

exec docker compose -f "$here/compose.yaml" --env-file "$env_file" "$@"
