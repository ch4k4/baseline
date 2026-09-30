-- 0013_rbac.sql
-- Dijalankan sebagai app_owner.
--
-- Slice 10 (Sprint Plan DEMO-0301 s.d. 0304): katalog permission, role,
-- assignment, dan resolver permission efektif. Sekaligus melunasi D-21:
-- penanda sementara tenant_memberships.is_owner dihapus; hak mengundang kini
-- permission members.invite.
--
-- Pembagian tugas dengan aplikasi (ADR-001 sec.3.10, Demo Foundation sec.3):
--   - database menjaga BATAS TENANT dan BENTUK data: role/assignment tenant lain
--     ditolak composite FK dan RLS; permission platform tidak dapat dipasang ke
--     role tenant; satu assignment aktif per membership+role; role sistem tidak
--     dapat diubah tenant.
--   - aplikasi (guard) menjaga SIAPA di dalam tenant boleh berbuat apa. Database
--     tidak tahu membership mana yang sedang bertindak, jadi tidak dapat menolak
--     anggota tenant yang menulis assignment untuk dirinya sendiri. Itu tugas
--     guard + tes eskalasi DEMO-0308 (slice 11), dan dicatat di DEFERRED D-24.
--
-- Aturan penulisan: ASCII murni (psql Windows membaca sesuai code page konsol).

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- permissions
-- Katalog global (Demo Foundation sec.5). Kode permanen setelah dipakai; tidak
-- ada hak tulis untuk role runtime. Permission menu administrasi (P2) sengaja
-- belum diisi: Demo Foundation sec.5 hanya mengizinkannya bila fiturnya ada.

CREATE TABLE permissions (
  code        VARCHAR(64)  PRIMARY KEY,
  scope       VARCHAR(10)  NOT NULL,
  description VARCHAR(200) NOT NULL,
  retired_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT permissions_scope_ck CHECK (scope IN ('TENANT', 'PLATFORM')),
  -- Bentuk <resource>.<action>; platform wajib berawalan "platform.", tenant tidak boleh.
  CONSTRAINT permissions_code_ck CHECK (code ~ '^[a-z_]+(\.[a-z_]+)+$'),
  CONSTRAINT permissions_prefix_ck CHECK ((scope = 'PLATFORM') = (code LIKE 'platform.%')),
  -- Target composite FK dari role_permissions: hanya pasangan (code, 'TENANT')
  -- yang dapat dirujuk role tenant.
  CONSTRAINT permissions_code_scope_key UNIQUE (code, scope)
);

INSERT INTO permissions (code, scope, description) VALUES
  ('profile.read',            'TENANT',   'Membaca profil milik sendiri'),
  ('profile.update',          'TENANT',   'Mengubah profil milik sendiri'),
  ('members.read',            'TENANT',   'Melihat daftar anggota tenant'),
  ('members.invite',          'TENANT',   'Mengundang, melihat, dan mencabut undangan'),
  ('members.update_profile',  'TENANT',   'Mengubah profil anggota tenant'),
  ('members.suspend',         'TENANT',   'Menangguhkan anggota tenant'),
  ('members.assign_role',     'TENANT',   'Memberi dan mencabut role anggota'),
  ('roles.read',              'TENANT',   'Melihat role tenant'),
  ('roles.create',            'TENANT',   'Membuat role tenant'),
  ('roles.update',            'TENANT',   'Mengubah role tenant'),
  ('roles.archive',           'TENANT',   'Mengarsipkan role tenant'),
  ('roles.assign_permission', 'TENANT',   'Mengatur permission sebuah role'),
  ('permissions.read',        'TENANT',   'Melihat katalog permission tenant'),
  ('menus.read',              'TENANT',   'Melihat menu yang diizinkan'),
  ('audit.read',              'TENANT',   'Membaca audit tenant'),
  ('platform.tenants.read',          'PLATFORM', 'Melihat registry tenant'),
  ('platform.tenants.create',        'PLATFORM', 'Membuat tenant'),
  ('platform.tenants.update_status', 'PLATFORM', 'Mengubah status tenant'),
  ('platform.tenant_domains.manage', 'PLATFORM', 'Mengelola domain tenant'),
  ('platform.entitlements.manage',   'PLATFORM', 'Mengelola entitlement tenant'),
  ('platform.identities.read_status','PLATFORM', 'Melihat status identitas global'),
  ('platform.identities.suspend',    'PLATFORM', 'Menangguhkan identitas global'),
  ('platform.identities.unlock',     'PLATFORM', 'Membuka kunci identitas global'),
  ('platform.admins.read',           'PLATFORM', 'Melihat admin platform'),
  ('platform.admins.manage',         'PLATFORM', 'Mengelola admin platform'),
  ('platform.menus.manage',          'PLATFORM', 'Mengelola menu global'),
  ('platform.reference_data.manage', 'PLATFORM', 'Mengelola reference data global'),
  ('platform.audit.read',            'PLATFORM', 'Membaca audit platform'),
  ('platform.permissions.read',      'PLATFORM', 'Melihat katalog permission lengkap'),
  ('platform.support.start_read',    'PLATFORM', 'Membuka support session READ_ONLY'),
  ('platform.support.start_write',   'PLATFORM', 'Membuka support session READ_WRITE');

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions FORCE  ROW LEVEL SECURITY;
GRANT SELECT ON permissions TO app_user;
-- Katalog bukan data tenant: seluruh baris terbaca, tetapi hanya dibaca.
CREATE POLICY catalog_read ON permissions FOR SELECT TO app_user USING (true);

-- ---------------------------------------------------------------- roles
CREATE TABLE roles (
  id          UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID         NOT NULL REFERENCES tenants (id),
  code        VARCHAR(64)  NOT NULL,
  name        VARCHAR(100) NOT NULL,
  is_system   BOOLEAN      NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  version     INTEGER      NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT roles_tenant_id_key   UNIQUE (tenant_id, id),
  CONSTRAINT roles_tenant_code_key UNIQUE (tenant_id, code),
  CONSTRAINT roles_code_ck    CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT roles_version_ck CHECK (version >= 1),
  -- Role sistem tidak pernah diarsipkan: tenant tanpa tenant_owner kehilangan
  -- jalan kembali ke administrasi.
  CONSTRAINT roles_system_not_archived_ck CHECK (NOT (is_system AND archived_at IS NOT NULL))
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE  ROW LEVEL SECURITY;
-- is_system TIDAK di-grant: role buatan tenant selalu is_system = false.
GRANT SELECT ON roles TO app_user;
GRANT INSERT (id, tenant_id, code, name) ON roles TO app_user;
GRANT UPDATE (name, archived_at, version, updated_at) ON roles TO app_user;

CREATE POLICY tenant_read ON roles FOR SELECT TO app_user
  USING (tenant_id = app_current_tenant());
CREATE POLICY tenant_insert ON roles FOR INSERT TO app_user
  WITH CHECK (tenant_id = app_current_tenant() AND is_system = false);
-- Role sistem tidak dapat diubah tenant sama sekali (nama, arsip, versi).
CREATE POLICY tenant_update ON roles FOR UPDATE TO app_user
  USING      (tenant_id = app_current_tenant() AND is_system = false)
  WITH CHECK (tenant_id = app_current_tenant() AND is_system = false);

-- ---------------------------------------------------------------- role_permissions
CREATE TABLE role_permissions (
  tenant_id        UUID        NOT NULL,
  role_id          UUID        NOT NULL,
  permission_code  VARCHAR(64) NOT NULL,
  -- Selalu 'TENANT': bersama FK di bawah, permission platform tidak dapat
  -- dirujuk dari role tenant - ditolak database, bukan hanya validasi aplikasi.
  permission_scope VARCHAR(10) NOT NULL DEFAULT 'TENANT',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT role_permissions_pkey PRIMARY KEY (tenant_id, role_id, permission_code),
  CONSTRAINT role_permissions_scope_ck CHECK (permission_scope = 'TENANT'),
  CONSTRAINT role_permissions_role_fk FOREIGN KEY (tenant_id, role_id)
    REFERENCES roles (tenant_id, id),
  CONSTRAINT role_permissions_permission_fk FOREIGN KEY (permission_code, permission_scope)
    REFERENCES permissions (code, scope)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE  ROW LEVEL SECURITY;
GRANT SELECT ON role_permissions TO app_user;
GRANT INSERT (tenant_id, role_id, permission_code) ON role_permissions TO app_user;
GRANT DELETE ON role_permissions TO app_user;

CREATE POLICY tenant_read ON role_permissions FOR SELECT TO app_user
  USING (tenant_id = app_current_tenant());
-- Isi role sistem hanya dari provisioning (seed), tidak dari tenant.
CREATE POLICY tenant_insert ON role_permissions FOR INSERT TO app_user
  WITH CHECK (tenant_id = app_current_tenant()
              AND NOT EXISTS (SELECT 1 FROM roles r
                              WHERE r.tenant_id = role_permissions.tenant_id
                                AND r.id = role_permissions.role_id
                                AND r.is_system));
CREATE POLICY tenant_delete ON role_permissions FOR DELETE TO app_user
  USING (tenant_id = app_current_tenant()
         AND NOT EXISTS (SELECT 1 FROM roles r
                         WHERE r.tenant_id = role_permissions.tenant_id
                           AND r.id = role_permissions.role_id
                           AND r.is_system));

-- ---------------------------------------------------------------- user_role_assignments
CREATE TABLE user_role_assignments (
  id                        UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                 UUID        NOT NULL,
  membership_id             UUID        NOT NULL,
  role_id                   UUID        NOT NULL,
  assigned_by_membership_id UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                  TIMESTAMPTZ,
  CONSTRAINT user_role_assignments_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT user_role_assignments_membership_fk FOREIGN KEY (tenant_id, membership_id)
    REFERENCES tenant_memberships (tenant_id, id),
  CONSTRAINT user_role_assignments_role_fk FOREIGN KEY (tenant_id, role_id)
    REFERENCES roles (tenant_id, id),
  CONSTRAINT user_role_assignments_assigner_fk FOREIGN KEY (tenant_id, assigned_by_membership_id)
    REFERENCES tenant_memberships (tenant_id, id),
  CONSTRAINT user_role_assignments_period_ck CHECK (ended_at IS NULL OR ended_at >= created_at)
);

-- Satu assignment AKTIF per membership + role. Partial index, bukan UNIQUE
-- biasa: baris historis (ended_at terisi) boleh berulang (Sprint Plan DEMO-0302).
CREATE UNIQUE INDEX user_role_assignments_active_uq
  ON user_role_assignments (tenant_id, membership_id, role_id) WHERE ended_at IS NULL;

ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_assignments FORCE  ROW LEVEL SECURITY;
GRANT SELECT ON user_role_assignments TO app_user;
GRANT INSERT (id, tenant_id, membership_id, role_id, assigned_by_membership_id)
  ON user_role_assignments TO app_user;
GRANT UPDATE (ended_at) ON user_role_assignments TO app_user;

CREATE POLICY tenant_read ON user_role_assignments FOR SELECT TO app_user
  USING (tenant_id = app_current_tenant());
CREATE POLICY tenant_insert ON user_role_assignments FOR INSERT TO app_user
  WITH CHECK (tenant_id = app_current_tenant() AND ended_at IS NULL);
-- Hanya mengakhiri assignment aktif; assignment yang berakhir tidak dihidupkan.
CREATE POLICY tenant_update ON user_role_assignments FOR UPDATE TO app_user
  USING      (tenant_id = app_current_tenant() AND ended_at IS NULL)
  WITH CHECK (tenant_id = app_current_tenant() AND ended_at IS NOT NULL);

-- ---------------------------------------------------------------- invitation_roles
-- Tabel disiapkan di sini (DEMO-0302); diisi saat mengundang di DEMO-0309
-- (slice 11). Sampai itu, undangan menghasilkan membership tanpa role
-- (default-deny, AC DEMO-0210).
CREATE TABLE invitation_roles (
  tenant_id     UUID        NOT NULL,
  invitation_id UUID        NOT NULL,
  role_id       UUID        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invitation_roles_pkey PRIMARY KEY (tenant_id, invitation_id, role_id),
  CONSTRAINT invitation_roles_invitation_fk FOREIGN KEY (tenant_id, invitation_id)
    REFERENCES user_invitations (tenant_id, id),
  CONSTRAINT invitation_roles_role_fk FOREIGN KEY (tenant_id, role_id)
    REFERENCES roles (tenant_id, id)
);

ALTER TABLE invitation_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_roles FORCE  ROW LEVEL SECURITY;
GRANT SELECT ON invitation_roles TO app_user;
CREATE POLICY tenant_read ON invitation_roles FOR SELECT TO app_user
  USING (tenant_id = app_current_tenant());

-- ---------------------------------------------------------------- resolver
-- Permission efektif (DEMO-0303): membership aktif x assignment aktif x role
-- aktif x permission tenant yang belum pensiun. DISTINCT = deduplikasi. Tidak
-- ada nama role di sini maupun di guard: keputusan hanya atas kode permission.
--
-- security_invoker WAJIB. Tanpa itu view berjalan dengan hak pemiliknya
-- (app_owner), yang tidak tercakup policy app_user - dan FORCE RLS membuat
-- hasilnya selalu kosong, atau, bila suatu hari pemiliknya diberi BYPASSRLS,
-- membuka seluruh tenant. Dengan security_invoker, RLS pemanggil berlaku.
CREATE VIEW effective_permissions WITH (security_invoker = true) AS
SELECT DISTINCT a.tenant_id, a.membership_id, rp.permission_code
FROM user_role_assignments a
JOIN tenant_memberships m ON m.tenant_id = a.tenant_id AND m.id = a.membership_id
JOIN roles r              ON r.tenant_id = a.tenant_id AND r.id = a.role_id
JOIN role_permissions rp  ON rp.tenant_id = a.tenant_id AND rp.role_id = a.role_id
JOIN permissions p        ON p.code = rp.permission_code AND p.scope = 'TENANT'
WHERE a.ended_at IS NULL
  AND m.status = 'ACTIVE'
  AND r.archived_at IS NULL
  AND p.retired_at IS NULL;

GRANT SELECT ON effective_permissions TO app_user;

-- ---------------------------------------------------------------- D-21 lunas
-- Penanda owner sementara diganti permission. Policy definer yang merujuk
-- kolom itu harus diganti lebih dulu (DROP COLUMN menolak kolom yang dipakai policy).
DROP POLICY definer_insert ON tenant_memberships;
ALTER TABLE tenant_memberships DROP COLUMN is_owner;
CREATE POLICY definer_insert ON tenant_memberships FOR INSERT TO app_auth_definer
  WITH CHECK (status = 'ACTIVE');
