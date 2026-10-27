#!/usr/bin/env bash
# 上游 sql-test 的实库基线：逐类跑 JUnit 4，结果写成 TSV，与 known-failures-3.3.1.tsv 对照（见 docs/fork/baseline.md）。
# 前提：infra/dev 的 MySQL、PG、Redis 已起（bash infra/dev/db.sh up -d），且已在仓库根目录执行过一次 JDK 8 的 install。
# 用法（Git Bash，仓库根目录）：bash tools/upstream-baseline/run.sh [输出目录]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
out=${1:-$root/target/upstream-baseline}
java_home=${JAVA_HOME_8:-/c/soft/jdk1.8.0_181}
mkdir -p "$out/runner"

"$root/mvnw" -q -o -pl sql-test dependency:build-classpath "-Dmdep.outputFile=$out/cp.txt"
cp_line="$(cat "$out/cp.txt");$(cygpath -w "$root/sql-test/target/classes");$(cygpath -w "$out/runner")"
"$java_home/bin/javac" -encoding UTF-8 -cp "$cp_line" -d "$out/runner" "$here/BaselineRunner.java"

# 每个 JVM 只跑几个类：各 BaseTest 的静态连接池会累积，跑多了撑爆 MySQL 的 max_connections
run_list() {
  local list=$1 per_jvm=$2 result=$3
  : > "$result"
  local pending="$out/pending.txt"
  cp "$list" "$pending"
  while [ -s "$pending" ]; do
    head -n "$per_jvm" "$pending" > "$out/chunk.txt"
    # 工作目录是 sql-test：部分用例按相对路径读文件
    (cd "$root/sql-test" && "$java_home/bin/java" -Dfile.encoding=UTF-8 -cp "$cp_line" BaselineRunner "$out/chunk.txt" "$result" 600) || true
    awk -F'\t' '$1=="CLASS"{print $2}' "$result" | sort -u > "$out/done.txt"
    grep -vxFf "$out/done.txt" "$list" > "$pending" || true
  done
}
run_list "$here/classes-mysql.txt" 6 "$out/results-mysql.tsv"
run_list "$here/classes-other.txt" 10 "$out/results-other.tsv"
cat "$out/results-mysql.tsv" "$out/results-other.tsv" > "$out/results.tsv"
awk -F'\t' '$1=="CASE"{n[$4]++} END{for(k in n) print k, n[k]}' "$out/results.tsv"
awk -F'\t' '$1=="CASE" && $4!="PASS" && $4!="IGNORED"{split($2,p,"com.easy.query.test."); print p[2] "." $3}' "$out/results.tsv" | sort > "$out/now-failing.txt"
cut -f1 "$here/known-failures-3.3.1.tsv" | sort > "$out/known.txt"
echo "新出现的失败（基线里没有的）："
comm -23 "$out/now-failing.txt" "$out/known.txt" || true
