-- 0011_field_encryption.sql
-- Dijalankan sebagai app_owner (member app_auth_definer; lihat 0001).
--
-- D-01: enkripsi field + blind index (DEMO-0105A/B; Data Protection SSOT
-- sec.8-10, sec.9.1; ADR-002 sec.2.4).
--
-- YANG BERUBAH
--   users.email                        -> email_ciphertext + email_blind_index
--   tenant_member_profiles.display_name -> display_name_ciphertext
--   tenant_member_profiles.contact_email -> contact_email_ciphertext + blind index tenant
--   crypto_keys (baru)                 -> DEK terbungkus KEK, per scope dan purpose
--
-- YANG TIDAK DILAKUKAN DI SINI, DAN KENAPA
--   Enkripsi. Database tidak pernah melihat plaintext maupun kunci mentah: nilai
--   dienkripsi di aplikasi (crypto adapter) sebelum dikirim. Migrasi ini hanya
--   menyiapkan bentuk kolom dan MENOLAK bentuk yang salah (CHECK di bawah).
--
-- Migrasi ini mengasumsikan tabel users dan tenant_member_profiles KOSONG, dan
-- memang demikian: seed identitas berjalan SETELAH semua migrasi (db.ps1). Pada
-- database yang sudah berisi data, ADD COLUMN ... NOT NULL gagal - dan itu
-- disengaja. Memindahkan plaintext yang sudah ada mengikuti SSOT sec.15 (dual-read,
-- backfill, verifikasi, purge), bukan migrasi diam-diam.
--
-- Komentar "diganti di 0006" pada 0002 sudah basi: penggantinya adalah berkas ini.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- crypto_keys
-- Satu baris = satu DEK terbungkus. Tanpa KEK (yang tidak pernah ada di database),
-- isi tabel ini tidak dapat membuka apa pun.
CREATE TABLE crypto_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NULL REFERENCES tenants (id),
  purpose      VARCHAR(40) NOT NULL,
  key_version  INTEGER NOT NULL,
  wrapped_dek  BYTEA NOT NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT crypto_keys_purpose_ck CHECK (purpose IN (
    'platform_identity', 'platform_identity_blind_index', 'platform_audit_identifier',
    'identity', 'identity_blind_index')),
  -- Kunci platform tidak pernah milik tenant, dan kunci tenant selalu milik
  -- tenant. Kunci platform yang "kebetulan" punya tenant_id adalah jalan bagi
  -- data global untuk ikut ter-crypto-shred saat satu tenant dihapus.
  CONSTRAINT crypto_keys_scope_ck CHECK (
    (purpose LIKE 'platform!_%' ESCAPE '!') = (tenant_id IS NULL)),
  CONSTRAINT crypto_keys_version_ck CHECK (key_version >= 1),
  -- 1 byte versi format + 12 nonce + 32 kunci + 16 tag.
  CONSTRAINT crypto_keys_wrapped_ck CHECK (
    octet_length(wrapped_dek) = 61 AND get_byte(wrapped_dek, 0) = 1),
  CONSTRAINT crypto_keys_status_ck CHECK (status IN ('ACTIVE', 'RETIRED'))
);

CREATE UNIQUE INDEX crypto_keys_version_uq
  ON crypto_keys (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), purpose, key_version);
-- Tepat satu versi aktif per scope+purpose. Dua kunci aktif berarti penulis
-- berbeda memakai kunci berbeda, dan blind index berhenti cocok.
CREATE UNIQUE INDEX crypto_keys_active_uq
  ON crypto_keys (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), purpose)
  WHERE status = 'ACTIVE';

ALTER TABLE crypto_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_keys FORCE  ROW LEVEL SECURITY;

-- app_user: tidak ada grant sama sekali. Jalur satu-satunya adalah fungsi di bawah.
GRANT SELECT (tenant_id, purpose, key_version, wrapped_dek, status)
  ON crypto_keys TO app_auth_definer;
CREATE POLICY definer_read ON crypto_keys FOR SELECT TO app_auth_definer USING (true);

-- ---------------------------------------------------------------- users
-- Email global: kunci platform_identity, blind index GLOBAL (SSOT sec.9.1) karena
-- login harus menemukan identitas sebelum tenant diketahui.
ALTER TABLE users DROP COLUMN email;
ALTER TABLE users
  ADD COLUMN email_ciphertext  BYTEA   NOT NULL,
  ADD COLUMN email_key_version INTEGER NOT NULL,
  ADD COLUMN email_blind_index BYTEA   NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_email_blind_index_key UNIQUE (email_blind_index),
  -- Envelope minimal: versi format 1 + nonce 12 + tag 16. Nilai yang lebih pendek
  -- atau berversi lain bukan ciphertext - kemungkinan besar plaintext yang lolos.
  ADD CONSTRAINT users_email_ciphertext_ck
    CHECK (octet_length(email_ciphertext) >= 29 AND get_byte(email_ciphertext, 0) = 1),
  ADD CONSTRAINT users_email_blind_index_ck CHECK (octet_length(email_blind_index) = 32),
  ADD CONSTRAINT users_email_key_version_ck CHECK (email_key_version >= 1);

-- Jalur definer hanya membutuhkan blind index, BUKAN ciphertext. Login tidak
-- pernah perlu tahu email-nya; cukup tahu identitas mana yang cocok.
GRANT SELECT (email_blind_index) ON users TO app_auth_definer;

-- ---------------------------------------------------------------- profiles
-- Data tenant: DEK milik tenant (dapat di-crypto-shred per tenant), blind index
-- dengan kunci tenant sehingga email yang sama di dua tenant menghasilkan dua
-- nilai berbeda dan tidak dapat dikorelasikan lintas tenant.
ALTER TABLE tenant_member_profiles DROP COLUMN display_name;
ALTER TABLE tenant_member_profiles DROP COLUMN contact_email;
ALTER TABLE tenant_member_profiles
  ADD COLUMN display_name_ciphertext   BYTEA   NOT NULL,
  ADD COLUMN display_name_key_version  INTEGER NOT NULL,
  ADD COLUMN contact_email_ciphertext  BYTEA   NOT NULL,
  ADD COLUMN contact_email_key_version INTEGER NOT NULL,
  ADD COLUMN contact_email_blind_index BYTEA   NOT NULL;

ALTER TABLE tenant_member_profiles
  ADD CONSTRAINT tenant_member_profiles_contact_bi_key
    UNIQUE (tenant_id, contact_email_blind_index),
  ADD CONSTRAINT tenant_member_profiles_display_name_ck
    CHECK (octet_length(display_name_ciphertext) >= 29 AND get_byte(display_name_ciphertext, 0) = 1),
  ADD CONSTRAINT tenant_member_profiles_contact_email_ck
    CHECK (octet_length(contact_email_ciphertext) >= 29 AND get_byte(contact_email_ciphertext, 0) = 1),
  ADD CONSTRAINT tenant_member_profiles_contact_bi_ck
    CHECK (octet_length(contact_email_blind_index) = 32),
  ADD CONSTRAINT tenant_member_profiles_key_versions_ck
    CHECK (display_name_key_version >= 1 AND contact_email_key_version >= 1);

-- Jalur definer tidak lagi membaca profil sama sekali. Satu-satunya pemakainya
-- dulu adalah display_name di list_login_contexts, yang kini dibuang (lihat bawah).
DROP POLICY definer_read ON tenant_member_profiles;
REVOKE ALL ON tenant_member_profiles FROM app_auth_definer;

-- ---------------------------------------------------------------- fungsi
-- F-02: pencarian identitas login lewat blind index. Nilai email tidak pernah
-- sampai ke database - bahkan dalam bentuk parameter.
DROP FUNCTION auth.find_identity_for_login(TEXT);
CREATE FUNCTION auth.find_identity_for_login(p_email_blind_index BYTEA)
RETURNS TABLE (user_id UUID, password_hash TEXT, user_status VARCHAR)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, c.password_hash, u.status
  FROM users u
  JOIN credentials c ON c.user_id = u.id
  WHERE u.email_blind_index = p_email_blind_index;
$$;

-- F-04 tanpa display_name. Nama tampilan kini ciphertext dengan kunci tenant;
-- jalur pre-context tidak punya tenant context untuk membukanya, dan memang
-- tidak membutuhkannya - halaman pilih tenant hanya menampilkan nama tenant.
DROP FUNCTION auth.list_login_contexts(UUID);
CREATE FUNCTION auth.list_login_contexts(p_user_id UUID)
RETURNS TABLE (
  tenant_id     UUID,
  tenant_slug   VARCHAR,
  tenant_name   VARCHAR,
  membership_id UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.id, t.slug, t.name, m.id
  FROM tenant_memberships m
  JOIN tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id
    AND m.status  = 'ACTIVE'
    AND t.status  = 'ACTIVE'
  ORDER BY t.name;
$$;

-- Kunci aktif. Kunci TENANT hanya diserahkan di dalam context tenant yang sama:
-- referensi kunci tenant tidak boleh datang dari input sembarang (SSOT sec.9),
-- dan di sini syarat itu ditegakkan database, bukan hanya diingat kode aplikasi.
CREATE FUNCTION auth.get_active_key(p_purpose VARCHAR, p_tenant_id UUID)
RETURNS TABLE (key_version INTEGER, wrapped_dek BYTEA)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT k.key_version, k.wrapped_dek
  FROM crypto_keys k
  WHERE k.purpose = p_purpose
    AND k.status = 'ACTIVE'
    AND k.tenant_id IS NOT DISTINCT FROM p_tenant_id
    AND (p_tenant_id IS NULL OR p_tenant_id = app_current_tenant());
$$;

-- Versi tertentu, untuk membuka ciphertext yang ditulis sebelum rotasi.
CREATE FUNCTION auth.get_key_version(p_purpose VARCHAR, p_tenant_id UUID, p_version INTEGER)
RETURNS TABLE (key_version INTEGER, wrapped_dek BYTEA)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT k.key_version, k.wrapped_dek
  FROM crypto_keys k
  WHERE k.purpose = p_purpose
    AND k.key_version = p_version
    AND k.tenant_id IS NOT DISTINCT FROM p_tenant_id
    AND (p_tenant_id IS NULL OR p_tenant_id = app_current_tenant());
$$;

ALTER FUNCTION auth.find_identity_for_login(BYTEA)            OWNER TO app_auth_definer;
ALTER FUNCTION auth.list_login_contexts(UUID)                  OWNER TO app_auth_definer;
ALTER FUNCTION auth.get_active_key(VARCHAR, UUID)              OWNER TO app_auth_definer;
ALTER FUNCTION auth.get_key_version(VARCHAR, UUID, INTEGER)    OWNER TO app_auth_definer;

REVOKE ALL ON FUNCTION auth.find_identity_for_login(BYTEA)         FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.list_login_contexts(UUID)               FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.get_active_key(VARCHAR, UUID)           FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.get_key_version(VARCHAR, UUID, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth.find_identity_for_login(BYTEA)         TO app_user;
GRANT EXECUTE ON FUNCTION auth.list_login_contexts(UUID)               TO app_user;
GRANT EXECUTE ON FUNCTION auth.get_active_key(VARCHAR, UUID)           TO app_user;
GRANT EXECUTE ON FUNCTION auth.get_key_version(VARCHAR, UUID, INTEGER) TO app_user;
