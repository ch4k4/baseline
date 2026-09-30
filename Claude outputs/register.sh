#!/usr/bin/env bash
set -uo pipefail
AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${DEMO_DB_NAME:-saas_demo}"
HOST="${DEMO_DB_HOST:-127.0.0.1}"
SUPER="${DEMO_DB_SUPER:-postgres}"
sup() { PGPASSWORD="${DEMO_DB_SUPER_PASSWORD:?DEMO_DB_SUPER_PASSWORD belum diset}" psql -h "$HOST" -U "$SUPER" -d "$DB" -q -v ON_ERROR_STOP=1 -c "$1"; }
run() {
  local nama="$1" pasang="$2" pulih="$3"
  sup "$pasang" >/dev/null 2>&1 || { echo "$nama: PASANG GAGAL"; return; }
  out=$(cd "$AKAR/api" && node --test --test-concurrency=1 dist/test/register.test.js 2>&1)
  if echo "$out" | grep -q "^# fail 0"; then echo "$nama: LOLOS (tes tetap hijau!)"
  else echo "$nama: tertangkap -> $(echo "$out" | grep -oE 'not ok [0-9]+ - [0-9]+\..{0,58}' | head -1)"; fi
  sup "$pulih" >/dev/null 2>&1 || echo "$nama: PULIH GAGAL <-- PERIKSA"
}
DEF="CREATE FUNCTION auth.selundupan(p uuid) RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS \$\$ SELECT 1 \$\$; ALTER FUNCTION auth.selundupan(uuid) OWNER TO app_auth_definer"

run "N1 fungsi definer baru tanpa nomor register" "$DEF" "DROP FUNCTION auth.selundupan(uuid)"
run "N2 fungsi definer baru DENGAN nomor, tidak ada di register.json" \
 "$DEF; COMMENT ON FUNCTION auth.selundupan(uuid) IS 'F-26 selundupan'" "DROP FUNCTION auth.selundupan(uuid)"
run "N11 nomor register di database diubah" \
 "COMMENT ON FUNCTION auth.find_session(uuid) IS 'F-99 salah nomor'" \
 "COMMENT ON FUNCTION auth.find_session(uuid) IS 'F-21 pre-context: baris session untuk verifikasi setiap request'"
run "N12 entri belum-ada ternyata dibuat (F-01)" \
 "CREATE FUNCTION auth.resolve_tenant_by_host(h text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS \$\$ SELECT NULL::uuid \$\$; ALTER FUNCTION auth.resolve_tenant_by_host(text) OWNER TO app_auth_definer; COMMENT ON FUNCTION auth.resolve_tenant_by_host(text) IS 'F-01 palsu'" \
 "DROP FUNCTION auth.resolve_tenant_by_host(text)"
run "N6 fungsi definer dimiliki app_owner" \
 "ALTER FUNCTION auth.find_session(uuid) OWNER TO app_owner" \
 "ALTER FUNCTION auth.find_session(uuid) OWNER TO app_auth_definer"
run "N7 search_path dilepas dari fungsi definer" \
 "ALTER FUNCTION auth.find_membership(uuid, uuid) RESET search_path" \
 "ALTER FUNCTION auth.find_membership(uuid, uuid) SET search_path = pg_catalog, public"
run "N3 policy TO definer baru tanpa entri register" \
 "CREATE POLICY definer_selundupan ON roles FOR UPDATE TO app_auth_definer USING (true)" \
 "DROP POLICY definer_selundupan ON roles"
run "N4 satu kolom tambahan di-grant ke definer" \
 "GRANT SELECT (detail) ON audit_logs TO app_auth_definer" \
 "REVOKE SELECT (detail) ON audit_logs FROM app_auth_definer"
run "N5 grant tingkat TABEL dipasang kembali" \
 "GRANT SELECT ON tenants TO app_auth_definer" \
 "REVOKE SELECT ON tenants FROM app_auth_definer; GRANT SELECT (id, name, slug, status) ON tenants TO app_auth_definer"
run "N8 tabel ber-tenant_id tanpa RLS" \
 "CREATE TABLE lupa_rls (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)" \
 "DROP TABLE lupa_rls"
run "N9 tabel ber-RLS tanpa FORCE" \
 "CREATE TABLE lupa_force (id uuid PRIMARY KEY, tenant_id uuid NOT NULL); ALTER TABLE lupa_force ENABLE ROW LEVEL SECURITY" \
 "DROP TABLE lupa_force"
run "N10 app_user diberi BYPASSRLS" \
 "ALTER ROLE app_user BYPASSRLS" \
 "ALTER ROLE app_user NOBYPASSRLS"
run "N13 app_user dijadikan anggota app_auth_definer" \
 "GRANT app_auth_definer TO app_user" \
 "REVOKE app_auth_definer FROM app_user"
echo "--- baseline setelah pemulihan:"
(cd "$AKAR/api" && node --test --test-concurrency=1 dist/test/register.test.js 2>&1 | grep -E "# (pass|fail)")
