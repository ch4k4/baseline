#!/usr/bin/env bash
set -uo pipefail
AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${DEMO_DB_NAME:-saas_demo}"
HOST="${DEMO_DB_HOST:-127.0.0.1}"
SUPER="${DEMO_DB_SUPER:-postgres}"
cd "$AKAR/db"
bi=$(PGPASSWORD="${DEMO_DB_SUPER_PASSWORD:?DEMO_DB_SUPER_PASSWORD belum diset}" psql -h "$HOST" -U "$SUPER" -d "$DB" -X -t -A -c "SELECT encode(email_blind_index,'hex') FROM users WHERE id='cccccccc-0000-0000-0000-000000000001'")
rc=0
for t in ${1:-tests/*_test.sql}; do
  out=$(PGPASSWORD="${DEMO_DB_USER_PASSWORD:-devuser}" psql -h "$HOST" -U app_user -d "$DB" -v ON_ERROR_STOP=1 -v multi_email_bi=$bi -f "$t" 2>&1)
  if echo "$out" | grep -q ERROR; then rc=1; echo "== $t"; echo "$out" | grep -E "ERROR|CONTEXT" | head -4; else echo "$(basename $t): $(echo "$out" | grep -oE 'SEMUA [0-9]+ KASUS[^,]*|KASUS [0-9]+ SLICE [0-9]+ LULUS' | tr '\n' '; ')"; fi
done
exit $rc
