#!/usr/bin/env bash
set -uo pipefail
AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${DEMO_DB_NAME:-saas_demo}"
HOST="${DEMO_DB_HOST:-127.0.0.1}"
SUPER="${DEMO_DB_SUPER:-postgres}"
export PGPASSWORD="${DEMO_DB_OWNER_PASSWORD:-devowner}"
own() { psql -h "$HOST" -U app_owner -d "$DB" -q -v ON_ERROR_STOP=1 -c "$1"; }
runsql() { # nama, pasang, pulih, berkas-tes
  local nama="$1" pasang="$2" pulih="$3" berkas="${4:-tests/slice15_test.sql}"
  own "$pasang" >/dev/null 2>&1 || { echo "$nama: PASANG GAGAL"; return; }
  if "$AKAR/mutations/sqltest.sh" "$berkas" >${TMPDIR:-/tmp}/mut.out 2>&1; then echo "$nama: LOLOS"
  else echo "$nama: tertangkap -> $(grep -oE 'KASUS [0-9]+ GAGAL[^"]*' ${TMPDIR:-/tmp}/mut.out | head -1 | cut -c1-90)"; fi
  own "$pulih" >/dev/null 2>&1 || echo "$nama: PULIH GAGAL <-- PERIKSA"
}
runapi() { # nama, pasang, pulih, berkas-tes-js
  local nama="$1" pasang="$2" pulih="$3" berkas="$4"
  own "$pasang" >/dev/null 2>&1 || { echo "$nama: PASANG GAGAL"; return; }
  out=$(cd "$AKAR/api" && node --test --test-concurrency=1 "$berkas" 2>&1)
  if echo "$out" | grep -q "^# fail 0"; then echo "$nama: LOLOS"
  else echo "$nama: tertangkap -> $(echo "$out" | grep -oE 'not ok [0-9]+ - [0-9]+\. [^,]{0,70}' | head -1)"; fi
  own "$pulih" >/dev/null 2>&1 || echo "$nama: PULIH GAGAL <-- PERIKSA"
}
cd "$AKAR/db"

runsql "M1 policy platform tanpa syarat context" \
 "ALTER POLICY platform_read ON menus USING (context_kind = 'PLATFORM' AND tenant_id IS NULL)" \
 "ALTER POLICY platform_read ON menus USING (app_context_kind() = 'platform' AND context_kind = 'PLATFORM' AND tenant_id IS NULL)"

runsql "M2 policy tenant tanpa syarat context_kind menu" \
 "ALTER POLICY tenant_read ON menus USING (app_context_kind() IN ('tenant','support') AND (tenant_id IS NULL OR tenant_id = app_current_tenant()))" \
 "ALTER POLICY tenant_read ON menus USING (app_context_kind() IN ('tenant','support') AND context_kind = 'TENANT' AND (tenant_id IS NULL OR tenant_id = app_current_tenant()))"

runsql "M7 app_user diberi hak menulis menu" \
 "GRANT INSERT, UPDATE, DELETE ON menus TO app_user" \
 "REVOKE INSERT, UPDATE, DELETE ON menus FROM app_user"

cd "$AKAR/db"
runapi "M3 policy tenant tanpa batas tenant" \
 "ALTER POLICY tenant_read ON menus USING (app_context_kind() IN ('tenant','support') AND context_kind = 'TENANT')" \
 "ALTER POLICY tenant_read ON menus USING (app_context_kind() IN ('tenant','support') AND context_kind = 'TENANT' AND (tenant_id IS NULL OR tenant_id = app_current_tenant()))" \
 "dist/test/slice15.test.js"

runapi "M4 CHECK scope permission dihapus" \
 "ALTER TABLE menu_permissions DROP CONSTRAINT menu_permissions_scope_ck" \
 "ALTER TABLE menu_permissions ADD CONSTRAINT menu_permissions_scope_ck CHECK (permission_scope = context_kind)" \
 "dist/test/slice15.test.js"

runapi "M5 CHECK allowlist route dihapus" \
 "ALTER TABLE menus DROP CONSTRAINT menus_path_ck" \
 "ALTER TABLE menus ADD CONSTRAINT menus_path_ck CHECK (path IS NULL OR path ~ '^/[a-z0-9][a-z0-9/_-]*\$')" \
 "dist/test/slice15.test.js"

runapi "M6 trigger memakai NEW.owner_key (penjaga buta)" \
 "CREATE OR REPLACE FUNCTION auth.menus_assert_hierarchy() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS \$fn\$ DECLARE v_id UUID := NEW.parent_id; v_depth INTEGER := 0; BEGIN WHILE v_id IS NOT NULL LOOP v_depth := v_depth + 1; IF v_id = NEW.id THEN RAISE EXCEPTION 'siklus' USING ERRCODE='check_violation'; END IF; IF v_depth > 10 THEN RAISE EXCEPTION 'dalam' USING ERRCODE='check_violation'; END IF; SELECT m.parent_id INTO v_id FROM menus m WHERE m.owner_key = NEW.owner_key AND m.id = v_id; END LOOP; RETURN NEW; END; \$fn\$" \
 "CREATE OR REPLACE FUNCTION auth.menus_assert_hierarchy() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS \$fn\$ DECLARE v_id UUID := NEW.parent_id; v_depth INTEGER := 0; v_owner UUID := coalesce(NEW.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid); BEGIN WHILE v_id IS NOT NULL LOOP v_depth := v_depth + 1; IF v_id = NEW.id THEN RAISE EXCEPTION 'siklus' USING ERRCODE='check_violation'; END IF; IF v_depth > 10 THEN RAISE EXCEPTION 'dalam' USING ERRCODE='check_violation'; END IF; SELECT m.parent_id INTO v_id FROM menus m WHERE m.owner_key = v_owner AND m.id = v_id; END LOOP; RETURN NEW; END; \$fn\$" \
 "dist/test/slice15.test.js"

runapi "M8 composite FK induk dihapus" \
 "ALTER TABLE menus DROP CONSTRAINT menus_parent_fk" \
 "ALTER TABLE menus ADD CONSTRAINT menus_parent_fk FOREIGN KEY (owner_key, parent_id) REFERENCES menus (owner_key, id)" \
 "dist/test/slice15.test.js"
