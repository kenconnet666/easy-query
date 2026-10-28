#!/usr/bin/env bash
# 把 fork 改成自己的 Maven 坐标再发版：groupId com.easy-query → org.dpdns.zerodep.easyquery，版本 上游版本-zd.N。
# 只在发版分支 release/zerodep 上跑（main 保持上游坐标，方便合并上游）；合并 main 之后重跑一次即可，重复跑结果不变。
#
#   bash tools/zerodep/release.sh 3.3.1-zd.1
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION="${1:?用法：tools/zerodep/release.sh <版本，如 3.3.1-zd.1>}"
GROUP=org.dpdns.zerodep.easyquery
FORK=https://github.com/kenconnet666/easy-query

# 现在的版本：根 pom 里 easy-query-all 的 <version>（第一次是上游的 3.3.1，之后是上一次的 fork 版本）
CURRENT=$(sed -n '/<artifactId>easy-query-all<\/artifactId>/{n;n;s/.*<version>\(.*\)<\/version>.*/\1/p;}' pom.xml | head -1)
[ -n "$CURRENT" ] || { echo "读不出根 pom 的版本" >&2; exit 1; }

# 只改本项目自己的构件：groupId 全换；版本只换含本项目 groupId 的 <parent>、<dependency> 块里的，和根 pom 自己的
# （第三方依赖可能碰巧同号，如 HikariCP 3.3.1）
"$(command -v python3 || command -v python)" - "$GROUP" "$CURRENT" "$VERSION" $(git ls-files '*pom.xml') <<'PY'
import re, sys
group, current, version, poms = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
own = f'<version>{current}</version>'
def bump(block):
    text = block.group(0).replace('<groupId>com.easy-query</groupId>', f'<groupId>{group}</groupId>')
    return text.replace(own, f'<version>{version}</version>') if f'<groupId>{group}</groupId>' in text else text
for path in poms:
    s = open(path, encoding='utf-8', newline='').read()
    s = re.sub(r'<(parent|dependency)>.*?</\1>', bump, s, flags=re.S)
    if path == 'pom.xml':
        s = s.replace('<groupId>com.easy-query</groupId>', f'<groupId>{group}</groupId>', 1)
        s = re.sub(r'(<artifactId>easy-query-all</artifactId>\s*<packaging>pom</packaging>\s*)' + re.escape(own), r'\g<1>' + f'<version>{version}</version>', s, count=1)
    open(path, 'w', encoding='utf-8', newline='').write(s)
PY

# 根 pom 的发布元数据：项目地址指向 fork；发布用 settings.xml 里的 central；测试模块不发
"$(command -v python3 || command -v python)" - "$FORK" <<'PY'
import re, sys
fork = sys.argv[1]
path = 'pom.xml'
s = open(path, encoding='utf-8', newline='').read()
s = s.replace('<name>easy-query</name>', '<name>easy-query (zerodep fork)</name>', 1)
s = re.sub(r'(<description>)[^<]*(</description>)',
           r'\1Fork of dromara/easy-query: java object query distributed connector, with more dialects (SAP HANA) and extension points\2', s, count=1)
s = re.sub(r'<url>https://github.com/xuejmnet/easy-query</url>', f'<url>{fork}</url>', s)
s = re.sub(r'<connection>[^<]*</connection>', f'<connection>scm:git:{fork}.git</connection>', s, count=1)
s = re.sub(r'<developerConnection>[^<]*</developerConnection>', f'<developerConnection>scm:git:{fork}.git</developerConnection>', s, count=1)
s = s.replace('<publishingServerId>ossrh</publishingServerId>', '<publishingServerId>central</publishingServerId>')
if '<excludeArtifacts>' not in s:
    s = s.replace('<autoPublish>true</autoPublish>',
                  '<autoPublish>false</autoPublish>\n'
                  '                    <excludeArtifacts>\n'
                  '                        <artifact>sql-test</artifact>\n'
                  '                        <artifact>sql-fork-test</artifact>\n'
                  '                    </excludeArtifacts>')
if 'lionheart' not in s:
    s = s.replace('</developers>',
                  '    <developer>\n'
                  '            <name>lionheart</name>\n'
                  '            <email>kenconnet@foxmail.com</email>\n'
                  f'            <url>{fork}</url>\n'
                  '        </developer>\n'
                  '    </developers>')
open(path, 'w', encoding='utf-8', newline='').write(s)
PY

echo "坐标：${GROUP}:*:${VERSION}（之前是 ${CURRENT}）"
