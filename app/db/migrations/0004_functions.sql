-- 0004_functions.sql
-- Dijalankan sebagai app_owner (yang merupakan member app_auth_definer agar dapat
-- memindahkan kepemilikan fungsi; lihat catatan di 0001).
--
-- Fungsi pre-context: dipanggil SEBELUM tenant diketahui, jadi tidak boleh bergantung
-- pada GUC app.current_tenant_id. Keamanannya berasal dari:
--   1. SECURITY DEFINER milik app_auth_definer (bukan pemilik tabel, NOBYPASSRLS);
--   2. policy TO app_auth_definer di 0003;
--   3. grant kolom - kolom di luar grant tidak terbaca walau di dalam fungsi;
--   4. SET search_path tetap.
--
-- Subset register Lampiran A yang dipakai slice 1: F-02, F-04, F-07, F-08.

\set ON_ERROR_STOP on

-- F-02 -------------------------------------------------------------------------
-- Cari identitas untuk login. Mengembalikan hash agar verifikasi password terjadi
-- di aplikasi (constant-work path tetap tanggung jawab aplikasi).
CREATE OR REPLACE FUNCTION auth.find_identity_for_login(p_email TEXT)
RETURNS TABLE (user_id UUID, password_hash TEXT, user_status VARCHAR)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, c.password_hash, u.status
  FROM users u
  JOIN credentials c ON c.user_id = u.id
  WHERE u.email = lower(btrim(p_email));
$$;

-- F-04 -------------------------------------------------------------------------
-- Daftar context login milik satu identitas. Hanya membership aktif pada tenant aktif.
CREATE OR REPLACE FUNCTION auth.list_login_contexts(p_user_id UUID)
RETURNS TABLE (
  tenant_id     UUID,
  tenant_slug   VARCHAR,
  tenant_name   VARCHAR,
  membership_id UUID,
  display_name  VARCHAR
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.id, t.slug, t.name, m.id, p.display_name
  FROM tenant_memberships m
  JOIN tenants t ON t.id = m.tenant_id
  LEFT JOIN tenant_member_profiles p
         ON p.tenant_id = m.tenant_id AND p.membership_id = m.id
  WHERE m.user_id = p_user_id
    AND m.status  = 'ACTIVE'
    AND t.status  = 'ACTIVE'
  ORDER BY t.name;
$$;

-- F-07 -------------------------------------------------------------------------
-- Buat session. Context TENANT wajib membawa membership yang benar-benar milik
-- tenant tersebut; composite FK di 0002 yang menegakkannya, bukan kode ini.
CREATE OR REPLACE FUNCTION auth.create_session(
  p_context_kind  VARCHAR,
  p_user_id       UUID,
  p_tenant_id     UUID,
  p_membership_id UUID,
  p_ttl_minutes   INTEGER DEFAULT 60
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  INSERT INTO sessions (context_kind, tenant_id, user_id, membership_id, expires_at)
  VALUES (p_context_kind, p_tenant_id, p_user_id, p_membership_id,
          now() + make_interval(mins => p_ttl_minutes))
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

-- F-08 -------------------------------------------------------------------------
-- Resolusi session untuk middleware: dipanggil sebelum GUC tenant ditetapkan,
-- justru untuk menentukan nilai GUC itu.
CREATE OR REPLACE FUNCTION auth.find_session(p_session_id UUID)
RETURNS TABLE (
  session_id    UUID,
  context_kind  VARCHAR,
  tenant_id     UUID,
  user_id       UUID,
  membership_id UUID,
  expires_at    TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.context_kind, s.tenant_id, s.user_id, s.membership_id, s.expires_at
  FROM sessions s
  WHERE s.id = p_session_id
    AND s.status = 'ACTIVE'
    AND s.revoked_at IS NULL
    AND s.expires_at > now();
$$;

-- kepemilikan + hak eksekusi -----------------------------------------------------

ALTER FUNCTION auth.find_identity_for_login(TEXT)               OWNER TO app_auth_definer;
ALTER FUNCTION auth.list_login_contexts(UUID)                   OWNER TO app_auth_definer;
ALTER FUNCTION auth.create_session(VARCHAR, UUID, UUID, UUID, INTEGER) OWNER TO app_auth_definer;
ALTER FUNCTION auth.find_session(UUID)                          OWNER TO app_auth_definer;

REVOKE ALL ON FUNCTION auth.find_identity_for_login(TEXT)               FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.list_login_contexts(UUID)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.create_session(VARCHAR, UUID, UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.find_session(UUID)                          FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth.find_identity_for_login(TEXT)               TO app_user;
GRANT EXECUTE ON FUNCTION auth.list_login_contexts(UUID)                   TO app_user;
GRANT EXECUTE ON FUNCTION auth.create_session(VARCHAR, UUID, UUID, UUID, INTEGER) TO app_user;
GRANT EXECUTE ON FUNCTION auth.find_session(UUID)                          TO app_user;
