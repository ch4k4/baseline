-- 0012_invitations.sql
-- Dijalankan sebagai app_owner (member app_auth_definer; lihat 0001).
--
-- D-09: undangan anggota dan penerimaannya (ADR-002 sec.2.2, DEMO-0210, DEMO-0212).
-- Register Lampiran A: F-11, F-12, dan F-16 (baru; amandemen 2026-09-22).
--
-- Sifat yang ditegakkan DI SINI, bukan di kode aplikasi:
--   - tenant tidak pernah dapat membaca hash token maupun petunjuk identitas;
--   - tenant tidak dapat menandai undangan ACCEPTED - hanya F-12 yang bisa;
--   - undangan PENDING unik per (tenant, email);
--   - penerimaan hanya untuk identitas yang email-nya SAMA dengan undangan
--     (users.email_blind_index = identity_hint), diperiksa di dalam F-12;
--   - penerimaan atomik: membership + profil + status undangan, satu transaksi.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- owner sementara
-- Penanda SEMENTARA sampai RBAC (D-10): siapa yang boleh mengundang. Diganti
-- permission members.invite; kolom ini lalu dihapus. Keputusan pemilik proyek
-- 2026-09-22, dicatat di app/DEFERRED.md D-21.
ALTER TABLE tenant_memberships ADD COLUMN is_owner BOOLEAN NOT NULL DEFAULT false;

-- app_user semula punya INSERT/UPDATE seluruh tabel (0003). Dengan kolom ini,
-- itu berarti kode tenant mana pun dapat menjadikan dirinya owner. Hak tulis
-- dipersempit ke kolom yang memang dipakai; is_owner hanya ditulis seed
-- (superuser) sampai RBAC menggantikannya.
REVOKE INSERT, UPDATE ON tenant_memberships FROM app_user;
GRANT INSERT (id, tenant_id, user_id, status, created_at) ON tenant_memberships TO app_user;
GRANT UPDATE (status) ON tenant_memberships TO app_user;

-- ---------------------------------------------------------------- tabel undangan

CREATE TABLE user_invitations (
  id                       UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants (id),
  -- Email tujuan, dienkripsi DEK tenant (purpose identity). AAD memuat id baris.
  email_ciphertext         BYTEA NOT NULL,
  email_key_version        INTEGER NOT NULL,
  -- HMAC tenant-scoped (identity_blind_index): deduplikasi undangan per tenant.
  email_blind_index        BYTEA NOT NULL,
  -- HMAC GLOBAL email tujuan (platform_identity_blind_index). Jangkar yang
  -- dipakai F-12/F-16 untuk memastikan identitas yang menerima memang pemilik
  -- email undangan. Tenant tidak diberi hak baca kolom ini: nilainya sama untuk
  -- email yang sama di semua tenant, jadi membacanya = korelasi lintas tenant.
  identity_hint            BYTEA NOT NULL,
  invited_by_membership_id UUID NOT NULL,
  token_hash               BYTEA NOT NULL UNIQUE,
  status                   VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  expires_at               TIMESTAMPTZ NOT NULL,
  accepted_membership_id   UUID NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_invitations_pkey PRIMARY KEY (id),
  CONSTRAINT user_invitations_tenant_id_key UNIQUE (tenant_id, id),
  -- Composite FK: pengundang dan membership hasil penerimaan harus dari tenant
  -- yang SAMA dengan undangannya. Validasi aplikasi saja tidak cukup.
  CONSTRAINT user_invitations_inviter_fk FOREIGN KEY (tenant_id, invited_by_membership_id)
    REFERENCES tenant_memberships (tenant_id, id),
  CONSTRAINT user_invitations_accepted_fk FOREIGN KEY (tenant_id, accepted_membership_id)
    REFERENCES tenant_memberships (tenant_id, id),

  CONSTRAINT user_invitations_status_ck
    CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
  CONSTRAINT user_invitations_accepted_ck
    CHECK ((status = 'ACCEPTED') = (accepted_membership_id IS NOT NULL)),
  -- TTL dihitung dari pembaruan terakhir, karena undang-ulang memperpanjangnya.
  CONSTRAINT user_invitations_ttl_ck
    CHECK (expires_at > updated_at AND expires_at <= updated_at + INTERVAL '7 days'),
  CONSTRAINT user_invitations_email_ck
    CHECK (octet_length(email_ciphertext) >= 29 AND get_byte(email_ciphertext, 0) = 1),
  CONSTRAINT user_invitations_key_version_ck CHECK (email_key_version >= 1),
  CONSTRAINT user_invitations_bi_ck
    CHECK (octet_length(email_blind_index) = 32 AND octet_length(identity_hint) = 32),
  CONSTRAINT user_invitations_token_ck CHECK (octet_length(token_hash) = 32)
);

-- Satu undangan PENDING per email per tenant. Undang ulang = memperbarui baris
-- ini (token baru, masa berlaku baru), bukan membuat baris kedua.
CREATE UNIQUE INDEX user_invitations_pending_uq
  ON user_invitations (tenant_id, email_blind_index) WHERE status = 'PENDING';

CREATE INDEX user_invitations_tenant_time_idx ON user_invitations (tenant_id, created_at DESC);

ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invitations FORCE  ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- app_user
-- Grant PER KOLOM. token_hash dan identity_hint dapat DITULIS tenant (saat
-- mengundang) tetapi tidak pernah DIBACA.
GRANT SELECT (id, tenant_id, email_ciphertext, email_key_version, email_blind_index,
              invited_by_membership_id, status, expires_at, accepted_membership_id,
              created_at, updated_at)
  ON user_invitations TO app_user;
GRANT INSERT (id, tenant_id, email_ciphertext, email_key_version, email_blind_index,
              identity_hint, invited_by_membership_id, token_hash, expires_at)
  ON user_invitations TO app_user;
GRANT UPDATE (status, token_hash, expires_at, invited_by_membership_id, updated_at)
  ON user_invitations TO app_user;

CREATE POLICY tenant_read ON user_invitations FOR SELECT TO app_user
  USING (tenant_id = app_current_tenant());

CREATE POLICY tenant_insert ON user_invitations FOR INSERT TO app_user
  WITH CHECK (tenant_id = app_current_tenant()
              AND status = 'PENDING' AND accepted_membership_id IS NULL);

-- Tenant hanya dapat mengubah undangan PENDING, dan hanya menjadi PENDING
-- (undang ulang) atau REVOKED. ACCEPTED hanya lewat F-12.
CREATE POLICY tenant_update ON user_invitations FOR UPDATE TO app_user
  USING      (tenant_id = app_current_tenant() AND status = 'PENDING')
  WITH CHECK (tenant_id = app_current_tenant() AND status IN ('PENDING', 'REVOKED')
              AND accepted_membership_id IS NULL);

-- ---------------------------------------------------------------- app_auth_definer
-- Hak baris untuk F-11/F-12/F-16, per tabel dan per operasi (Lampiran A sec.4).

GRANT SELECT (id, tenant_id, identity_hint, token_hash, status, expires_at)
  ON user_invitations TO app_auth_definer;
GRANT UPDATE (status, accepted_membership_id, updated_at)
  ON user_invitations TO app_auth_definer;
CREATE POLICY definer_read ON user_invitations FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_update ON user_invitations FOR UPDATE TO app_auth_definer
  USING (status = 'PENDING') WITH CHECK (status = 'ACCEPTED');

-- Membership baru dari undangan: selalu ACTIVE, tidak pernah owner.
GRANT INSERT (tenant_id, user_id, status) ON tenant_memberships TO app_auth_definer;
CREATE POLICY definer_insert ON tenant_memberships FOR INSERT TO app_auth_definer
  WITH CHECK (status = 'ACTIVE' AND is_owner = false);

-- Profil: INSERT saja, tanpa SELECT - sama seperti sejak D-01, jalur definer
-- tidak membaca profil.
GRANT INSERT (id, tenant_id, membership_id,
              display_name_ciphertext, display_name_key_version,
              contact_email_ciphertext, contact_email_key_version, contact_email_blind_index)
  ON tenant_member_profiles TO app_auth_definer;
CREATE POLICY definer_insert ON tenant_member_profiles FOR INSERT TO app_auth_definer
  WITH CHECK (true);

-- Identitas baru (F-16): selalu ACTIVE. Kolom status tidak di-grant, jadi
-- nilainya selalu default.
GRANT INSERT (id, email_ciphertext, email_key_version, email_blind_index)
  ON users TO app_auth_definer;
CREATE POLICY definer_insert ON users FOR INSERT TO app_auth_definer
  WITH CHECK (status = 'ACTIVE');

GRANT INSERT (user_id, password_hash) ON credentials TO app_auth_definer;
CREATE POLICY definer_insert ON credentials FOR INSERT TO app_auth_definer
  WITH CHECK (true);

-- ---------------------------------------------------------------- F-11
-- Undangan yang masih dapat diterima, dicari lewat hash token. Tidak
-- mengembalikan email maupun ciphertext-nya: pemegang token sudah tahu email
-- miliknya sendiri, dan server memeriksanya lewat blind index (F-12/F-16).
CREATE OR REPLACE FUNCTION auth.find_invitation_for_acceptance(p_token_hash BYTEA)
RETURNS TABLE (
  invitation_id UUID,
  tenant_id     UUID,
  tenant_name   VARCHAR,
  expires_at    TIMESTAMPTZ,
  identity_hint BYTEA
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.id, i.tenant_id, t.name, i.expires_at, i.identity_hint
  FROM user_invitations i
  JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token_hash = p_token_hash
    AND i.status = 'PENDING'
    AND i.expires_at > clock_timestamp()
    AND t.status = 'ACTIVE';
$$;

-- ---------------------------------------------------------------- F-16
-- Membuat identitas baru untuk pemegang undangan yang belum punya akun.
-- Bukti kepemilikan email = kepemilikan token (ADR-002 sec.2.2).
--
-- Dua syarat sebelum menulis apa pun:
--   1. token masih sah;
--   2. email identitas baru = email undangan (blind index global = identity_hint).
-- Tanpa syarat 2, pemegang token dapat mendaftarkan email LAIN atas nama undangan.
CREATE OR REPLACE FUNCTION auth.create_identity_for_invitation(
  p_token_hash        BYTEA,
  p_user_id           UUID,
  p_email_blind_index BYTEA,
  p_email_ciphertext  BYTEA,
  p_email_key_version INTEGER,
  p_password_hash     TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1
  FROM user_invitations i
  JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token_hash = p_token_hash
    AND i.status = 'PENDING'
    AND i.expires_at > clock_timestamp()
    AND t.status = 'ACTIVE'
    AND i.identity_hint = p_email_blind_index;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Identitas dengan email ini sudah ada: pemanggil wajib memakai jalur login,
  -- bukan membuat identitas kedua. UNIQUE di users juga menolaknya; pemeriksaan
  -- ini membuat hasilnya false yang tenang, bukan exception.
  PERFORM 1 FROM users u WHERE u.email_blind_index = p_email_blind_index;
  IF FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO users (id, email_ciphertext, email_key_version, email_blind_index)
  VALUES (p_user_id, p_email_ciphertext, p_email_key_version, p_email_blind_index);

  INSERT INTO credentials (user_id, password_hash)
  VALUES (p_user_id, p_password_hash);

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------- F-12
-- Penerimaan undangan, atomik. Mengembalikan membership_id, atau NULL bila
-- undangan tidak berlaku / identitas bukan pemilik email / membership lama tidak
-- aktif. NULL untuk semua kegagalan: pemanggil tidak mendapat petunjuk mana.
CREATE OR REPLACE FUNCTION auth.accept_invitation(
  p_token_hash                BYTEA,
  p_user_id                   UUID,
  p_profile_id                UUID,
  p_display_name_ciphertext   BYTEA,
  p_display_name_key_version  INTEGER,
  p_contact_email_ciphertext  BYTEA,
  p_contact_email_key_version INTEGER,
  p_contact_email_blind_index BYTEA
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  inv          RECORD;
  v_membership UUID;
  v_status     VARCHAR;
BEGIN
  -- FOR UPDATE: dua penerimaan bersamaan dengan token yang sama, hanya satu
  -- yang melihat baris PENDING.
  SELECT i.id, i.tenant_id, i.identity_hint INTO inv
  FROM user_invitations i
  JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token_hash = p_token_hash
    AND i.status = 'PENDING'
    AND i.expires_at > clock_timestamp()
    AND t.status = 'ACTIVE'
  FOR UPDATE OF i;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Identitas yang menerima HARUS pemilik email undangan. Ini pemeriksaan
  -- ulang di database atas pencocokan yang sudah dilakukan aplikasi.
  PERFORM 1 FROM users u
  WHERE u.id = p_user_id AND u.email_blind_index = inv.identity_hint AND u.status = 'ACTIVE';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT m.id, m.status INTO v_membership, v_status
  FROM tenant_memberships m
  WHERE m.tenant_id = inv.tenant_id AND m.user_id = p_user_id;

  IF v_membership IS NOT NULL THEN
    -- Sudah anggota aktif: undangan ditandai diterima, tidak ada profil kedua.
    -- Membership yang ditangguhkan/berakhir TIDAK dihidupkan lewat undangan.
    IF v_status IS DISTINCT FROM 'ACTIVE' THEN
      RETURN NULL;
    END IF;
  ELSE
    INSERT INTO tenant_memberships (tenant_id, user_id, status)
    VALUES (inv.tenant_id, p_user_id, 'ACTIVE')
    RETURNING id INTO v_membership;

    INSERT INTO tenant_member_profiles (
      id, tenant_id, membership_id,
      display_name_ciphertext, display_name_key_version,
      contact_email_ciphertext, contact_email_key_version, contact_email_blind_index)
    VALUES (
      p_profile_id, inv.tenant_id, v_membership,
      p_display_name_ciphertext, p_display_name_key_version,
      p_contact_email_ciphertext, p_contact_email_key_version, p_contact_email_blind_index);
  END IF;

  UPDATE user_invitations
  SET status = 'ACCEPTED', accepted_membership_id = v_membership, updated_at = clock_timestamp()
  WHERE id = inv.id;

  RETURN v_membership;
END;
$$;

-- ---------------------------------------------------------------- kepemilikan

ALTER FUNCTION auth.find_invitation_for_acceptance(BYTEA) OWNER TO app_auth_definer;
ALTER FUNCTION auth.create_identity_for_invitation(BYTEA, UUID, BYTEA, BYTEA, INTEGER, TEXT)
  OWNER TO app_auth_definer;
ALTER FUNCTION auth.accept_invitation(BYTEA, UUID, UUID, BYTEA, INTEGER, BYTEA, INTEGER, BYTEA)
  OWNER TO app_auth_definer;

REVOKE ALL ON FUNCTION auth.find_invitation_for_acceptance(BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.create_identity_for_invitation(BYTEA, UUID, BYTEA, BYTEA, INTEGER, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.accept_invitation(BYTEA, UUID, UUID, BYTEA, INTEGER, BYTEA, INTEGER, BYTEA)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth.find_invitation_for_acceptance(BYTEA) TO app_user;
GRANT EXECUTE ON FUNCTION auth.create_identity_for_invitation(BYTEA, UUID, BYTEA, BYTEA, INTEGER, TEXT)
  TO app_user;
GRANT EXECUTE ON FUNCTION auth.accept_invitation(BYTEA, UUID, UUID, BYTEA, INTEGER, BYTEA, INTEGER, BYTEA)
  TO app_user;
