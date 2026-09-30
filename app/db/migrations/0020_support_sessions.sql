-- 0020_support_sessions.sql
-- Dijalankan sebagai app_owner.
--
-- DEMO-0312: support session break-glass (ADR-003 sec.2.2, sec.2.3, sec.2.4).
--
-- INI ADALAH SATU-SATUNYA JALAN platform menyentuh data tenant. Tanpa baris di
-- tabel ini, superadmin tidak dapat membaca satu pun tabel tenant-owned - bukan
-- karena aplikasi sopan, melainkan karena context platform tidak memenuhi policy
-- tenant mana pun (ADR-003 sec.2.1).
--
-- TIGA KEPUTUSAN YANG MENENTUKAN BENTUK BERKAS INI:
--
-- 1. Support session TIDAK memakai role yang mem-bypass RLS. Transaksinya
--    berjalan sebagai app_user dengan app.current_tenant_id = tenant sesi,
--    sehingga policy yang sama dengan request tenant biasa berlaku. Yang berbeda
--    hanya app.context_kind = 'support' dan permission set di aplikasi.
--    Akibat yang penting: sesi ke Tenant Alpha tidak dapat menyentuh Tenant Beta
--    karena alasan yang sama seperti anggota Alpha tidak dapat - RLS, bukan kode.
--
-- 2. Batas waktu ditegakkan CHECK, bukan aplikasi. `expires_at` wajib berada di
--    dalam 60 menit sejak `started_at` (ADR-003 sec.2.2 butir 5), dan nilainya
--    dihitung dari now() DATABASE pada saat INSERT - bukan dari jam proses API,
--    yang dapat berbeda.
--
-- 3. Satu sesi aktif per superadmin ditegakkan index unik parsial (butir 6).
--    Aturan yang hanya ada di kode akan bocor pada dua permintaan bersamaan.
--
-- `reason_text` DIENKRIPSI karena dapat menyebut orang ("akun Budi tidak dapat
-- masuk sejak kemarin"). Kuncinya adalah DEK PLATFORM (purpose
-- platform_support_reason), bukan DEK tenant seperti tertulis di ADR-003 sec.2.4
-- edisi sebelumnya: penulisnya berjalan di context platform, dan slice 8
-- menetapkan kunci tenant hanya diserahkan di dalam context tenant pemiliknya.
-- Memaksa DEK tenant di sini berarti membuka jalur baru yang menyerahkan kunci
-- tenant ke context platform - melemahkan aturan yang sudah terbukti demi satu
-- kolom. Register diamandemen mengikuti kode (preseden D-30).
--
-- Akibat jujur dari pilihan itu: pembaca di tenant melihat baris sesi, alasan
-- berupa KODE, dan nomor tiket - tetapi tidak dapat membuka teks bebasnya. Byte
-- ciphertext memang terbaca olehnya (grant kolom tidak dapat dibedakan per
-- policy), dan itu tidak berbahaya: tanpa DEK platform, byte itu tidak berarti
-- apa pun. Justru itu gunanya enkripsi.
--
-- Aturan penulisan: ASCII murni.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- GUC sesi
-- Pembaca app.support_session_id. Nilai kosong atau tidak diset menjadi NULL,
-- dan NULL membuat setiap perbandingan `id = app_support_session_id()` bernilai
-- NULL - yaitu NOL BARIS, bukan semua baris. Fail-closed dengan cara yang sama
-- seperti app_context_kind() (0018): lupa menetapkan GUC tidak membuka apa pun.
CREATE OR REPLACE FUNCTION app_support_session_id() RETURNS UUID
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.support_session_id', true), '')::uuid $$;

REVOKE ALL ON FUNCTION app_support_session_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_support_session_id() TO app_user, app_auth_definer;

-- ------------------------------------------------------------- purpose kunci
-- Allowlist purpose kunci ada sebagai CHECK di crypto_keys (0011), jadi purpose
-- baru harus disebut di sini - dan itu memang yang diinginkan: kunci baru adalah
-- keputusan yang terlihat di migrasi, bukan nilai yang muncul karena kode
-- menuliskannya. Seed membuat kuncinya (PLATFORM_PURPOSES di key-ring.ts).
ALTER TABLE crypto_keys DROP CONSTRAINT crypto_keys_purpose_ck;
ALTER TABLE crypto_keys ADD CONSTRAINT crypto_keys_purpose_ck CHECK (purpose IN (
  'platform_identity', 'platform_identity_blind_index', 'platform_audit_identifier',
  'platform_support_reason',
  'identity', 'identity_blind_index'));

-- ---------------------------------------------------------------- tabel
CREATE TABLE support_sessions (
  id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               UUID        NOT NULL REFERENCES tenants (id),
  superadmin_user_id      UUID        NOT NULL REFERENCES users (id),
  -- Sesi support MENGGANTUNG pada session PLATFORM yang membukanya. Inilah cara
  -- ADR-003 sec.2.6 butir 5 ("logout PLATFORM mengakhiri support session")
  -- ditegakkan tanpa kode tambahan: token support membawa session id platform,
  -- dan guard menolaknya begitu baris session itu dicabut. Kolom ini membuat
  -- hubungan itu tercatat, bukan hanya tersirat di dalam klaim token.
  platform_session_id     UUID        NOT NULL REFERENCES sessions (id),
  scope                   VARCHAR(12) NOT NULL,
  reason_code             VARCHAR(48) NOT NULL,
  reason_text_ciphertext  BYTEA       NOT NULL,
  reason_text_key_version INTEGER     NOT NULL,
  ticket_reference        VARCHAR(64),
  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at              TIMESTAMPTZ NOT NULL,
  ended_at                TIMESTAMPTZ,
  ended_by                UUID        REFERENCES users (id),
  end_reason              VARCHAR(24),
  status                  VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT support_sessions_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT support_sessions_scope_ck  CHECK (scope IN ('READ_ONLY', 'READ_WRITE')),
  CONSTRAINT support_sessions_status_ck
    CHECK (status IN ('ACTIVE', 'ENDED', 'EXPIRED', 'REVOKED')),
  -- Allowlist alasan. Daftar ini ADALAH kontrak: menambah alasan berarti
  -- migrasi, bukan nilai baru yang diketik pemanggil.
  CONSTRAINT support_sessions_reason_code_ck
    CHECK (reason_code IN ('TENANT_REPORTED_BUG', 'DATA_INVESTIGATION',
                           'SECURITY_INCIDENT', 'DATA_CORRECTION_REQUESTED_BY_TENANT')),
  -- ADR-003 sec.2.2 butir 1: READ_WRITE hanya untuk alasan yang mengizinkan
  -- perubahan. Dijaga di sini supaya bukan hanya aturan aplikasi - permission
  -- platform.support.start_write saja tidak cukup.
  CONSTRAINT support_sessions_write_reason_ck
    CHECK (scope = 'READ_ONLY' OR reason_code = 'DATA_CORRECTION_REQUESTED_BY_TENANT'),
  -- Butir 5: maksimal 60 menit, dan tidak dapat diperpanjang (tidak ada policy
  -- UPDATE yang mengizinkan expires_at berubah).
  CONSTRAINT support_sessions_duration_ck
    CHECK (expires_at > started_at AND expires_at <= started_at + interval '60 minutes'),
  CONSTRAINT support_sessions_end_ck
    CHECK ((status = 'ACTIVE') = (ended_at IS NULL)),
  CONSTRAINT support_sessions_end_reason_ck
    CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CONSTRAINT support_sessions_end_reason_value_ck
    CHECK (end_reason IS NULL
           OR end_reason IN ('MANUAL', 'EXPIRED', 'PLATFORM_LOGOUT', 'REVOKED')),
  CONSTRAINT support_sessions_ended_by_ck
    CHECK (ended_by IS NULL OR ended_at IS NOT NULL),
  -- Pelajaran D-26: kolom teks bebas yang TIDAK dienkripsi bukan tempat data
  -- pribadi. reason_text dienkripsi, jadi tidak diatur di sini; nomor tiket
  -- tidak, jadi alamat email ditolak. Deretan angka justru sah (nomor tiket).
  CONSTRAINT support_sessions_ticket_ck
    CHECK (ticket_reference IS NULL OR ticket_reference !~ '@')
);

-- Butir 6: satu sesi AKTIF per superadmin. Riwayat boleh sepanjang apa pun.
CREATE UNIQUE INDEX support_sessions_one_active_uq
  ON support_sessions (superadmin_user_id) WHERE status = 'ACTIVE';

CREATE INDEX support_sessions_tenant_idx
  ON support_sessions (tenant_id, started_at DESC);
CREATE INDEX support_sessions_platform_session_idx
  ON support_sessions (platform_session_id) WHERE status = 'ACTIVE';

ALTER TABLE support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_sessions FORCE  ROW LEVEL SECURITY;

-- Tabel ini dibaca dari TIGA context yang berbeda, dan masing-masing melihat hal
-- yang berbeda (ADR-003 sec.2.4). Yang membedakan bukan kode aplikasi melainkan
-- policy di bawah.
GRANT SELECT ON support_sessions TO app_user;
GRANT INSERT (id, tenant_id, superadmin_user_id, platform_session_id, scope,
              reason_code, reason_text_ciphertext, reason_text_key_version,
              ticket_reference, expires_at)
  ON support_sessions TO app_user;
-- Yang dapat diubah hanya PENGAKHIRAN. expires_at tidak ada di daftar ini, jadi
-- "perpanjang sesi" bukan sesuatu yang perlu ditolak kode - ia tidak dapat
-- ditulis sama sekali.
GRANT UPDATE (status, ended_at, ended_by, end_reason) ON support_sessions TO app_user;

-- Context platform: seluruh baris. Superadmin memang berhak melihat daftar sesi
-- support platform, termasuk milik superadmin lain - itu bagian dari saling
-- mengawasi (ADR-003 sec.2.5 "review daftar berkala").
CREATE POLICY platform_read ON support_sessions FOR SELECT TO app_user
  USING (app_context_kind() = 'platform');
CREATE POLICY platform_insert ON support_sessions FOR INSERT TO app_user
  WITH CHECK (app_context_kind() = 'platform' AND status = 'ACTIVE' AND ended_at IS NULL);
-- Satu arah: aktif -> berakhir. Sesi yang sudah berakhir tidak dapat dihidupkan,
-- sehingga jejaknya tidak dapat dibersihkan dengan "membuka ulang" sesi lama.
CREATE POLICY platform_update ON support_sessions FOR UPDATE TO app_user
  USING      (app_context_kind() = 'platform' AND status = 'ACTIVE')
  WITH CHECK (app_context_kind() = 'platform' AND status <> 'ACTIVE');

-- Context tenant: baris tenant ini saja. Syarat permission audit.read ditegakkan
-- guard aplikasi - RLS tidak mengetahui membership pemanggil, hanya tenantnya
-- (pola yang sama dengan tenant_notifications di 0019).
CREATE POLICY tenant_read ON support_sessions FOR SELECT TO app_user
  USING (app_context_kind() = 'tenant' AND tenant_id = app_current_tenant());

-- Context support: HANYA barisnya sendiri. Sesi support tidak boleh menjadi cara
-- membaca daftar sesi support tenant lain, dan juga tidak perlu melihat sesi lain
-- di tenant yang sama.
CREATE POLICY support_read ON support_sessions FOR SELECT TO app_user
  USING (app_context_kind() = 'support'
         AND tenant_id = app_current_tenant()
         AND id = app_support_session_id());

-- Lampiran A F-18 dan F-19 berjalan sebelum context ada (guard) atau di luar
-- context platform (logout), jadi tidak dapat memakai policy app_user di atas.
GRANT SELECT (id, tenant_id, superadmin_user_id, platform_session_id, scope,
              status, expires_at)
  ON support_sessions TO app_auth_definer;
GRANT UPDATE (status, ended_at, end_reason) ON support_sessions TO app_auth_definer;

-- USING (true), bukan "hanya yang ACTIVE", dan sebabnya bukan kemalasan: F-19
-- memakai UPDATE ... RETURNING, dan PostgreSQL menuntut baris HASIL update lolos
-- policy SELECT juga. Baris hasilnya sudah berstatus ENDED, sehingga policy baca
-- yang hanya menerima ACTIVE membuat F-19 gagal dengan pesan yang menunjuk ke
-- tempat yang salah ("new row violates row-level security policy").
--
-- Yang menjaga fail-closed karena itu adalah WHERE di dalam F-18 sendiri
-- (status ACTIVE dan belum kedaluwarsa), dan kasus SQL slice 14 #8 ada untuk
-- membuktikan penjaga itu hidup - bukan policy ini.
CREATE POLICY definer_read ON support_sessions FOR SELECT TO app_auth_definer
  USING (true);
CREATE POLICY definer_update ON support_sessions FOR UPDATE TO app_auth_definer
  USING      (status = 'ACTIVE')
  WITH CHECK (status <> 'ACTIVE');

-- ------------------------------------------------------- tenants di platform
-- Context platform kini dapat membaca tabel `tenants`. Ini pelebaran yang
-- disengaja dan dibatasi:
--
--   * `tenants` adalah tabel CONTROL-PLANE (Demo Foundation sec.7.2), bukan data
--     tenant. ADR-003 sec.2.1 memang memberi superadmin `platform.tenants.read`;
--   * tanpa ini, aturan "tenant yang tidak ACTIVE hanya READ_ONLY" (sec.2.2 butir
--     10) tidak dapat ditegakkan sama sekali - status tenant tidak terbaca dari
--     context platform, dan aturan yang tidak dapat dibaca tidak dapat dijalankan;
--   * yang TIDAK ikut terbuka: seluruh tabel tenant-owned. Policy mereka menuntut
--     tenant_id = app_current_tenant(), dan context platform tidak punya tenant.
--     Itulah yang membuat support session tetap satu-satunya jalan ke data tenant.
CREATE POLICY platform_read ON tenants FOR SELECT TO app_user
  USING (app_context_kind() = 'platform');

-- ------------------------------------------------------- janji migrasi 0019
-- 0019 menyatakan kolom ini akan menjadi FOREIGN KEY saat support_sessions ada.
-- Dibayar di sini, dan sebagai composite (tenant_id, ref_id): notifikasi sebuah
-- tenant hanya dapat menunjuk sesi support MILIK TENANT ITU. Pemeriksaan
-- referential integrity berjalan di luar RLS, jadi FK ini tetap bekerja walau
-- penulisnya (F-15) tidak punya hak baca atas support_sessions.
ALTER TABLE tenant_notifications
  ADD CONSTRAINT tenant_notifications_ref_fk
  FOREIGN KEY (tenant_id, ref_id) REFERENCES support_sessions (tenant_id, id);

-- ---------------------------------------------------------------- F-18
-- Validasi sesi pada SETIAP request (ADR-003 sec.2.3 butir terakhir), bukan
-- hanya saat token diterbitkan. Berjalan di guard, sebelum context apa pun
-- ditetapkan - karena itu fungsi definer, bukan query biasa.
--
-- Fail-closed: hanya sesi ACTIVE yang belum kedaluwarsa yang menghasilkan baris.
-- Sesi yang dicabut, berakhir, atau habis waktunya menghasilkan NOL baris, dan
-- guard menerjemahkan nol baris menjadi penolakan. Tidak ada cabang "mungkin
-- masih berlaku".
--
-- `remaining_seconds` dihitung DI DATABASE dan dikembalikan sebagai bilangan
-- bulat. Sebabnya ditemukan di mesin target: umur token support pernah dihitung
-- di aplikasi dari `expires_at` hasil query mentah, dan Prisma membaca
-- `timestamptz` sebagai jam dinding sesi database lalu melabelinya UTC - di mesin
-- dengan TimeZone bukan UTC nilainya bergeser sebesar offset (terukur +7 jam).
-- Unit of work kini memaksa TimeZone UTC, sehingga pergeseran itu tidak lagi
-- terjadi; kolom ini adalah lapis kedua: durasi tidak pernah diturunkan dari teks
-- waktu yang perlu ditafsirkan siapa pun.
CREATE FUNCTION auth.find_support_session(p_id UUID)
RETURNS TABLE (
  id                 UUID,
  tenant_id          UUID,
  superadmin_user_id UUID,
  platform_session_id UUID,
  scope              VARCHAR,
  expires_at         TIMESTAMPTZ,
  remaining_seconds  INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.tenant_id, s.superadmin_user_id, s.platform_session_id,
         s.scope, s.expires_at,
         greatest(1, extract(epoch FROM (s.expires_at - now()))::int) AS remaining_seconds
  FROM support_sessions s
  WHERE s.id = p_id
    AND s.status = 'ACTIVE'
    AND s.expires_at > now();
$$;

ALTER FUNCTION auth.find_support_session(UUID) OWNER TO app_auth_definer;
REVOKE ALL ON FUNCTION auth.find_support_session(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.find_support_session(UUID) TO app_user;

-- ---------------------------------------------------------------- F-19
-- Logout (atau pencabutan) session PLATFORM mengakhiri sesi support yang
-- digantungkan padanya - ADR-003 sec.2.6 butir 5.
--
-- Kenapa fungsi definer dan bukan query di service: logout berjalan di jalur
-- pre-context (tanpa tenant, context 'tenant'), sehingga policy platform di atas
-- tidak berlaku. Memberi jalur logout hak context platform justru memperluas
-- permukaan; satu fungsi sempit dengan tugas tunggal lebih mudah dijaga.
--
-- Mengembalikan baris yang benar-benar diakhiri, supaya pemanggil dapat menulis
-- audit dan notifikasi tenant untuk masing-masing. Tanpa itu, sesi berakhir
-- tanpa tenant pernah tahu - dan transparansi adalah alasan break-glass dapat
-- diterima.
CREATE FUNCTION auth.end_support_sessions_for_platform_session(p_platform_session_id UUID)
RETURNS TABLE (support_session_id UUID, tenant_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE support_sessions s
  SET status = 'ENDED', ended_at = now(), end_reason = 'PLATFORM_LOGOUT'
  WHERE s.platform_session_id = p_platform_session_id
    AND s.status = 'ACTIVE'
  RETURNING s.id, s.tenant_id;
$$;

ALTER FUNCTION auth.end_support_sessions_for_platform_session(UUID) OWNER TO app_auth_definer;
REVOKE ALL ON FUNCTION auth.end_support_sessions_for_platform_session(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.end_support_sessions_for_platform_session(UUID) TO app_user;

COMMENT ON TABLE support_sessions IS
  'Support session break-glass (ADR-003 sec.2.2). Satu-satunya jalan platform menyentuh data tenant.';
COMMENT ON COLUMN support_sessions.platform_session_id IS
  'Session PLATFORM yang membuka sesi ini; logout session itu mengakhiri sesi support (F-19).';
COMMENT ON COLUMN support_sessions.reason_text_ciphertext IS
  'Alasan bebas, dienkripsi dengan DEK PLATFORM purpose platform_support_reason (bukan DEK tenant).';
