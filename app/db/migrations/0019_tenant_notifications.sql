-- 0019_tenant_notifications.sql
-- Dijalankan sebagai app_owner.
--
-- DEMO-0313: notifikasi keamanan tenant minimal (ADR-003 sec.2.4).
--
-- Gunanya satu: saat platform membuka support session ke sebuah tenant, tenant
-- itu HARUS melihatnya sendiri, bukan hanya percaya bahwa platform mencatatnya.
-- Transparansi itu adalah salah satu alasan break-glass dapat diterima
-- (ADR-003 sec.2.2 butir 7).
--
-- BATAS YANG PERLU DIKATAKAN TERUS TERANG: support session baru dibuat di
-- DEMO-0312. Sampai itu, tabel dan fungsi di bawah lengkap dengan RLS dan
-- endpoint-nya, tetapi TIDAK ADA alur produk yang memanggilnya - yang memanggil
-- hanya tes. Yang dikerjakan di sini adalah skema, penjaga, dan isolasi tenant;
-- bukan fitur yang dapat didemonstrasikan.
--
-- Ini juga bukan modul Notifications (General Feature Base sec.12): tidak ada
-- template, kanal, preferensi, maupun pengiriman. Hanya pemberitahuan dalam
-- aplikasi untuk dua jenis kejadian keamanan.
--
-- Aturan penulisan: ASCII murni.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- tabel
CREATE TABLE tenant_notifications (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             UUID        NOT NULL REFERENCES tenants (id),
  type                  VARCHAR(40) NOT NULL,
  -- Menunjuk support_sessions.id. Belum FOREIGN KEY: tabel itu baru ada di
  -- DEMO-0312. Ditambahkan sebagai FK di migrasi itu, bukan ditebak sekarang.
  ref_id                UUID        NOT NULL,
  audience              VARCHAR(40) NOT NULL DEFAULT 'TENANT_SECURITY_READERS',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at               TIMESTAMPTZ,
  read_by_membership_id UUID,
  CONSTRAINT tenant_notifications_tenant_id_key UNIQUE (tenant_id, id),
  -- Allowlist tipe ada DI DUA tempat: di sini dan di dalam F-15. Bukan
  -- kelebihan: CHECK menjaga setiap penulis (termasuk migrasi dan skrip),
  -- fungsi memberi pesan yang dapat dibaca kepada pemanggil yang salah.
  CONSTRAINT tenant_notifications_type_ck
    CHECK (type IN ('SUPPORT_SESSION_STARTED', 'SUPPORT_SESSION_ENDED')),
  CONSTRAINT tenant_notifications_audience_ck
    CHECK (audience = 'TENANT_SECURITY_READERS'),
  -- "Sudah dibaca" selalu berarti dibaca OLEH SESEORANG. Setengah keadaan
  -- (read_at terisi tanpa pembaca) tidak dapat ditulis.
  CONSTRAINT tenant_notifications_read_ck
    CHECK ((read_at IS NULL) = (read_by_membership_id IS NULL)),
  CONSTRAINT tenant_notifications_reader_fk
    FOREIGN KEY (tenant_id, read_by_membership_id)
    REFERENCES tenant_memberships (tenant_id, id)
);

CREATE INDEX tenant_notifications_unread_idx
  ON tenant_notifications (tenant_id, created_at DESC) WHERE read_at IS NULL;

ALTER TABLE tenant_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_notifications FORCE  ROW LEVEL SECURITY;

-- app_user TIDAK punya grant INSERT sama sekali. Itu inti DEMO-0313: baris ini
-- adalah kesaksian tentang platform, dan tenant maupun kode tenant tidak boleh
-- dapat mengarangnya. Satu-satunya jalan masuk adalah F-15.
GRANT SELECT ON tenant_notifications TO app_user;
GRANT UPDATE (read_at, read_by_membership_id) ON tenant_notifications TO app_user;

-- Batas tenant dijaga RLS. Syarat permission audit.read ditegakkan guard
-- aplikasi, bukan di sini: RLS tidak mengetahui membership pemanggil, hanya
-- tenant-nya. Keduanya diuji terpisah.
CREATE POLICY tenant_read ON tenant_notifications FOR SELECT TO app_user
  USING (tenant_id = app_current_tenant());
-- Menandai terbaca sekali jalan: yang sudah terbaca tidak dapat dijadikan
-- belum terbaca, sehingga jejaknya tidak dapat dibersihkan diam-diam.
CREATE POLICY tenant_update ON tenant_notifications FOR UPDATE TO app_user
  USING      (tenant_id = app_current_tenant() AND read_at IS NULL)
  WITH CHECK (tenant_id = app_current_tenant() AND read_at IS NOT NULL);

-- Lampiran A F-15.
GRANT INSERT (id, tenant_id, type, ref_id, audience) ON tenant_notifications TO app_auth_definer;
CREATE POLICY definer_insert ON tenant_notifications FOR INSERT TO app_auth_definer
  WITH CHECK (type IN ('SUPPORT_SESSION_STARTED', 'SUPPORT_SESSION_ENDED'));

-- ---------------------------------------------------------------- F-15
-- Penulis lintas context. Dipanggil dari context PLATFORM untuk menulis ke
-- tenant, jadi policy app_user tidak dapat dipakai dan tidak diperluas
-- (ADR-001 sec.3.8).
--
-- Nama schema: auth, mengikuti F-14 (auth.write_audit_event). Lampiran A
-- edisi sebelumnya menyebut audit_w.notify_tenant_security_event dan schema
-- audit_w tidak pernah ada di database; register diamandemen mengikuti kode,
-- preseden yang sama dengan D-30.
CREATE FUNCTION auth.notify_tenant_security_event(
  p_tenant_id UUID,
  p_type      TEXT,
  p_ref_id    UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_type NOT IN ('SUPPORT_SESSION_STARTED', 'SUPPORT_SESSION_ENDED') THEN
    RAISE EXCEPTION 'tipe notifikasi di luar allowlist' USING ERRCODE = '22023';
  END IF;

  -- Tenant harus benar-benar ada. Policy definer pada tenants sudah menyaring
  -- status PURGED, jadi tenant yang dihapus permanen tidak dapat dinotifikasi.
  IF NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'tenant tidak dikenal' USING ERRCODE = '23503';
  END IF;

  -- id dibuat di sini, BUKAN lewat RETURNING. Sebabnya bukan gaya: RETURNING
  -- menuntut hak SELECT atas barisnya, dan penulis ini sengaja tidak punya hak
  -- baca apa pun pada tabel ini. Tabel ini kesaksian tentang platform; yang
  -- menuliskannya tidak perlu dapat membacanya kembali.
  v_id := gen_random_uuid();

  INSERT INTO tenant_notifications (id, tenant_id, type, ref_id)
  VALUES (v_id, p_tenant_id, p_type, p_ref_id);

  RETURN v_id;
END;
$$;

ALTER FUNCTION auth.notify_tenant_security_event(UUID, TEXT, UUID) OWNER TO app_auth_definer;
REVOKE ALL ON FUNCTION auth.notify_tenant_security_event(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.notify_tenant_security_event(UUID, TEXT, UUID) TO app_user;

COMMENT ON TABLE tenant_notifications IS
  'Pemberitahuan keamanan dalam aplikasi untuk tenant (ADR-003 sec.2.4). Hanya F-15 yang dapat menulis.';
COMMENT ON COLUMN tenant_notifications.ref_id IS
  'support_sessions.id. FK ditambahkan di DEMO-0312 saat tabel itu dibuat.';
