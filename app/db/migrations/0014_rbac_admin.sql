-- 0014_rbac_admin.sql
-- Dijalankan sebagai app_owner.
--
-- Slice 11 (Sprint Plan DEMO-0305, 0306, 0309, 0308): administrasi anggota dan
-- role, serta role yang diberikan saat undangan diterima.
--
--   1. tenant_memberships.version  - optimistic locking untuk mutasi anggota.
--   2. invitation_roles ditulis tenant saat mengundang (hanya undangan PENDING).
--   3. F-12 memberi role dari invitation_roles secara atomik bersama membership.
--      Role yang sudah diarsipkan DILEWATI (keputusan pemilik proyek 2026-09-22):
--      membership tetap terbentuk, tanpa role itu (default-deny).
--
-- Perubahan F-12 dan policy definer di sini tercatat di Lampiran A edisi 2.3.
-- Aturan penulisan: ASCII murni.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- 1. versi membership
ALTER TABLE tenant_memberships ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenant_memberships ADD CONSTRAINT tenant_memberships_version_ck CHECK (version >= 1);
GRANT UPDATE (version) ON tenant_memberships TO app_user;

-- ---------------------------------------------------------------- 2. invitation_roles (tenant)
GRANT INSERT (tenant_id, invitation_id, role_id) ON invitation_roles TO app_user;
GRANT DELETE ON invitation_roles TO app_user;

-- Role undangan hanya dapat diubah selama undangannya masih PENDING: undangan
-- yang sudah diterima adalah catatan, bukan formulir.
CREATE POLICY tenant_insert ON invitation_roles FOR INSERT TO app_user
  WITH CHECK (tenant_id = app_current_tenant()
              AND EXISTS (SELECT 1 FROM user_invitations i
                          WHERE i.tenant_id = invitation_roles.tenant_id
                            AND i.id = invitation_roles.invitation_id
                            AND i.status = 'PENDING'));
CREATE POLICY tenant_delete ON invitation_roles FOR DELETE TO app_user
  USING (tenant_id = app_current_tenant()
         AND EXISTS (SELECT 1 FROM user_invitations i
                     WHERE i.tenant_id = invitation_roles.tenant_id
                       AND i.id = invitation_roles.invitation_id
                       AND i.status = 'PENDING'));

-- ---------------------------------------------------------------- 3. hak definer untuk F-12
-- Per tabel, per operasi, per kolom (Lampiran A sec.4).
GRANT SELECT (invited_by_membership_id) ON user_invitations TO app_auth_definer;

GRANT SELECT (tenant_id, invitation_id, role_id) ON invitation_roles TO app_auth_definer;
CREATE POLICY definer_read ON invitation_roles FOR SELECT TO app_auth_definer USING (true);

GRANT SELECT (id, tenant_id, archived_at) ON roles TO app_auth_definer;
CREATE POLICY definer_read ON roles FOR SELECT TO app_auth_definer USING (true);

GRANT SELECT (tenant_id, membership_id, role_id, ended_at) ON user_role_assignments TO app_auth_definer;
GRANT INSERT (tenant_id, membership_id, role_id, assigned_by_membership_id)
  ON user_role_assignments TO app_auth_definer;
CREATE POLICY definer_read ON user_role_assignments FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_insert ON user_role_assignments FOR INSERT TO app_auth_definer
  WITH CHECK (ended_at IS NULL);

-- ---------------------------------------------------------------- F-12 (edisi 2.3)
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
  SELECT i.id, i.tenant_id, i.identity_hint, i.invited_by_membership_id INTO inv
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

  PERFORM 1 FROM users u
  WHERE u.id = p_user_id AND u.email_blind_index = inv.identity_hint AND u.status = 'ACTIVE';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT m.id, m.status INTO v_membership, v_status
  FROM tenant_memberships m
  WHERE m.tenant_id = inv.tenant_id AND m.user_id = p_user_id;

  IF v_membership IS NOT NULL THEN
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

  -- Role dari undangan (DEMO-0309), dalam transaksi yang sama. Hanya role yang
  -- belum diarsipkan; role yang sudah dipegang (anggota lama) tidak diduplikasi.
  -- Composite FK menjamin role berasal dari tenant undangan.
  INSERT INTO user_role_assignments (tenant_id, membership_id, role_id, assigned_by_membership_id)
  SELECT ir.tenant_id, v_membership, ir.role_id, inv.invited_by_membership_id
  FROM invitation_roles ir
  JOIN roles r ON r.tenant_id = ir.tenant_id AND r.id = ir.role_id
  WHERE ir.tenant_id = inv.tenant_id
    AND ir.invitation_id = inv.id
    AND r.archived_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM user_role_assignments a
                    WHERE a.tenant_id = ir.tenant_id
                      AND a.membership_id = v_membership
                      AND a.role_id = ir.role_id
                      AND a.ended_at IS NULL);

  UPDATE user_invitations
  SET status = 'ACCEPTED', accepted_membership_id = v_membership, updated_at = clock_timestamp()
  WHERE id = inv.id;

  RETURN v_membership;
END;
$$;

ALTER FUNCTION auth.accept_invitation(BYTEA, UUID, UUID, BYTEA, INTEGER, BYTEA, INTEGER, BYTEA)
  OWNER TO app_auth_definer;
