-- 0003_rls.sql
-- Dijalankan sebagai app_owner.
-- RLS + grant. Dua jalur akses yang berbeda dan tidak saling menggantikan:
--
--   app_user          : hanya baris tenant aktif, ditentukan GUC app.current_tenant_id.
--                       TIDAK punya grant apa pun ke users/credentials.
--   app_auth_definer  : jalur pre-context (sebelum tenant diketahui). Mendapat akses
--                       baris lewat policy TO app_auth_definer + grant kolom, BUKAN
--                       lewat BYPASSRLS. Ini inti Opsi A (ADR-001 sec.3.7).

\set ON_ERROR_STOP on

-- Pembaca GUC. STABLE, bukan IMMUTABLE: nilainya berubah per transaksi.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.current_tenant_id', true), '')::uuid $$;

REVOKE ALL ON FUNCTION app_current_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_tenant() TO app_user, app_auth_definer;

-- ---------------------------------------------------------------- aktifkan RLS

ALTER TABLE tenants               ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants               FORCE  ROW LEVEL SECURITY;
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE credentials           ENABLE ROW LEVEL SECURITY;
ALTER TABLE credentials           FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships    FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenant_member_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_member_profiles FORCE  ROW LEVEL SECURITY;
ALTER TABLE sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions              FORCE  ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens        FORCE  ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- grant app_user
-- Tidak ada satu pun grant ke users / credentials. Itu disengaja.

GRANT SELECT                         ON tenants                TO app_user;
GRANT SELECT, INSERT, UPDATE         ON tenant_memberships     TO app_user;
GRANT SELECT, INSERT, UPDATE         ON tenant_member_profiles TO app_user;
GRANT SELECT, UPDATE                 ON sessions               TO app_user;
GRANT SELECT, UPDATE                 ON refresh_tokens         TO app_user;

-- ---------------------------------------------------------------- policy app_user

CREATE POLICY tenant_scope ON tenants FOR SELECT TO app_user
  USING (id = app_current_tenant());

CREATE POLICY tenant_scope ON tenant_memberships FOR ALL TO app_user
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

CREATE POLICY tenant_scope ON tenant_member_profiles FOR ALL TO app_user
  USING      (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Baris PLATFORM tidak pernah terlihat oleh app_user, apa pun GUC-nya.
CREATE POLICY tenant_scope ON sessions FOR ALL TO app_user
  USING      (context_kind = 'TENANT' AND tenant_id = app_current_tenant())
  WITH CHECK (context_kind = 'TENANT' AND tenant_id = app_current_tenant());

CREATE POLICY tenant_scope ON refresh_tokens FOR ALL TO app_user
  USING      (context_kind = 'TENANT' AND tenant_id = app_current_tenant())
  WITH CHECK (context_kind = 'TENANT' AND tenant_id = app_current_tenant());

-- ---------------------------------------------------------------- grant app_auth_definer
-- Grant kolom, bukan grant tabel: fungsi definer tidak dapat membaca kolom di luar daftar.

GRANT SELECT (id, email, status)              ON users       TO app_auth_definer;
GRANT SELECT (id, user_id, password_hash)     ON credentials TO app_auth_definer;
GRANT SELECT (id, slug, name, status)         ON tenants     TO app_auth_definer;
GRANT SELECT (id, tenant_id, user_id, status) ON tenant_memberships TO app_auth_definer;
GRANT SELECT (id, tenant_id, membership_id, display_name)
                                              ON tenant_member_profiles TO app_auth_definer;
GRANT SELECT, INSERT                          ON sessions       TO app_auth_definer;
GRANT SELECT, INSERT, UPDATE                  ON refresh_tokens TO app_auth_definer;

-- ---------------------------------------------------------------- policy app_auth_definer
-- USING (true) aman HANYA karena role ini NOLOGIN, tidak dapat di-SET ROLE oleh
-- app_user, dan satu-satunya jalan masuknya adalah fungsi SECURITY DEFINER di 0004.

CREATE POLICY definer_read ON users                 FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_read ON credentials           FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_read ON tenants               FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_read ON tenant_memberships    FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_read ON tenant_member_profiles FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_read   ON sessions       FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_insert ON sessions       FOR INSERT TO app_auth_definer WITH CHECK (true);
CREATE POLICY definer_read   ON refresh_tokens FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_insert ON refresh_tokens FOR INSERT TO app_auth_definer WITH CHECK (true);
CREATE POLICY definer_update ON refresh_tokens FOR UPDATE TO app_auth_definer USING (true) WITH CHECK (true);
