#!/usr/bin/env bash
# Restart deterministik: bangun, pastikan port benar-benar kosong, hidupkan,
# pastikan benar-benar melayani. Tanpa ini hasil mutation test menipu.
set -u
AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${DEMO_DB_NAME:-saas_demo}"
HOST="${DEMO_DB_HOST:-127.0.0.1}"
SUPER="${DEMO_DB_SUPER:-postgres}"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../web" && pwd)"
if ! npx next build > ${TMPDIR:-/tmp}/web-build.log 2>&1; then
  echo "BUILD_GAGAL"; grep -E "Type error|Error:" ${TMPDIR:-/tmp}/web-build.log | head -3; exit 3
fi
fuser -k 3000/tcp 2>/dev/null
for i in $(seq 1 15); do curl -s -o /dev/null -m 1 http://127.0.0.1:3000/login || break; sleep 1; done
if curl -s -o /dev/null -m 1 http://127.0.0.1:3000/login; then echo "PORT_MASIH_DIPAKAI"; exit 4; fi
setsid nohup npx next start -p 3000 > ${TMPDIR:-/tmp}/web.log 2>&1 < /dev/null &
for i in $(seq 1 20); do
  curl -s -o /dev/null -m 1 http://127.0.0.1:3000/login && { echo "SIAP"; exit 0; }
  sleep 1
done
echo "TIDAK_SIAP"; exit 5
