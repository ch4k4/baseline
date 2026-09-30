#!/usr/bin/env bash
# db.sh - padanan db.ps1 untuk Linux/WSL/CI. Perintah sama:
#   ./db.sh setup | reset | migrate | test | psql
#
# Variabel lingkungan (semua punya default untuk dev lokal):
#   DEMO_DB_NAME DEMO_DB_HOST DEMO_DB_PORT
#   DEMO_DB_SUPER DEMO_DB_SUPER_PASSWORD
#   DEMO_DB_OWNER_PASSWORD DEMO_DB_USER_PASSWORD
set -euo pipefail

ACTION="${1:-setup}"
DB_NAME="${DEMO_DB_NAME:-saas_demo}"
DB_HOST="${DEMO_DB_HOST:-127.0.0.1}"
DB_PORT="${DEMO_DB_PORT:-5432}"
SUPER="${DEMO_DB_SUPER:-postgres}"
OWNER_PW="${DEMO_DB_OWNER_PASSWORD:-devowner}"
USER_PW="${DEMO_DB_USER_PASSWORD:-devuser}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/migrations"
TESTS="$ROOT/tests"

step() { printf '  -> %s\n' "$1"; }

# Superuser: pakai peer auth via `su postgres` bila password tidak diset.
super_psql() {
  if [ -n "${DEMO_DB_SUPER_PASSWORD:-}" ]; then
    PGPASSWORD="$DEMO_DB_SUPER_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$SUPER" -v ON_ERROR_STOP=1 -q "$@"
  else
    su "$SUPER" -c "psql -v ON_ERROR_STOP=1 -q $(printf '%q ' "$@")"
  fi
}
as_owner() { PGPASSWORD="$OWNER_PW" psql -h "$DB_HOST" -p "$DB_PORT" -U app_owner -d "$DB_NAME" -v ON_ERROR_STOP=1 -q "$@"; }
as_user()  { PGPASSWORD="$USER_PW"  psql -h "$DB_HOST" -p "$DB_PORT" -U app_user  -d "$DB_NAME" -v ON_ERROR_STOP=1    "$@"; }

do_drop()   { step "hapus database $DB_NAME"; super_psql -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)"; }
do_create() {
  step "buat database $DB_NAME"
  super_psql -d postgres -c "CREATE DATABASE $DB_NAME"
  # Zona waktu server SENGAJA bukan UTC (D-40). Cacat kelas ini - Prisma membaca
  # timestamptz sebagai jam dinding sesi database lalu melabelinya UTC - tidak
  # menimbulkan gejala apa pun bila server berjalan UTC, sehingga lingkungan
  # pengembangan yang UTC lebih bersih daripada mesin tempat kode akan berjalan dan
  # tidak dapat menemukannya. Sampai slice 14 aturan ini hanya tertulis di AUDIT.md;
  # ia hilang pada `reset` berikutnya. Sekarang skrip yang menegakkannya.
  step "zona waktu database dipatok Asia/Jakarta (bukan UTC, sengaja - D-40)"
  super_psql -d postgres -c "ALTER DATABASE $DB_NAME SET TimeZone='Asia/Jakarta'"
  step "role, schema auth, grant dasar (0001)"
  super_psql -d "$DB_NAME" -v "owner_pw=$OWNER_PW" -v "user_pw=$USER_PW" -v "db_name=$DB_NAME" -f "$MIG/0001_roles.sql"
}
# Pemasangan migrasi TIDAK lagi berupa perulangan di skrip ini.
#
# Sebabnya: perulangan "jalankan semua berkas" hanya dapat bekerja pada database yang
# baru dibuat, sehingga satu-satunya cara memasang perubahan adalah reset. Untuk
# database yang berisi data - dan untuk baseline yang dipasang ke database tiap produk
# - itu jalan buntu. Pemasang sungguhan ada di `api/scripts/migrate.ts`: ia memasang
# hanya yang belum tercatat di ledger `schema_migrations`, memeriksa checksum berkas
# yang sudah dipasang, dan menolak nomor migrasi ganda. Satu implementasi dipakai
# db.sh dan db.ps1 - logika yang ditulis dua kali akan berbeda dua kali.
do_migrate() {
  local api="$ROOT/../api"
  # Pemasang adalah TypeScript, jadi ia dibangun lebih dulu. Hanya `tsc`, bukan
  # `prisma generate`: klien Prisma ada di repo, dan pemasang tidak memerlukannya.
  step "bangun pemasang migrasi"
  ( cd "$api" && node node_modules/typescript/bin/tsc -p tsconfig.json )
  step "pasang migrasi lewat ledger (${1:-migrate})"
  ( cd "$api" && DEMO_DB_NAME="$DB_NAME" DEMO_DB_HOST="$DB_HOST" DEMO_DB_PORT="$DB_PORT" \
      DEMO_DB_OWNER_PASSWORD="$OWNER_PW" node dist/scripts/migrate.js "${1:-migrate}" )
}
do_seed() { step "seed demo (0005, sebagai superuser)"; super_psql -d "$DB_NAME" -f "$MIG/0005_seed_demo.sql"; }

# Identitas demo (email, nama, password) dibuat oleh seed Node, bukan SQL: sejak
# D-01 email dan nama dienkripsi di aplikasi sebelum menyentuh database, dan SQL
# tidak memegang kunci. Langkah ini WAJIB - tanpanya tidak ada satu user pun, dan
# tes berikutnya gagal dengan pesan yang menuding ke tempat yang salah. Karena
# itu kegagalannya menghentikan proses, bukan sekadar peringatan.
do_identities() {
  local api="$ROOT/../api"
  if [ -z "${DEMO_DB_SUPER_PASSWORD:-}" ]; then echo "DEMO_DB_SUPER_PASSWORD belum diset" >&2; exit 2; fi
  command -v node >/dev/null || { echo "node tidak ditemukan di PATH" >&2; exit 2; }
  [ -f "$api/node_modules/typescript/bin/tsc" ] && [ -f "$api/node_modules/prisma/build/index.js" ] || { echo "jalankan dulu: (cd app/api && npm install)" >&2; exit 2; }
  step "generate klien Prisma (skema tetap dari db/migrations)"
  (cd "$api" && node node_modules/prisma/build/index.js generate --no-hints)
  step "build API (seed memakai kode kripto yang sama dengan API)"
  (cd "$api" && node node_modules/typescript/bin/tsc -p tsconfig.json)
  step "seed identitas demo terenkripsi"
  (cd "$api" && node dist/scripts/seed-demo.js)
  # Superadmin platform TIDAK ikut seed (ADR-003 sec.2.5): perintah tersendiri,
  # idempoten, dan mencatat audit hanya bila hak benar-benar diberikan.
  step "bootstrap superadmin platform"
  (cd "$api" && node dist/scripts/bootstrap-superadmin.js)
}

# Tes SQL berjalan sebagai app_user, yang (dengan benar) tidak dapat membaca users
# maupun menghitung blind index - kuncinya tidak ada di database. Blind index satu
# identitas uji diambil superuser dan diserahkan sebagai variabel psql.
multi_email_bi() {
  PGPASSWORD="${DEMO_DB_SUPER_PASSWORD:-}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$SUPER" -d "$DB_NAME" -X -t -A \
    -c "SELECT encode(email_blind_index, 'hex') FROM users WHERE id = 'cccccccc-0000-0000-0000-000000000001'"
}

do_test() {
  local bi; bi="$(multi_email_bi)"
  if [ -z "$bi" ]; then echo "identitas uji belum ada - jalankan: ./db.sh reset" >&2; exit 2; fi
  for t in $(ls "$TESTS"/*_test.sql | sort); do
    step "tes $(basename "$t") sebagai app_user"; as_user -v "multi_email_bi=$bi" -f "$t"
  done
}

case "$ACTION" in
  setup)   do_create; do_migrate; do_seed; do_identities; do_test ;;
  reset)   do_drop; do_create; do_migrate; do_seed; do_identities; do_test ;;
  migrate) do_migrate ;;
  status)  do_migrate status ;;
  stamp)   do_migrate stamp ;;
  test)    do_test ;;
  passwords|seed) do_identities ;;
  psql)    PGPASSWORD="$USER_PW" psql -h "$DB_HOST" -p "$DB_PORT" -U app_user -d "$DB_NAME" ;;
  *) echo "aksi tidak dikenal: $ACTION" >&2; exit 2 ;;
esac
