#!/usr/bin/env bash
set -euo pipefail

/usr/sap/HXE/HDB90/exe/hdbsql -n 127.0.0.1:39017 -d HXE -u SYSTEM \
  -p "${EQ_HANA_PASSWORD:?Set EQ_HANA_PASSWORD}" 'SELECT 1 FROM DUMMY' >/dev/null 2>&1
rm -f /run/eq/password.json
