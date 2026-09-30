-- 0018_platform_roles.sql
-- Dijalankan sebagai app_owner.
--
-- DEMO-0311: guard platform dan pengelolaan admin platform (ADR-003 sec.2.1,
-- sec.2.4, sec.2.5, sec.2.6).
--
-- Yang ditambahkan:
--   1. app_context_kind()          - pembaca GUC app.context_kind, fail-closed.
--   2. platform_role_assignments   - siapa superadmin, sejak kapan, oleh siapa.
--   3. platform_role_permissions   - permission apa yang dibawa sebuah role platform.
--   4. F-13 auth.get_platform_roles
--   5. F-04 auth.list_login_contexts diperluas: context PLATFORM ikut terdaftar.
--   6. F-07 auth.create_session menolak context yang tidak berhak.
--
-- KENAPA ADA TABEL PEMETAAN, bukan "superadmin = semua permission platform":
-- ADR-003 sec.2.2 butir 1 menyatakan support session READ_WRITE membutuhkan
-- permission TERSENDIRI (platform.support.start_write). Kalau hak platform
-- dihitung sebagai "semua baris scope PLATFORM", pemisahan itu tidak punya arti
-- apa pun - setiap pemegang role platform otomatis memegangnya. Tabel ini
-- membuat pemisahan tersebut nyata sejak sekarang, sebelum 0312 bergantung
-- padanya. Isinya untuk platform_superadmin memang seluruh katalog PLATFORM
-- (sec.2.1), dan diisi DARI katalog supaya tidak ada daftar kedua yang bisa basi.
--
-- Aturan penulisan: ASCII murni.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- GUC context
-- Pembaca app.context_kind. Nilai kosong atau tidak diset dibaca sebagai
-- 'tenant', BUKAN 'platform': lupa menetapkan context tidak boleh membuka
-- tabel platform. Sama seperti app_current_tenant(), STABLE bukan IMMUTABLE.
CREATE OR REPLACE FUNCTION app_context_kind() RETURNS text
LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('app.context_kind', true), ''), 'tenant') $$;

REVOKE ALL ON FUNCTION app_context_kind() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_context_kind() TO app_user, app_auth_definer;

-- ---------------------------------------------------------------- assignment
CREATE TABLE platform_role_assignments (
  id         UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID         NOT NULL REFERENCES users (id),
  role_code  VARCHAR(64)  NOT NULL,
  granted_by UUID         REFERENCES users (id),
  granted_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID         REFERENCES users (id),
  reason     VARCHAR(200),
  -- Satu role platform pada baseline. Role berikutnya menambah baris CHECK ini
  -- lewat migrasi, bukan lewat data: nama role adalah bagian kontrak kode.
  CONSTRAINT platform_role_assignments_role_ck
    CHECK (role_code IN ('platform_superadmin')),
  CONSTRAINT platform_role_assignments_revoke_ck
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT platform_role_assignments_period_ck
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  -- Pelajaran D-26 dibawa ke sini: kolom teks bebas yang diketik manusia dan
  -- tidak dienkripsi bukan tempat data pribadi. Alamat email ditolak. Deretan
  -- angka TIDAK ditolak (berbeda dari roles.name) karena nomor tiket dukungan
  -- yang sah justru berbentuk demikian.
  CONSTRAINT platform_role_assignments_reason_ck CHECK (reason IS NULL OR reason !~ '@')
);

-- Satu assignment AKTIF per user + role; baris historis boleh berulang.
CREATE UNIQUE INDEX platform_role_assignments_active_uq
  ON platform_role_assignments (user_id, role_code) WHERE revoked_at IS NULL;

ALTER TABLE platform_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_role_assignments FORCE  ROW LEVEL SECURITY;

-- Tabel ini platform-global (tanpa tenant_id). Yang menjaganya bukan tenant_id
-- melainkan context: seluruh policy app_user mensyaratkan context platform,
-- sehingga session tenant tidak dapat membaca maupun mengubah daftar superadmin
-- - ditolak database, bukan hanya oleh guard aplikasi (ADR-001 sec.3.8).
GRANT SELECT ON platform_role_assignments TO app_user;
GRANT INSERT (id, user_id, role_code, granted_by, reason)
  ON platform_role_assignments TO app_user;
GRANT UPDATE (revoked_at, revoked_by) ON platform_role_assignments TO app_user;

CREATE POLICY platform_read ON platform_role_assignments FOR SELECT TO app_user
  USING (app_context_kind() = 'platform');
CREATE POLICY platform_insert ON platform_role_assignments FOR INSERT TO app_user
  WITH CHECK (app_context_kind() = 'platform' AND revoked_at IS NULL);
-- Hanya mencabut yang masih aktif; baris yang sudah dicabut tidak dihidupkan.
CREATE POLICY platform_update ON platform_role_assignments FOR UPDATE TO app_user
  USING      (app_context_kind() = 'platform' AND revoked_at IS NULL)
  WITH CHECK (app_context_kind() = 'platform' AND revoked_at IS NOT NULL);

-- Lampiran A: F-04, F-07, dan F-13 membaca tabel ini sebelum context ada.
GRANT SELECT (user_id, role_code, revoked_at)
  ON platform_role_assignments TO app_auth_definer;
CREATE POLICY definer_read ON platform_role_assignments FOR SELECT TO app_auth_definer
  USING (revoked_at IS NULL);

-- ---------------------------------------------------------------- pemetaan
CREATE TABLE platform_role_permissions (
  role_code        VARCHAR(64) NOT NULL,
  permission_code  VARCHAR(64) NOT NULL,
  -- Selalu 'PLATFORM': bersama FK di bawah, permission tenant tidak dapat
  -- dirujuk dari role platform. Kebalikan dari role_permissions (0013), dan
  -- ditegakkan database di kedua arah.
  permission_scope VARCHAR(10) NOT NULL DEFAULT 'PLATFORM',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_role_permissions_pkey PRIMARY KEY (role_code, permission_code),
  CONSTRAINT platform_role_permissions_scope_ck CHECK (permission_scope = 'PLATFORM'),
  CONSTRAINT platform_role_permissions_role_ck
    CHECK (role_code IN ('platform_superadmin')),
  CONSTRAINT platform_role_permissions_permission_fk
    FOREIGN KEY (permission_code, permission_scope) REFERENCES permissions (code, scope)
);

-- Diisi DARI katalog, bukan dari daftar yang ditulis ulang di sini: ADR-003
-- sec.2.1 memberi superadmin seluruh kewenangan control-plane, dan satu-satunya
-- tempat daftar itu hidup adalah tabel permissions.
--
-- FORCE dilepas sesaat, di dalam satu transaksi. Sebabnya sama dengan migrasi
-- 0015, tetapi akibatnya lebih berbahaya di sini: FORCE berlaku juga bagi
-- app_owner, dan satu-satunya policy di permissions ditujukan ke app_user -
-- sehingga app_owner MEMBACA NOL BARIS. Tanpa pelepasan ini, INSERT ... SELECT
-- di bawah menyisipkan nol baris dan berhasil tanpa pesan apa pun. Penjaga
-- sebenarnya bukan komentar ini, melainkan kasus SQL slice 13 yang menuntut isi
-- tabel ini sama dengan katalog.
BEGIN;
ALTER TABLE permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO platform_role_permissions (role_code, permission_code)
SELECT 'platform_superadmin', p.code
FROM permissions p
WHERE p.scope = 'PLATFORM';

ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
COMMIT;

ALTER TABLE platform_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_role_permissions FORCE  ROW LEVEL SECURITY;

-- Hanya dibaca, dan hanya pada context platform: tenant tidak perlu tahu peta
-- hak platform. Perubahan isi lewat migrasi, sama seperti katalog permission.
GRANT SELECT ON platform_role_permissions TO app_user;
CREATE POLICY platform_read ON platform_role_permissions FOR SELECT TO app_user
  USING (app_context_kind() = 'platform');

-- ---------------------------------------------------------------- F-13
-- Dipakai guard platform DAN jalur login: keduanya berjalan sebelum context
-- platform ditetapkan, jadi tidak dapat mengandalkan policy app_user di atas.
CREATE FUNCTION auth.get_platform_roles(p_user_id UUID)
RETURNS TABLE (role_code VARCHAR)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT a.role_code
  FROM platform_role_assignments a
  WHERE a.user_id = p_user_id
    AND a.revoked_at IS NULL;
$$;

ALTER FUNCTION auth.get_platform_roles(UUID) OWNER TO app_auth_definer;
REVOKE ALL ON FUNCTION auth.get_platform_roles(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.get_platform_roles(UUID) TO app_user;

-- ---------------------------------------------------------------- F-04
-- Context PLATFORM menjadi BARIS dalam daftar, bukan flag di samping daftar.
--
-- Alasannya bukan selera: superadmin tanpa membership tenant tidak menghasilkan
-- satu baris pun, sehingga sebuah flag harus ikut di baris yang tidak ada.
-- Sebagai baris, tiga kasus langsung benar tanpa cabang tambahan di aplikasi:
-- nol context tetap gagal generik, satu context langsung menjadi session, lebih
-- dari satu tetap meminta pemilihan (ADR-003 sec.2.6).
DROP FUNCTION auth.list_login_contexts(UUID);
CREATE FUNCTION auth.list_login_contexts(p_user_id UUID)
RETURNS TABLE (
  context_kind  VARCHAR,
  tenant_id     UUID,
  tenant_slug   VARCHAR,
  tenant_name   VARCHAR,
  membership_id UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.k, s.tid, s.slug, s.nama, s.mid
  FROM (
    SELECT 'TENANT'::VARCHAR AS k, t.id AS tid, t.slug AS slug, t.name AS nama, m.id AS mid
    FROM tenant_memberships m
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = p_user_id
      AND m.status  = 'ACTIVE'
      AND t.status  = 'ACTIVE'
    UNION ALL
    SELECT 'PLATFORM'::VARCHAR, NULL::UUID, NULL::VARCHAR, NULL::VARCHAR, NULL::UUID
    WHERE EXISTS (
      SELECT 1 FROM platform_role_assignments a
      WHERE a.user_id = p_user_id AND a.revoked_at IS NULL
    )
  ) s
  -- Tenant lebih dulu, berurut nama; platform terakhir supaya posisinya tetap.
  ORDER BY (s.k = 'PLATFORM'), s.nama;
$$;

ALTER FUNCTION auth.list_login_contexts(UUID) OWNER TO app_auth_definer;
REVOKE ALL ON FUNCTION auth.list_login_contexts(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.list_login_contexts(UUID) TO app_user;

-- ---------------------------------------------------------------- F-07
-- Sampai sekarang fungsi ini percaya pemanggilnya: context_kind dan membership
-- masuk apa adanya. Composite FK menolak membership milik tenant lain, tetapi
-- TIDAK menolak dua hal yang kini mungkin terjadi:
--
--   1. session PLATFORM untuk user yang bukan admin platform;
--   2. session TENANT atas membership yang sudah tidak aktif.
--
-- Keduanya diperiksa di sini, bukan hanya di aplikasi: fungsi ini adalah satu-
-- satunya jalan membuat session, jadi di sinilah syaratnya paling murah dijaga.
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
  IF p_context_kind = 'PLATFORM' THEN
    IF p_tenant_id IS NOT NULL OR p_membership_id IS NOT NULL THEN
      RAISE EXCEPTION 'session PLATFORM tidak membawa tenant' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM platform_role_assignments a
      WHERE a.user_id = p_user_id AND a.revoked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'tanpa role platform' USING ERRCODE = '42501';
    END IF;

  ELSIF p_context_kind = 'TENANT' THEN
    -- Yang diperiksa di sini SENGAJA tidak menyertakan tenant: membership ini
    -- milik user itu dan masih aktif. Kecocokan membership dengan TENANT-nya
    -- dijaga composite FK (tenant_id, membership_id) di 0002.
    --
    -- Pembagian itu bukan kerapian. Versi pertama pemeriksaan ini juga menuntut
    -- m.tenant_id = p_tenant_id, dan akibatnya percobaan memakai membership
    -- tenant lain ditolak DI SINI - sehingga composite FK tidak pernah lagi
    -- diuji, dan kasus SQL slice 1 #12 yang ada untuk membuktikan FK itu lulus
    -- karena alasan yang salah. Satu penjaga tidak boleh menutupi penjaga lain,
    -- jadi masing-masing membuktikan satu hal: fungsi ini menjaga batas ORANG,
    -- composite FK menjaga batas TENANT.
    IF NOT EXISTS (
      SELECT 1 FROM tenant_memberships m
      WHERE m.id      = p_membership_id
        AND m.user_id = p_user_id
        AND m.status  = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'tanpa membership aktif' USING ERRCODE = '42501';
    END IF;

  ELSE
    RAISE EXCEPTION 'context_kind tidak dikenal' USING ERRCODE = '22023';
  END IF;

  INSERT INTO sessions (context_kind, tenant_id, user_id, membership_id, expires_at)
  VALUES (p_context_kind, p_tenant_id, p_user_id, p_membership_id,
          now() + make_interval(mins => p_ttl_minutes))
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

ALTER FUNCTION auth.create_session(VARCHAR, UUID, UUID, UUID, INTEGER)
  OWNER TO app_auth_definer;
REVOKE ALL ON FUNCTION auth.create_session(VARCHAR, UUID, UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.create_session(VARCHAR, UUID, UUID, UUID, INTEGER) TO app_user;

COMMENT ON TABLE platform_role_assignments IS
  'Siapa memegang role platform (ADR-003 sec.2.4). Platform-global: dijaga context, bukan tenant_id.';
COMMENT ON TABLE platform_role_permissions IS
  'Permission yang dibawa sebuah role platform. Diisi dari katalog permissions scope PLATFORM.';
