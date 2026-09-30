-- 0015_owner_guard.sql
-- Dijalankan sebagai app_owner.
--
-- D-28 (keputusan pemilik proyek 2026-09-22): permission penanda owner.
--
-- owners.manage tidak membuka endpoint apa pun. Gunanya sebagai penanda: hanya
-- role tenant_owner yang memegangnya, sehingga aturan anti-eskalasi yang sudah
-- ada (pelaku hanya boleh memberi, mencabut, atau menangguhkan dalam jangkauan
-- permission-nya sendiri) otomatis melarang tenant_admin memberi role owner,
-- mencabutnya, atau menangguhkan pemegangnya. Tidak ada mekanisme baru, dan
-- keputusan akses tetap atas kode permission, bukan nama role.
--
-- Bundel role seed ditentukan seed-demo (tenant_owner = seluruh katalog tenant),
-- jadi setelah migrasi ini seed WAJIB dijalankan ulang (db reset).
-- Aturan penulisan: ASCII murni.

\set ON_ERROR_STOP on

-- permissions ber-FORCE RLS tanpa policy tulis untuk siapa pun, termasuk
-- pemiliknya (0013). Menambah katalog = melepas FORCE sesaat DI DALAM satu
-- transaksi, lalu memasangnya kembali; DDL PostgreSQL transaksional, jadi tidak
-- ada saat yang teramati dengan FORCE terlepas. Tidak ada policy tulis permanen.
BEGIN;
ALTER TABLE permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO permissions (code, scope, description) VALUES
  ('owners.manage', 'TENANT', 'Penanda owner: mengelola role owner dan pemegangnya');
ALTER TABLE permissions FORCE ROW LEVEL SECURITY;
COMMIT;
