#!/usr/bin/env bash
# Mutasi database slice 16 (provisioning tenant). Lihat README.md di folder ini.
set -uo pipefail
AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${DEMO_DB_NAME:-saas_demo}"
HOST="${DEMO_DB_HOST:-127.0.0.1}"
OWNER="${DEMO_DB_OWNER:-app_owner}"
own() {
  PGPASSWORD="${DEMO_DB_OWNER_PASSWORD:-devowner}" \
    psql -h "$HOST" -U "$OWNER" -d "$DB" -q -v ON_ERROR_STOP=1 -c "$1"
}
tes() {
  out=$(cd "$AKAR/api" && node --test --test-concurrency=1 dist/test/slice16.test.js 2>&1)
  if echo "$out" | grep -q "^# fail 0"; then echo "LOLOS (tes tetap hijau!)"
  else echo "tertangkap -> $(echo "$out" | grep -oE 'not ok [0-9]+ - [0-9]+\..{0,58}' | head -1)"; fi
}
# Pemulihan DIBUKTIKAN, tidak diasumsikan. Versi pertama harness ini menganggap
# `own "$pulih"` selalu berhasil; ketika satu pemulihan gagal diam-diam, fungsi versi
# mutasi tertinggal di database dan kasus 6 gagal pada jalur berikutnya - dengan pesan
# yang menuding penjaga yang salah. Sekarang setiap mutasi memeriksa bahwa penanda
# mutasinya (IF FALSE THEN) benar-benar hilang dari database sesudah pemulihan.
sisa_mutasi() {
  PGPASSWORD="${DEMO_DB_OWNER_PASSWORD:-devowner}" psql -h "$HOST" -U "$OWNER" -d "$DB" -X -t -A -c \
    "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'auth' AND p.prosrc LIKE '%IF FALSE THEN%'"
}
run() { # nama, pasang, pulih
  local nama="$1" pasang="$2" pulih="$3"
  own "$pasang" >/dev/null 2>&1 || { echo "$nama: PASANG GAGAL"; return; }
  echo "$nama: $(tes)"
  own "$pulih" >/dev/null 2>&1 || echo "$nama: PULIH GAGAL <-- PERIKSA"
  if [ "$(sisa_mutasi)" != "0" ]; then echo "$nama: MUTASI MASIH TERPASANG <-- PERIKSA"; fi
}

# Definisi asli diambil dari berkas migrasi supaya pemulihan tidak pernah menjadi
# salinan tangan yang sudah basi.
ASLI="$AKAR/db/migrations/0023_tenant_provisioning.sql"

# F-28 dengan salah satu syaratnya dilepas. Tiga syarat, tiga mutasi.
f28() { # kondisi-yang-diganti
  python3 - "$ASLI" "$1" <<'PY'
import re, sys
teks = open(sys.argv[1]).read()
awal = teks.index('CREATE FUNCTION auth.provision_tenant_owner')
akhir = teks.index('$$;', awal) + 3
fungsi = teks[awal:akhir].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
lama, baru = sys.argv[2].split('=>')
assert fungsi.count(lama) == 1, f'pola {fungsi.count(lama)}x'
print(fungsi.replace(lama, baru))
PY
}
f28_asli() {
  python3 - "$ASLI" <<'PY'
import sys
teks = open(sys.argv[1]).read()
awal = teks.index('CREATE FUNCTION auth.provision_tenant_owner')
akhir = teks.index('$$;', awal) + 3
print(teks[awal:akhir].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))
PY
}
f27() {
  python3 - "$ASLI" "$1" <<'PY'
import sys
teks = open(sys.argv[1]).read()
awal = teks.index('CREATE FUNCTION auth.provision_tenant_roles')
akhir = teks.index('$$;', awal) + 3
fungsi = teks[awal:akhir].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
if sys.argv[2] != '-':
    lama, baru = sys.argv[2].split('=>')
    assert fungsi.count(lama) == 1, f'pola {fungsi.count(lama)}x'
    fungsi = fungsi.replace(lama, baru)
print(fungsi)
PY
}
f26() {
  python3 - "$ASLI" "$1" <<'PY'
import sys
teks = open(sys.argv[1]).read()
awal = teks.index('CREATE FUNCTION auth.create_tenant_key')
akhir = teks.index('$$;', awal) + 3
fungsi = teks[awal:akhir].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
if sys.argv[2] != '-':
    lama, baru = sys.argv[2].split('=>')
    assert fungsi.count(lama) == 1, f'pola {fungsi.count(lama)}x'
    fungsi = fungsi.replace(lama, baru)
print(fungsi)
PY
}

run "P1 F-28 tanpa syarat status PROVISIONING" \
 "$(f28 "IF v_status IS DISTINCT FROM 'PROVISIONING' THEN=>IF FALSE THEN")" "$(f28_asli)"
run "P2 F-28 tanpa syarat tenant belum punya anggota" \
 "$(f28 "IF v_ada > 0 THEN=>IF FALSE THEN")" "$(f28_asli)"
run "P3 F-28 tanpa syarat identitas ACTIVE" \
 "$(f28 "IF v_user_status IS DISTINCT FROM 'ACTIVE' THEN=>IF FALSE THEN")" "$(f28_asli)"
run "P4 F-27 tanpa syarat status PROVISIONING" \
 "$(f27 "IF v_status IS DISTINCT FROM 'PROVISIONING' THEN=>IF FALSE THEN")" "$(f27 -)"
run "P5 F-27 memakai daftar template beku untuk role owner" \
 "$(f27 "IF v_role.includes_all_tenant_permissions THEN=>IF FALSE THEN")" "$(f27 -)"
run "P6 F-26 menerima purpose platform" \
 "$(f26 "IF p_purpose LIKE 'platform_%' OR p_tenant_id IS NULL THEN=>IF FALSE THEN")" "$(f26 -)"
run "P7 template role dapat ditulis app_user" \
 "GRANT INSERT, UPDATE, DELETE ON role_templates TO app_user" \
 "REVOKE INSERT, UPDATE, DELETE ON role_templates FROM app_user"
# P8 dan P9 diperiksa terhadap tes SQL, bukan tes API: yang dijaga adalah policy pada
# lapisan database, dan tes API selalu memanggil endpoint platform - context yang
# memang lolos. Tes API karena itu TIDAK dapat menangkapnya (terbukti: versi pertama
# P8 lolos seluruh suite API).
tes_sql() {
  if ( cd "$AKAR/db" && "$AKAR/mutations/sqltest.sh" tests/slice16_test.sql ) 2>&1 | grep -q "LULUS"; then
    echo "LOLOS (tes tetap hijau!)"
  else echo "tertangkap -> kasus SQL slice 16"; fi
}
run_sql() {
  local nama="$1" pasang="$2" pulih="$3"
  own "$pasang" >/dev/null 2>&1 || { echo "$nama: PASANG GAGAL"; return; }
  echo "$nama: $(tes_sql)"
  own "$pulih" >/dev/null 2>&1 || echo "$nama: PULIH GAGAL <-- PERIKSA"
}

run_sql "P8 policy platform_insert tanpa syarat context platform" \
 "ALTER POLICY platform_insert ON tenants WITH CHECK (status = 'PROVISIONING')" \
 "ALTER POLICY platform_insert ON tenants WITH CHECK (app_context_kind() = 'platform' AND status = 'PROVISIONING')"

run_sql "P9 policy platform_update tanpa syarat context platform" \
 "ALTER POLICY platform_update ON tenants USING (true) WITH CHECK (true)" \
 "ALTER POLICY platform_update ON tenants USING (app_context_kind() = 'platform') WITH CHECK (app_context_kind() = 'platform')"

run_sql "P10 katalog template terbaca dari context tenant" \
 "ALTER POLICY platform_read ON role_templates USING (true)" \
 "ALTER POLICY platform_read ON role_templates USING (app_context_kind() = 'platform')"

echo -n "baseline setelah pemulihan: "
out=$(cd "$AKAR/api" && node --test --test-concurrency=1 dist/test/slice16.test.js 2>&1)
echo "$out" | grep -q "^# fail 0" && echo HIJAU || echo "MERAH <-- PERIKSA"
