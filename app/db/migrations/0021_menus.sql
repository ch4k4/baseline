-- 0021_menus.sql
-- Dijalankan sebagai app_owner.
--
-- DEMO-0401, 0402, 0403: skema menu, validasi hierarki/route, dan bahan resolver
-- menu efektif (Demo Foundation sec.10, sec.7.3).
--
-- YANG DIKERJAKAN DI SINI adalah menghapus satu kebohongan kecil yang sudah lama
-- berdiri: navigasi di layar dibangun dari DAFTAR TETAP di kode, disaring
-- permission. Itu bekerja, tetapi berarti "menu" tidak pernah menjadi data -
-- sehingga tidak ada satu pun tempat yang dapat menjawab "menu apa saja yang
-- boleh dilihat orang ini" selain kode frontend. Sejak migrasi ini, jawabannya ada
-- di database dan dihitung backend (Demo Foundation sec.10.1).
--
-- EMPAT KEPUTUSAN YANG MENENTUKAN BENTUK BERKAS INI:
--
-- 1. `owner_key` adalah KOLOM NYATA, bukan konsep. PostgreSQL tidak dapat memakai
--    ekspresi sebagai target foreign key maupun kolom unique, dan menu platform
--    (`tenant_id IS NULL`) harus dapat menjadi induk menu platform lain. Sentinel
--    UUID nol dipakai untuk baris platform, dan nilai itu tidak pernah menjadi
--    `tenants.id` (Demo Foundation sec.7.3).
--
-- 2. `context_kind` menempel pada MENU, dan permission yang dipetakan padanya
--    WAJIB ber-scope sama. Ditegakkan composite FK + CHECK, bukan validasi
--    aplikasi - pola yang sama dengan role_permissions (0013) dan
--    platform_role_permissions (0018). Tanpa itu, menu konsol platform dapat
--    dipetakan ke permission tenant (selalu tak terlihat, tanpa pesan) atau
--    sebaliknya (terlihat oleh orang yang tidak berhak membuka halamannya).
--
-- 3. Menu TANPA pemetaan permission bersifat deny-by-default (sec.10.2). Satu
--    pengecualian dinyatakan sebagai kolom, bukan sebagai kasus khusus di kode:
--    `is_public_authenticated` untuk menu yang memang terbuka bagi setiap session
--    sah (dasbor). Kalau pengecualian itu hidup di kode, ia akan tumbuh.
--
-- 4. `app_user` TIDAK punya grant tulis apa pun di kedua tabel. Administrasi menu
--    (DEMO-0404/0406) diturunkan ke P2 dan tidak ada di baseline; menyatakannya
--    lewat GRANT - bukan lewat "belum ada endpoint" - membuat pernyataan itu
--    berlaku juga bagi kode yang keliru.
--
-- Aturan penulisan: ASCII murni.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- menus
CREATE TABLE menus (
  id         UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id  UUID         REFERENCES tenants (id),
  -- Materialisasi ownership scope. STORED, bukan VIRTUAL: nilainya menjadi target
  -- foreign key dan unique constraint.
  owner_key  UUID         NOT NULL GENERATED ALWAYS AS
               (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  parent_id  UUID,
  -- Context tempat menu ini hidup. Menu tenant selalu TENANT; menu platform boleh
  -- keduanya - navigasi tenant yang sama untuk semua tenant memang dimiliki
  -- platform (mixed-ownership, ADR-001 sec.3.8), sementara navigasi konsol
  -- platform ber-context PLATFORM.
  context_kind VARCHAR(10) NOT NULL DEFAULT 'TENANT',
  code       VARCHAR(64)  NOT NULL,
  label      VARCHAR(80)  NOT NULL,
  path       VARCHAR(120),
  icon       VARCHAR(40),
  sort_order INTEGER      NOT NULL DEFAULT 0,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  is_system  BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Satu-satunya pengecualian deny-by-default, dan ia harus dinyatakan per baris.
  is_public_authenticated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  version    INTEGER      NOT NULL DEFAULT 1,
  CONSTRAINT menus_owner_id_key      UNIQUE (owner_key, id),
  CONSTRAINT menus_owner_code_key    UNIQUE (owner_key, code),
  -- Target FK dari menu_permissions: pasangan (owner, id, context) yang sah.
  CONSTRAINT menus_owner_id_context_key UNIQUE (owner_key, id, context_kind),
  CONSTRAINT menus_context_kind_ck   CHECK (context_kind IN ('TENANT', 'PLATFORM')),
  -- Menu milik tenant tidak dapat menjadi menu konsol platform.
  CONSTRAINT menus_tenant_context_ck CHECK (tenant_id IS NULL OR context_kind = 'TENANT'),
  -- Induk dan anak wajib berada di ownership scope yang SAMA. Ditegakkan FK, bukan
  -- validasi aplikasi: inilah yang membuat menu tenant lain tidak dapat menjadi
  -- induk (DEMO-0401).
  CONSTRAINT menus_parent_fk FOREIGN KEY (owner_key, parent_id)
    REFERENCES menus (owner_key, id),
  CONSTRAINT menus_not_self_parent_ck CHECK (parent_id IS NULL OR parent_id <> id),
  -- Route internal saja. Yang ditolak bukan "URL yang aneh" melainkan segala yang
  -- bukan path aplikasi: skema yang dapat dieksekusi (`javascript:`), URL absolut
  -- (`//contoh.co.id`, `https://...`), dan penelusuran direktori (`..`).
  -- Formatnya sempit dengan sengaja - menu yang dapat menunjuk ke luar aplikasi
  -- adalah permukaan phishing di dalam navigasi yang dipercaya pengguna.
  CONSTRAINT menus_path_ck CHECK (
    path IS NULL OR path ~ '^/[a-z0-9][a-z0-9/_-]*$'
  ),
  CONSTRAINT menus_sort_ck CHECK (sort_order >= 0),
  -- Tanda hubung diizinkan karena `code` adalah pengenal yang dipakai di luar
  -- database juga: ia menjadi data-testid navigasi dan mengikuti gaya route
  -- (`platform-support`, bukan `platform_support`). Satu pengenal, satu ejaan.
  CONSTRAINT menus_code_ck CHECK (code ~ '^[a-z][a-z0-9-]*$')
);

CREATE INDEX menus_owner_parent_idx ON menus (owner_key, parent_id, sort_order);

-- ---------------------------------------------------------- menu_permissions
CREATE TABLE menu_permissions (
  tenant_id        UUID REFERENCES tenants (id),
  owner_key        UUID NOT NULL GENERATED ALWAYS AS
                     (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  menu_id          UUID NOT NULL,
  -- Disalin dari menunya, dan dipaksa sama dengan scope permission oleh CHECK di
  -- bawah. Dua kolom untuk satu nilai memang terlihat berlebih; itulah yang
  -- membuat KEDUA sisi (menu dan katalog permission) dapat dijaga foreign key.
  context_kind     VARCHAR(10) NOT NULL,
  permission_code  VARCHAR(64) NOT NULL,
  permission_scope VARCHAR(10) NOT NULL,
  match_mode       VARCHAR(4)  NOT NULL DEFAULT 'ANY',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT menu_permissions_pkey PRIMARY KEY (owner_key, menu_id, permission_code),
  CONSTRAINT menu_permissions_match_ck CHECK (match_mode IN ('ANY', 'ALL')),
  CONSTRAINT menu_permissions_scope_ck CHECK (permission_scope = context_kind),
  CONSTRAINT menu_permissions_menu_fk FOREIGN KEY (owner_key, menu_id, context_kind)
    REFERENCES menus (owner_key, id, context_kind),
  CONSTRAINT menu_permissions_permission_fk FOREIGN KEY (permission_code, permission_scope)
    REFERENCES permissions (code, scope)
);

-- ------------------------------------------------------- penjaga hierarki
-- Siklus tidak dapat ditolak CHECK maupun foreign key: keduanya hanya melihat satu
-- baris. Trigger ini menelusuri rantai induk ke atas.
--
-- SECURITY DEFINER dan dimiliki app_auth_definer, DAN tabelnya diberi policy baca
-- untuk role itu. Sebabnya pelajaran migrasi 0018: FORCE ROW LEVEL SECURITY
-- berlaku juga bagi app_owner, sehingga SELECT di dalam trigger yang berjalan
-- sebagai pemanggil biasa akan membaca NOL BARIS - dan penjaga yang membaca nol
-- baris tidak menolak apa pun, tanpa pesan apa pun. Penjaga yang buta lebih
-- berbahaya daripada tidak ada penjaga, karena ia terlihat ada.
CREATE FUNCTION auth.menus_assert_hierarchy() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id    UUID := NEW.parent_id;
  v_depth INTEGER := 0;
  -- Dihitung ULANG dari tenant_id, BUKAN dibaca dari NEW.owner_key.
  --
  -- Sebabnya ditemukan tesnya sendiri: `owner_key` adalah kolom GENERATED STORED,
  -- dan PostgreSQL menghitungnya SESUDAH trigger BEFORE berjalan - jadi di dalam
  -- trigger ini nilainya NULL. Versi pertama memakainya, sehingga `WHERE owner_key
  -- = NULL` mengembalikan nol baris, penelusuran rantai induk berhenti seketika,
  -- dan SIKLUS LOLOS tanpa pesan apa pun. Persis jenis penjaga buta yang komentar
  -- di atas memperingatkan - hanya dengan sebab yang berbeda.
  v_owner UUID := coalesce(NEW.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  WHILE v_id IS NOT NULL LOOP
    v_depth := v_depth + 1;
    IF v_id = NEW.id THEN
      RAISE EXCEPTION 'hierarchy menu tidak boleh membentuk siklus (% -> %)', NEW.code, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_depth > 10 THEN
      RAISE EXCEPTION 'hierarchy menu terlalu dalam (maksimal 10 tingkat)'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT m.parent_id INTO v_id
    FROM menus m
    WHERE m.owner_key = v_owner AND m.id = v_id;
  END LOOP;
  RETURN NEW;
END;
$$;

ALTER FUNCTION auth.menus_assert_hierarchy() OWNER TO app_auth_definer;

CREATE TRIGGER menus_hierarchy_guard
  BEFORE INSERT OR UPDATE OF parent_id ON menus
  FOR EACH ROW EXECUTE FUNCTION auth.menus_assert_hierarchy();

-- ---------------------------------------------------------------- RLS
ALTER TABLE menus            ENABLE ROW LEVEL SECURITY;
ALTER TABLE menus            FORCE  ROW LEVEL SECURITY;
ALTER TABLE menu_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_permissions FORCE  ROW LEVEL SECURITY;

-- HANYA SELECT. Tidak ada INSERT, UPDATE, maupun DELETE untuk app_user - lihat
-- keputusan 4 di kepala berkas.
GRANT SELECT ON menus            TO app_user;
GRANT SELECT ON menu_permissions TO app_user;

-- Context tenant (dan support, yang berjalan di tenant): navigasi tenant, yaitu
-- menu platform yang dipublikasikan untuk semua tenant DITAMBAH menu tenant ini
-- sendiri. Menu konsol platform tidak ikut - itu bukan "menu yang tidak boleh
-- diklik", melainkan menu yang tidak ada untuk mereka.
CREATE POLICY tenant_read ON menus FOR SELECT TO app_user
  USING (
    app_context_kind() IN ('tenant', 'support')
    AND context_kind = 'TENANT'
    AND (tenant_id IS NULL OR tenant_id = app_current_tenant())
  );
CREATE POLICY tenant_read ON menu_permissions FOR SELECT TO app_user
  USING (
    app_context_kind() IN ('tenant', 'support')
    AND context_kind = 'TENANT'
    AND (tenant_id IS NULL OR tenant_id = app_current_tenant())
  );

-- Context platform: hanya menu konsol platform.
CREATE POLICY platform_read ON menus FOR SELECT TO app_user
  USING (app_context_kind() = 'platform' AND context_kind = 'PLATFORM' AND tenant_id IS NULL);
CREATE POLICY platform_read ON menu_permissions FOR SELECT TO app_user
  USING (app_context_kind() = 'platform' AND context_kind = 'PLATFORM' AND tenant_id IS NULL);

-- Trigger penjaga hierarki membaca tabel ini sebagai app_auth_definer.
GRANT SELECT (owner_key, id, parent_id, code) ON menus TO app_auth_definer;
CREATE POLICY definer_read ON menus FOR SELECT TO app_auth_definer USING (true);

-- ---------------------------------------------------------------- seed
-- Menu sistem, dimiliki PLATFORM dan dipublikasikan ke semua tenant. Diisi di
-- migrasi karena sifatnya sama dengan katalog permission: bagian dari kontrak
-- kode, bukan data yang diketik pemakai.
--
-- FORCE dilepas sesaat di dalam satu transaksi (pola migrasi 0015/0018): FORCE
-- berlaku juga bagi app_owner, dan satu-satunya policy di sini ditujukan ke
-- app_user - tanpa pelepasan ini INSERT di bawah menyisipkan nol baris dan
-- berhasil tanpa pesan. Penjaganya bukan komentar ini melainkan kasus SQL yang
-- menuntut isi tabel sama dengan yang diharapkan.
BEGIN;
ALTER TABLE menus            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE menu_permissions NO FORCE ROW LEVEL SECURITY;
-- `permissions` ikut dilepas sesaat karena deskripsi satu baris katalog dikoreksi
-- di bawah; FORCE berlaku juga bagi app_owner, sehingga UPDATE tanpa pelepasan ini
-- mengenai NOL baris dan berhasil tanpa pesan.
ALTER TABLE permissions      NO FORCE ROW LEVEL SECURITY;

-- `menus.read` SEBELUMNYA berbunyi "Melihat menu yang diizinkan", dan bunyi itu
-- mengundang kekeliruan: ia terbaca seperti syarat untuk memanggil GET /me/menu.
-- Route itu justru TIDAK boleh ber-permission - anggota yang belum diberi role apa
-- pun harus tetap mendapat kerangka dan dasbornya (skenario demo 2), dan menuntut
-- permission di sana menghasilkan lingkaran: tidak ada navigasi yang menuntun ke
-- izin untuk melihat navigasi. Permission ini dicadangkan untuk administrasi menu
-- (DEMO-0404, P2), dan deskripsinya kini mengatakannya.
UPDATE permissions
   SET description = 'Membaca definisi menu (administrasi menu, P2)'
 WHERE code = 'menus.read';

-- Navigasi tenant: satu menu terbuka (dasbor) dan satu grup administrasi.
INSERT INTO menus (id, tenant_id, context_kind, parent_id, code, label, path, icon, sort_order, is_system, is_public_authenticated)
VALUES
  ('e0000000-0000-0000-0000-000000000001', NULL, 'TENANT', NULL, 'dashboard', 'Dasbor', '/dashboard', 'home', 10, TRUE, TRUE),
  -- Grup tanpa route: ia muncul hanya bila ada anak yang terlihat (sec.10.2), dan
  -- itu yang membuat anggota tanpa hak administrasi tidak melihat grup kosong.
  ('e0000000-0000-0000-0000-000000000002', NULL, 'TENANT', NULL, 'administration', 'Administrasi', NULL, 'settings', 20, TRUE, FALSE),
  ('e0000000-0000-0000-0000-000000000003', NULL, 'TENANT', 'e0000000-0000-0000-0000-000000000002', 'members', 'Anggota', '/administration/members', 'users', 10, TRUE, FALSE),
  ('e0000000-0000-0000-0000-000000000004', NULL, 'TENANT', 'e0000000-0000-0000-0000-000000000002', 'invitations', 'Undangan', '/administration/invitations', 'mail', 20, TRUE, FALSE),
  ('e0000000-0000-0000-0000-000000000005', NULL, 'TENANT', 'e0000000-0000-0000-0000-000000000002', 'roles', 'Role', '/administration/roles', 'key', 30, TRUE, FALSE),
  ('e0000000-0000-0000-0000-000000000006', NULL, 'TENANT', 'e0000000-0000-0000-0000-000000000002', 'security', 'Keamanan', '/administration/notifications', 'shield', 40, TRUE, FALSE),
  -- Navigasi konsol platform.
  ('e0000000-0000-0000-0000-000000000011', NULL, 'PLATFORM', NULL, 'platform-admins', 'Admin platform', '/platform/admins', 'users', 20, TRUE, FALSE),
  ('e0000000-0000-0000-0000-000000000012', NULL, 'PLATFORM', NULL, 'platform-support', 'Sesi dukungan', '/platform/support-sessions', 'shield', 30, TRUE, FALSE);

INSERT INTO menu_permissions (tenant_id, menu_id, context_kind, permission_code, permission_scope)
VALUES
  (NULL, 'e0000000-0000-0000-0000-000000000003', 'TENANT', 'members.read', 'TENANT'),
  -- Undangan memakai members.read, mengikuti GET /invitations (Demo Foundation
  -- sec.11.1a); memetakannya ke members.invite akan menyembunyikan menu dari
  -- auditor yang justru boleh melihat daftarnya.
  (NULL, 'e0000000-0000-0000-0000-000000000004', 'TENANT', 'members.read', 'TENANT'),
  (NULL, 'e0000000-0000-0000-0000-000000000005', 'TENANT', 'roles.read',   'TENANT'),
  (NULL, 'e0000000-0000-0000-0000-000000000006', 'TENANT', 'audit.read',   'TENANT'),
  (NULL, 'e0000000-0000-0000-0000-000000000011', 'PLATFORM', 'platform.admins.read',        'PLATFORM'),
  (NULL, 'e0000000-0000-0000-0000-000000000012', 'PLATFORM', 'platform.support.start_read', 'PLATFORM');

ALTER TABLE menus            FORCE ROW LEVEL SECURITY;
ALTER TABLE menu_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE permissions      FORCE ROW LEVEL SECURITY;
COMMIT;

COMMENT ON TABLE menus IS
  'Menu navigasi (Demo Foundation sec.10). Hanya dibaca aplikasi; administrasi menu adalah P2 dan tidak ada grant tulisnya.';
COMMENT ON COLUMN menus.owner_key IS
  'tenant_id, atau UUID sentinel nol untuk menu platform. Kolom nyata karena FK dan UNIQUE tidak dapat memakai ekspresi.';
COMMENT ON COLUMN menus.is_public_authenticated IS
  'Satu-satunya pengecualian deny-by-default: menu terbuka bagi setiap session sah (sec.10.2).';
COMMENT ON TABLE menu_permissions IS
  'Pemetaan menu -> permission. Scope permission dipaksa sama dengan context menu oleh CHECK + composite FK.';
