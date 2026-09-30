#!/usr/bin/env bash
# Mutasi ledger migrasi (fondasi langkah 2). Lihat README.md di folder ini.
#
# Versi pertama harness ini memulihkan L1 dengan menghitung ulang checksum lewat
# pg_read_file, dan pemulihannya GAGAL diam-diam - sehingga enam mutasi berikutnya
# dilaporkan "tertangkap" oleh kasus 1 yang memang sudah merah sejak L1. Persis
# kegagalan yang dilarang README folder ini. Sekarang ledger disalin utuh lebih dulu
# dan dipulihkan dari salinan itu, lalu baseline dibuktikan hijau di akhir.
set -uo pipefail
AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${DEMO_DB_NAME:-saas_demo}"
HOST="${DEMO_DB_HOST:-127.0.0.1}"
SUPER="${DEMO_DB_SUPER:-postgres}"

sup() {
  PGPASSWORD="${DEMO_DB_SUPER_PASSWORD:?DEMO_DB_SUPER_PASSWORD belum diset}" \
    psql -h "$HOST" -U "$SUPER" -d "$DB" -q -v ON_ERROR_STOP=1 -c "$1"
}

tes() {
  out=$(cd "$AKAR/api" && node --test --test-concurrency=1 dist/test/migration.test.js 2>&1)
  if echo "$out" | grep -q "^# fail 0"; then echo "LOLOS (tes tetap hijau!)"
  else echo "tertangkap -> $(echo "$out" | grep -oE 'not ok [0-9]+ - [0-9]+\..{0,60}' | head -1)"; fi
}

pulihkan() {
  sup "DELETE FROM schema_migrations; INSERT INTO schema_migrations SELECT * FROM ledger_salinan" >/dev/null
}

run() { # nama, sql-mutasi, sql-pulih-tambahan (boleh kosong)
  local nama="$1" pasang="$2" pulih="${3:-SELECT 1}"
  sup "$pasang" >/dev/null 2>&1 || { echo "$nama: PASANG GAGAL"; return; }
  echo "$nama: $(tes)"
  sup "$pulih" >/dev/null 2>&1 || echo "$nama: PULIH GAGAL <-- PERIKSA"
  pulihkan
}

sup "DROP TABLE IF EXISTS ledger_salinan; CREATE TABLE ledger_salinan AS SELECT * FROM schema_migrations" >/dev/null
trap 'sup "DROP TABLE IF EXISTS ledger_salinan" >/dev/null' EXIT

run "L1 checksum di ledger diubah (berkas seolah diedit setelah dipasang)" \
 "UPDATE schema_migrations SET checksum = repeat('b',64) WHERE version = '0013'"

run "L2 satu migrasi hilang dari ledger" \
 "DELETE FROM schema_migrations WHERE version = '0021'"

run "L3 ledger memuat migrasi yang berkasnya tidak ada di repo" \
 "INSERT INTO schema_migrations (component, version, filename, checksum) VALUES ('baseline','9998','0998_hantu.sql', repeat('c',64))"

run "L4 nama berkas di ledger berbeda dari repo" \
 "UPDATE schema_migrations SET filename = '0021_menu.sql' WHERE version = '0021'"

run "L5 app_user diberi hak baca ledger" \
 "GRANT SELECT ON schema_migrations TO app_user" \
 "REVOKE SELECT ON schema_migrations FROM app_user"

run "L6 CHECK bentuk version dilonggarkan" \
 "ALTER TABLE schema_migrations DROP CONSTRAINT schema_migrations_version_ck" \
 "ALTER TABLE schema_migrations ADD CONSTRAINT schema_migrations_version_ck CHECK (version ~ '^[0-9]{4}[a-z]?\$')"

run "L7 CHECK bentuk checksum dilonggarkan" \
 "ALTER TABLE schema_migrations DROP CONSTRAINT schema_migrations_checksum_ck" \
 "ALTER TABLE schema_migrations ADD CONSTRAINT schema_migrations_checksum_ck CHECK (checksum ~ '^[0-9a-f]{64}\$')"

run "L8 CHECK bentuk component dilonggarkan" \
 "ALTER TABLE schema_migrations DROP CONSTRAINT schema_migrations_component_ck" \
 "ALTER TABLE schema_migrations ADD CONSTRAINT schema_migrations_component_ck CHECK (component ~ '^[a-z][a-z0-9_-]*\$')"

# Baseline dibaca terbalik dari mutasi: di sini HIJAU adalah yang benar.
out=$(cd "$AKAR/api" && node --test --test-concurrency=1 dist/test/migration.test.js 2>&1)
if echo "$out" | grep -q "^# fail 0"; then echo "baseline setelah pemulihan: HIJAU"
else echo "baseline setelah pemulihan: MERAH <-- PERIKSA"; fi
