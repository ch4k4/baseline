-- 0023_tenant_provisioning.sql
-- Dijalankan sebagai app_owner.
--
-- Provisioning tenant SUNGGUHAN: tenant baru mendapat kunci enkripsi (D-17) dan role
-- sistem (D-25) tanpa seed. Sampai hari ini keduanya hanya dibuat skrip seed, sehingga
-- membuat tenant saat runtime mustahil - syarat paling dasar bagi produk apa pun.
--
-- KEPUTUSAN PEMILIK PROYEK (2026-09-28), dan batas yang dipasang untuknya:
--
-- 1. Owner pertama sebuah tenant dibuat LANGSUNG oleh platform, bukan lewat undangan.
--    Ini pengecualian terhadap ADR-002 sec.2.2 (invitation-only) dan harus dikatakan
--    terus terang: platform memperoleh kewenangan menempelkan identitas ke tenant.
--    Karena itu kewenangan itu DIBATASI DI DATABASE, bukan hanya di kode:
--
--      * hanya tenant berstatus PROVISIONING (tenant yang baru dibuat);
--      * hanya bila tenant itu BELUM punya satu membership pun;
--      * hanya satu membership, dan hanya dengan role `tenant_owner`;
--      * identitasnya harus sudah ada dan ACTIVE - platform TIDAK membuat identitas
--        (itu tetap hanya lewat undangan, F-16);
--      * tercatat di audit TENANT, bukan hanya audit platform, sehingga tenant dapat
--        melihat bahwa anggota pertamanya dibuat oleh platform.
--
--    Tanpa batas-batas itu, fungsi ini menjadi jalur cangkok identitas permanen ke
--    tenant mana pun. Dengan batas-batas itu, ia hanya berlaku sekali per tenant, pada
--    saat tenant belum dipakai siapa pun.
--
-- 2. Kunci tenant dibuat SAAT provisioning lewat fungsi terdaftar (F-26). `app_user`
--    tetap tidak punya hak apa pun atas `crypto_keys`: yang menulis adalah fungsi
--    definer, dan yang dimasukkan hanya DEK TERBUNGKUS - KEK tidak pernah menyentuh
--    database.
--
-- 3. Role sistem berasal dari TEMPLATE di database, bukan daftar di kode. Menambah
--    atau mengubah role bawaan karena itu menjadi migrasi yang terlihat saat review,
--    dan produk lain dapat membawa templatenya sendiri lewat kolom `component`
--    (ADR-001 sec.3.11).
--
-- Aturan penulisan: ASCII murni.

\set ON_ERROR_STOP on

-- ------------------------------------------------------- template role
CREATE TABLE role_templates (
  component   VARCHAR(40) NOT NULL DEFAULT 'baseline',
  code        VARCHAR(64) NOT NULL,
  name        VARCHAR(100) NOT NULL,
  -- Role owner memegang SELURUH permission tenant, termasuk yang ditambahkan
  -- migrasi kelak. Menyalin daftarnya sekarang berarti owner tenant baru kehilangan
  -- permission yang lahir setelah migrasi ini; penanda ini membuat isinya dihitung
  -- saat provisioning, bukan dibekukan di sini.
  includes_all_tenant_permissions BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT role_templates_pkey PRIMARY KEY (component, code),
  CONSTRAINT role_templates_component_ck CHECK (component ~ '^[a-z][a-z0-9_-]*$'),
  -- Pola sama dengan `roles.code` (0013): template yang tidak dapat menjadi role
  -- adalah template yang gagal justru saat dipakai.
  CONSTRAINT role_templates_code_ck CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT role_templates_sort_ck CHECK (sort_order >= 0)
);

CREATE TABLE role_template_permissions (
  component        VARCHAR(40) NOT NULL DEFAULT 'baseline',
  role_code        VARCHAR(64) NOT NULL,
  permission_code  VARCHAR(64) NOT NULL,
  permission_scope VARCHAR(10) NOT NULL DEFAULT 'TENANT',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT role_template_permissions_pkey PRIMARY KEY (component, role_code, permission_code),
  CONSTRAINT role_template_permissions_role_fk FOREIGN KEY (component, role_code)
    REFERENCES role_templates (component, code) ON DELETE CASCADE,
  -- Permission platform tidak dapat masuk template role tenant - ditolak foreign key
  -- (code, scope), pola yang sama dengan role_permissions (0013).
  CONSTRAINT role_template_permissions_permission_fk FOREIGN KEY (permission_code, permission_scope)
    REFERENCES permissions (code, scope),
  CONSTRAINT role_template_permissions_scope_ck CHECK (permission_scope = 'TENANT')
);

ALTER TABLE role_templates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_templates            FORCE  ROW LEVEL SECURITY;
ALTER TABLE role_template_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_template_permissions FORCE  ROW LEVEL SECURITY;

-- Katalog, seperti `permissions`: dibaca saja, dan hanya dari context platform.
-- Isinya diubah migrasi, bukan runtime - karena itu tidak ada grant tulis bagi siapa
-- pun, termasuk platform.
GRANT SELECT ON role_templates            TO app_user;
GRANT SELECT ON role_template_permissions TO app_user;
CREATE POLICY platform_read ON role_templates FOR SELECT TO app_user
  USING (app_context_kind() = 'platform');
CREATE POLICY platform_read ON role_template_permissions FOR SELECT TO app_user
  USING (app_context_kind() = 'platform');

-- F-27 membaca template ini sebagai app_auth_definer.
GRANT SELECT (component, code, name, includes_all_tenant_permissions, sort_order)
  ON role_templates TO app_auth_definer;
GRANT SELECT (component, role_code, permission_code, permission_scope)
  ON role_template_permissions TO app_auth_definer;
CREATE POLICY definer_read ON role_templates FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_read ON role_template_permissions FOR SELECT TO app_auth_definer USING (true);

-- ------------------------------------------------------- tenant: dibuat dari platform
-- Tenant adalah tabel control-plane, dan ADR-001 sec.3.5 memang mengizinkan context
-- platform menyentuhnya lewat policy - jadi ini policy, bukan fungsi definer baru.
--
-- Tenant baru SELALU lahir PROVISIONING. Itu bukan gaya penulisan: selama statusnya
-- PROVISIONING, F-27 dan F-28 mau bekerja padanya, dan begitu ACTIVE keduanya menolak.
-- Status itulah yang membuat "hanya saat pembuatan" menjadi aturan database.
CREATE POLICY platform_insert ON tenants FOR INSERT TO app_user
  WITH CHECK (app_context_kind() = 'platform' AND status = 'PROVISIONING');
GRANT INSERT (id, slug, name, status) ON tenants TO app_user;

-- Perubahan status (PROVISIONING -> ACTIVE saat provisioning selesai, dan
-- suspend/reactivate kelak) hanya dari context platform, dan hanya kolom status.
CREATE POLICY platform_update ON tenants FOR UPDATE TO app_user
  USING (app_context_kind() = 'platform')
  WITH CHECK (app_context_kind() = 'platform');
GRANT UPDATE (status, updated_at) ON tenants TO app_user;

-- ------------------------------------------------------- F-26 kunci tenant baru
-- app_user tetap TANPA hak apa pun atas crypto_keys; yang menulis fungsi ini.
GRANT INSERT (id, tenant_id, purpose, key_version, wrapped_dek, status)
  ON crypto_keys TO app_auth_definer;
CREATE POLICY definer_insert ON crypto_keys FOR INSERT TO app_auth_definer
  WITH CHECK (tenant_id IS NOT NULL AND status = 'ACTIVE');

CREATE FUNCTION auth.create_tenant_key(
  p_tenant_id   UUID,
  p_purpose     VARCHAR,
  p_key_version INTEGER,
  p_wrapped_dek BYTEA
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status VARCHAR(20);
BEGIN
  -- Kunci PLATFORM tidak boleh dibuat lewat jalur ini: purpose platform berarti
  -- tenant_id NULL (CHECK di tabel), dan menyerahkan pembuatannya ke jalur tenant
  -- akan membuat satu tenant dapat menumbuhkan kunci platform.
  IF p_purpose LIKE 'platform_%' OR p_tenant_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT t.status INTO v_status FROM tenants t WHERE t.id = p_tenant_id;
  IF v_status IS NULL OR v_status IN ('PURGED', 'ARCHIVED') THEN
    RETURN FALSE;
  END IF;

  -- Kunci kedua yang ACTIVE untuk (tenant, purpose) ditolak index unik parsial
  -- (0011), bukan oleh pemeriksaan di sini: satu penjaga, di tempat yang tidak dapat
  -- dilewati jalur lain.
  INSERT INTO crypto_keys (id, tenant_id, purpose, key_version, wrapped_dek, status)
  VALUES (gen_random_uuid(), p_tenant_id, p_purpose, p_key_version, p_wrapped_dek, 'ACTIVE');
  RETURN TRUE;
END;
$$;

ALTER FUNCTION auth.create_tenant_key(UUID, VARCHAR, INTEGER, BYTEA) OWNER TO app_auth_definer;
REVOKE ALL ON FUNCTION auth.create_tenant_key(UUID, VARCHAR, INTEGER, BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.create_tenant_key(UUID, VARCHAR, INTEGER, BYTEA) TO app_user;
COMMENT ON FUNCTION auth.create_tenant_key(UUID, VARCHAR, INTEGER, BYTEA) IS
  'F-26 provisioning: DEK terbungkus untuk tenant baru; purpose platform ditolak';

-- ------------------------------------------------------- F-27 role sistem tenant baru
-- Role owner memuat SELURUH permission tenant, dan daftarnya dihitung dari katalog
-- saat provisioning - jadi jalur definer perlu membacanya. Tiga kolom saja: kode,
-- scope, dan penanda pensiun. Deskripsi permission tidak ikut.
GRANT SELECT (code, scope, retired_at) ON permissions TO app_auth_definer;
CREATE POLICY definer_read ON permissions FOR SELECT TO app_auth_definer USING (true);

-- F-28 mencari role owner dari KODE-nya, jadi `code` dan `is_system` ikut dibaca.
-- Grant lama (0004) hanya memberi id, tenant_id, dan archived_at.
GRANT SELECT (code, is_system) ON roles TO app_auth_definer;
GRANT INSERT (id, tenant_id, code, name, is_system) ON roles TO app_auth_definer;
CREATE POLICY definer_insert ON roles FOR INSERT TO app_auth_definer
  WITH CHECK (is_system = TRUE);
GRANT INSERT (tenant_id, role_id, permission_code, permission_scope) ON role_permissions TO app_auth_definer;
CREATE POLICY definer_insert ON role_permissions FOR INSERT TO app_auth_definer
  WITH CHECK (permission_scope = 'TENANT');

CREATE FUNCTION auth.provision_tenant_roles(p_tenant_id UUID, p_component VARCHAR DEFAULT 'baseline')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status  VARCHAR(20);
  v_ada     INTEGER;
  v_dibuat  INTEGER := 0;
  v_role    RECORD;
  v_role_id UUID;
BEGIN
  SELECT t.status INTO v_status FROM tenants t WHERE t.id = p_tenant_id;
  IF v_status IS DISTINCT FROM 'PROVISIONING' THEN
    RETURN -1;   -- hanya tenant yang baru dibuat
  END IF;

  -- count(r.id), BUKAN count(*): dengan grant per kolom, `count(*)` menuntut hak
  -- tingkat TABEL dan ditolak 42501. Grant per kolom mengubah SQL apa yang sah, dan
  -- itu harga yang memang kita pilih di migrasi 0022.
  SELECT count(r.id) INTO v_ada FROM roles r WHERE r.tenant_id = p_tenant_id;
  IF v_ada > 0 THEN
    RETURN -2;   -- sudah punya role: jangan menggandakan
  END IF;

  FOR v_role IN
    SELECT code, name, includes_all_tenant_permissions
    FROM role_templates
    WHERE component = p_component
    ORDER BY sort_order, code
  LOOP
    v_role_id := gen_random_uuid();
    INSERT INTO roles (id, tenant_id, code, name, is_system)
    VALUES (v_role_id, p_tenant_id, v_role.code, v_role.name, TRUE);

    IF v_role.includes_all_tenant_permissions THEN
      -- Dihitung SEKARANG dari katalog, bukan disalin dari template: owner tenant
      -- baru ikut memegang permission yang lahir setelah migrasi ini.
      INSERT INTO role_permissions (tenant_id, role_id, permission_code, permission_scope)
      SELECT p_tenant_id, v_role_id, p.code, 'TENANT'
      FROM permissions p
      WHERE p.scope = 'TENANT' AND p.retired_at IS NULL;
    ELSE
      INSERT INTO role_permissions (tenant_id, role_id, permission_code, permission_scope)
      SELECT p_tenant_id, v_role_id, tp.permission_code, tp.permission_scope
      FROM role_template_permissions tp
      WHERE tp.component = p_component AND tp.role_code = v_role.code;
    END IF;

    v_dibuat := v_dibuat + 1;
  END LOOP;

  RETURN v_dibuat;
END;
$$;

ALTER FUNCTION auth.provision_tenant_roles(UUID, VARCHAR) OWNER TO app_auth_definer;
REVOKE ALL ON FUNCTION auth.provision_tenant_roles(UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.provision_tenant_roles(UUID, VARCHAR) TO app_user;
COMMENT ON FUNCTION auth.provision_tenant_roles(UUID, VARCHAR) IS
  'F-27 provisioning: role sistem tenant baru dari template; hanya tenant PROVISIONING tanpa role';

-- ------------------------------------------------------- F-28 owner pertama
-- Pengecualian terkontrol terhadap ADR-002 sec.2.2, dengan batas-batas di kepala
-- berkas ini ditegakkan di sini - bukan di kode aplikasi.
CREATE FUNCTION auth.provision_tenant_owner(
  p_tenant_id                 UUID,
  p_user_id                   UUID,
  p_profile_id                UUID,
  p_display_name_ciphertext   BYTEA,
  p_display_name_key_version  INTEGER,
  p_contact_email_ciphertext  BYTEA,
  p_contact_email_key_version INTEGER,
  p_contact_email_blind_index BYTEA
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status        VARCHAR(20);
  v_user_status   VARCHAR(20);
  v_ada           INTEGER;
  v_role_id       UUID;
  v_membership_id UUID;
BEGIN
  -- 1. Hanya tenant yang baru dibuat.
  SELECT t.status INTO v_status FROM tenants t WHERE t.id = p_tenant_id;
  IF v_status IS DISTINCT FROM 'PROVISIONING' THEN
    RETURN NULL;
  END IF;

  -- 2. Hanya bila tenant belum punya satu anggota pun. Inilah yang membuat
  --    kewenangan ini berlaku SEKALI per tenant, bukan selamanya.
  SELECT count(m.id) INTO v_ada FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id;
  IF v_ada > 0 THEN
    RETURN NULL;
  END IF;

  -- 3. Identitas harus sudah ada dan ACTIVE. Platform TIDAK membuat identitas:
  --    pembuatan identitas tetap hanya lewat undangan (F-16).
  SELECT u.status INTO v_user_status FROM users u WHERE u.id = p_user_id;
  IF v_user_status IS DISTINCT FROM 'ACTIVE' THEN
    RETURN NULL;
  END IF;

  -- 4. Role owner harus sudah ada (F-27 dijalankan lebih dulu) dan ber-is_system.
  SELECT r.id INTO v_role_id
  FROM roles r
  WHERE r.tenant_id = p_tenant_id AND r.code = 'tenant_owner' AND r.is_system;
  IF v_role_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- id dibuat DATABASE, bukan diterima dari pemanggil: jalur definer tidak punya
  -- grant INSERT atas kolom `id` (Lampiran A sec.4, sama seperti F-12), dan
  -- menambahkannya hanya supaya aplikasi dapat memilih id adalah pelebaran hak yang
  -- tidak dibutuhkan siapa pun.
  INSERT INTO tenant_memberships (tenant_id, user_id, status)
  VALUES (p_tenant_id, p_user_id, 'ACTIVE')
  RETURNING id INTO v_membership_id;

  INSERT INTO tenant_member_profiles (
    id, tenant_id, membership_id,
    display_name_ciphertext, display_name_key_version,
    contact_email_ciphertext, contact_email_key_version, contact_email_blind_index
  ) VALUES (
    p_profile_id, p_tenant_id, v_membership_id,
    p_display_name_ciphertext, p_display_name_key_version,
    p_contact_email_ciphertext, p_contact_email_key_version, p_contact_email_blind_index
  );

  -- 5. Hanya satu role, dan hanya tenant_owner. Pemberinya NULL: yang memberi adalah
  --    platform, dan platform tidak punya membership di tenant ini - jejaknya ada di
  --    audit tenant (tenant.owner_provisioned), bukan dipalsukan sebagai anggota.
  INSERT INTO user_role_assignments (tenant_id, membership_id, role_id, assigned_by_membership_id)
  VALUES (p_tenant_id, v_membership_id, v_role_id, NULL);

  RETURN v_membership_id;
END;
$$;

ALTER FUNCTION auth.provision_tenant_owner(UUID, UUID, UUID, BYTEA, INTEGER, BYTEA, INTEGER, BYTEA)
  OWNER TO app_auth_definer;
REVOKE ALL ON FUNCTION auth.provision_tenant_owner(UUID, UUID, UUID, BYTEA, INTEGER, BYTEA, INTEGER, BYTEA)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.provision_tenant_owner(UUID, UUID, UUID, BYTEA, INTEGER, BYTEA, INTEGER, BYTEA)
  TO app_user;
COMMENT ON FUNCTION auth.provision_tenant_owner(UUID, UUID, UUID, BYTEA, INTEGER, BYTEA, INTEGER, BYTEA) IS
  'F-28 provisioning: owner pertama tenant baru (pengecualian ADR-002, hanya PROVISIONING dan tanpa anggota)';

-- ------------------------------------------------------- isi template + katalog audit
-- FORCE dilepas sesaat di dalam satu transaksi (pola 0015/0018/0021): FORCE berlaku
-- juga bagi app_owner, dan policy di tabel ini ditujukan ke app_user - tanpa
-- pelepasan ini INSERT di bawah menyisipkan NOL baris dan berhasil tanpa pesan.
BEGIN;
ALTER TABLE role_templates            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE role_template_permissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_event_types         NO FORCE ROW LEVEL SECURITY;

INSERT INTO role_templates (component, code, name, includes_all_tenant_permissions, sort_order)
VALUES
  ('baseline', 'tenant_owner',   'Tenant Owner',   TRUE,  10),
  ('baseline', 'tenant_admin',   'Tenant Admin',   FALSE, 20),
  ('baseline', 'tenant_user',    'Tenant User',    FALSE, 30),
  ('baseline', 'tenant_auditor', 'Tenant Auditor', FALSE, 40);

INSERT INTO role_template_permissions (component, role_code, permission_code)
VALUES
  ('baseline', 'tenant_admin', 'profile.read'),
  ('baseline', 'tenant_admin', 'profile.update'),
  ('baseline', 'tenant_admin', 'members.read'),
  ('baseline', 'tenant_admin', 'members.invite'),
  ('baseline', 'tenant_admin', 'members.update_profile'),
  ('baseline', 'tenant_admin', 'members.suspend'),
  ('baseline', 'tenant_admin', 'members.assign_role'),
  ('baseline', 'tenant_admin', 'roles.read'),
  ('baseline', 'tenant_admin', 'roles.create'),
  ('baseline', 'tenant_admin', 'roles.update'),
  ('baseline', 'tenant_admin', 'roles.archive'),
  ('baseline', 'tenant_admin', 'roles.assign_permission'),
  ('baseline', 'tenant_admin', 'permissions.read'),
  ('baseline', 'tenant_admin', 'menus.read'),
  ('baseline', 'tenant_admin', 'audit.read'),
  ('baseline', 'tenant_user', 'profile.read'),
  ('baseline', 'tenant_user', 'profile.update'),
  ('baseline', 'tenant_user', 'menus.read'),
  ('baseline', 'tenant_auditor', 'profile.read'),
  ('baseline', 'tenant_auditor', 'members.read'),
  ('baseline', 'tenant_auditor', 'roles.read'),
  ('baseline', 'tenant_auditor', 'permissions.read'),
  ('baseline', 'tenant_auditor', 'menus.read'),
  ('baseline', 'tenant_auditor', 'audit.read');

-- Nama event baru: dicatat di audit TENANT juga, supaya tenant melihat bahwa anggota
-- pertamanya dibuat oleh platform - bukan hanya platform yang mencatatnya sendiri.
INSERT INTO audit_event_types (code, description)
VALUES ('tenant.owner_provisioned', 'Owner pertama tenant dibuat platform saat provisioning');

ALTER TABLE role_templates            FORCE ROW LEVEL SECURITY;
ALTER TABLE role_template_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_event_types         FORCE ROW LEVEL SECURITY;
COMMIT;

COMMENT ON TABLE role_templates IS
  'Template role sistem per komponen. Dipakai F-27 saat provisioning tenant; isinya diubah migrasi, bukan runtime.';
COMMENT ON COLUMN role_templates.includes_all_tenant_permissions IS
  'TRUE = isinya dihitung dari katalog permission saat provisioning, sehingga permission baru ikut terbawa.';
COMMENT ON TABLE role_template_permissions IS
  'Isi template role. Permission platform ditolak foreign key (code, scope), sama seperti role_permissions.';
