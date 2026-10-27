param(
    # 要装的提交（分支、标签或 SHA），默认 fork 的 main
    [string]$Ref = 'origin/main',
    [string]$Version = '3.3.1-ext-SNAPSHOT',
    [string]$Worktree = 'C:\Users\lionheart\IdeaProjects\eq-ext'
)
# 把 fork 按 $Version 装进本机仓库，给 flow 等使用方验收用（flow 的 eq-fork-acceptance 分支把 easy-query.version 指到这个版本）。
# 在独立的 worktree 里改版本号（versions:set），本仓库主线的 pom 不动；跳过测试、javadoc、签名，不装 sql-test / sql-fork-test / springboot4 starter。
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
git -C $repo fetch -q origin
if (-not (Test-Path $Worktree)) { git -C $repo worktree add -q --detach $Worktree $Ref }
git -C $Worktree checkout -q --detach $Ref
git -C $Worktree reset -q --hard
$env:JAVA_HOME = 'C:\soft\jdk1.8.0_181'
Push-Location $Worktree
try {
    & .\mvnw.cmd -B -q versions:set "-DnewVersion=$Version" '-DgenerateBackupPoms=false' '-DprocessAllModules=true'
    if ($LASTEXITCODE -ne 0) { throw "versions:set failed" }
    & .\mvnw.cmd -B -q -T 4 install '-DskipTests' '-Dgpg.skip=true' '-Dmaven.javadoc.skip=true' '-Dmaven.source.skip=true' `
        '-pl' '!sql-extension/sql-springboot4-starter,!sql-test,!sql-fork-test'
    if ($LASTEXITCODE -ne 0) { throw "install failed" }
    "installed easy-query $Version from $(git rev-parse --short HEAD)"
} finally {
    git -C $Worktree reset -q --hard
    Pop-Location
}
