-- 0001b_schema_migrations.sql
-- Dijalankan sebagai app_owner, dan dijalankan PERTAMA sesudah 0001_roles.sql.
--
-- Ledger migrasi: daftar migrasi yang SUDAH dipasang di database ini.
--
-- SEBABNYA, dan kenapa berkas ini bernomor 0001b: sampai hari ini satu-satunya cara
-- memasang perubahan skema adalah `reset` - hapus database, bangun dari nol. Untuk
-- demo itu cukup. Untuk database yang berisi data sungguhan itu bukan kekurangan
-- fitur melainkan jalan buntu, dan begitu baseline ini menjadi skema yang DIPASANG
-- ke database tiap produk (bukan satu aplikasi tunggal), ledger adalah prasyarat:
-- tanpanya tidak ada yang tahu migrasi mana yang sudah berjalan di sana.
--
-- Nomor "0001b" dipilih supaya berkas ini berada di antara 0001 (peran, dijalankan
-- superuser) dan 0002, sehingga urutan abjad = urutan jalan, dan pemasang tidak perlu
-- memberi perlakuan khusus pada berkas ini.
--
-- EMPAT KEPUTUSAN:
--
-- 1. `component` ada sejak awal, bukan ditambahkan kelak. Satu database produk memuat
--    migrasi BASELINE dan migrasi produk itu sendiri; keduanya punya urutan nomor
--    masing-masing dan tidak boleh berebut. Primary key (component, version).
--
-- 2. `checksum` disimpan, dan pemasang WAJIB memeriksanya untuk migrasi yang sudah
--    dipasang. Berkas migrasi yang diedit setelah dipasang adalah kelas cacat yang
--    paling sulit dilacak: dua database mengaku berada di versi yang sama padahal
--    isinya berbeda. Di sini ia berubah menjadi kegagalan yang berisik.
--
-- 3. `app_user` TIDAK punya grant apa pun (bahkan SELECT). Runtime tidak punya urusan
--    dengan ledger, dan tabel tanpa grant adalah pernyataan yang lebih keras daripada
--    policy.
--
-- 4. TANPA RLS, dan itu disengaja: tabel ini tidak memuat data tenant, dan `FORCE ROW
--    LEVEL SECURITY` berlaku juga bagi pemiliknya - yang justru satu-satunya penulis
--    tabel ini (pemasang berjalan sebagai app_owner). RLS di sini hanya akan mengunci
--    pemiliknya sendiri tanpa melindungi siapa pun.
--
-- Aturan penulisan: ASCII murni.

\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS schema_migrations (
  component  VARCHAR(40)  NOT NULL DEFAULT 'baseline',
  version    VARCHAR(20)  NOT NULL,
  filename   VARCHAR(120) NOT NULL,
  checksum   CHAR(64)     NOT NULL,   -- sha256 hex dari isi berkas
  applied_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  applied_by NAME         NOT NULL DEFAULT current_user,
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (component, version),
  CONSTRAINT schema_migrations_component_ck CHECK (component ~ '^[a-z][a-z0-9_-]*$'),
  CONSTRAINT schema_migrations_version_ck   CHECK (version ~ '^[0-9]{4}[a-z]?$'),
  CONSTRAINT schema_migrations_checksum_ck  CHECK (checksum ~ '^[0-9a-f]{64}$')
);

REVOKE ALL ON schema_migrations FROM PUBLIC;

COMMENT ON TABLE schema_migrations IS
  'Ledger migrasi per komponen. Ditulis pemasang (api/scripts/migrate.ts), tidak pernah oleh runtime.';
COMMENT ON COLUMN schema_migrations.component IS
  'baseline, atau nama produk yang memasang migrasinya sendiri di database yang sama.';
COMMENT ON COLUMN schema_migrations.checksum IS
  'sha256 isi berkas saat dipasang. Berbeda = berkas migrasi diedit setelah dipasang.';
