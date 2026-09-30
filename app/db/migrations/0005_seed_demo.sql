-- 0005_seed_demo.sql
-- Dijalankan sebagai SUPERUSER.
--
-- Alasan superuser: seluruh tabel memakai FORCE ROW LEVEL SECURITY, sehingga
-- app_owner pun tunduk pada policy. Provisioning demo memang jalur istimewa -
-- Demo Foundation menyebutnya "provisioning service khusus demo, bukan API tenant".
-- Jangan pernah memakai jalur ini dari kode aplikasi.
--
-- Sejak D-01 (migrasi 0011) berkas ini HANYA membuat tenant. Identitas, kredensial,
-- membership, dan profil dibuat oleh app/api/scripts/seed-demo.ts, karena email
-- dan nama harus dienkripsi di aplikasi SEBELUM menyentuh database - SQL tidak
-- memegang kunci, dan memang tidak boleh.
--
-- Berkas ini tetap berjalan setelah semua migrasi (lihat db.ps1). Isinya tidak
-- bergantung pada kolom yang diubah 0011.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO tenants (id, slug, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'alpha', 'Tenant Alpha'),
  ('22222222-2222-2222-2222-222222222222', 'beta',  'Tenant Beta');

COMMIT;
