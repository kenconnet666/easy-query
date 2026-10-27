#!/usr/bin/env bash
set -euo pipefail

password=${EQ_HANA_PASSWORD:?Set EQ_HANA_PASSWORD}
if [[ ! $password =~ ^[a-zA-Z0-9]{16,64}$ || ! $password =~ [a-z] || ! $password =~ [A-Z] || ! $password =~ [0-9] ]]; then
  echo 'HANA password must be 16-64 letters and digits with lower case, upper case and digits.' >&2
  exit 1
fi

# SAP 入口脚本只接受 JSON 密码文件，放在私有 tmpfs 里，健康检查通过后删除
umask 077
printf '{"master_password":"%s"}\n' "$password" > /run/eq/password.json
unset password EQ_HANA_PASSWORD
exec /run_hana --passwords-url file:///run/eq/password.json --agree-to-sap-license
