-- 0017_role_name_guard.sql
-- Dijalankan sebagai app_owner.
--
-- D-26 (keputusan pemilik proyek 2026-09-23): nama role adalah LABEL konfigurasi,
-- bukan tempat data pribadi.
--
-- Kenapa perlu penjaga, bukan sekadar catatan di dokumen: sejak slice 12 nama
-- role diketik tenant lewat layar, dan kolom ini tidak dienkripsi, tidak
-- di-masking, serta tampil di daftar anggota. Tenant yang mengetik "Budi
-- Santoso" atau "budi@contoh.co.id" di sana memasukkan data pribadi ke tempat
-- yang tidak dirancang untuknya - dan dokumen tidak pernah menghentikan siapa pun.
--
-- Yang ditolak sengaja SEMPIT: hanya bentuk yang jelas identitas, bukan tebakan
-- "ini nama orang atau bukan". Nama orang biasa tidak dapat dibedakan dari nama
-- jabatan oleh regex mana pun, dan aturan yang menebak akan menolak "Manajer
-- Gudang Budi" sambil meloloskan hal lain. Karena itu penjaga ini menolak dua
-- hal yang pasti salah tempat, dan sisanya dijaga peringatan di layar:
--
--   1. alamat email (mengandung '@');
--   2. deretan 8 digit atau lebih - NIK, nomor telepon, nomor KK, NPWP.
--
-- Penjaga di tabel, bukan hanya di aplikasi: seed, migrasi, dan skrip apa pun
-- menulis lewat jalur yang sama (pola yang sama dengan katalog event audit,
-- migrasi 0016). API tetap menolak lebih dulu dengan pesan yang dapat dibaca.
-- Aturan penulisan: ASCII murni.

\set ON_ERROR_STOP on

ALTER TABLE roles
  ADD CONSTRAINT roles_name_label_ck
  CHECK (name !~ '@' AND name !~ '[0-9]{8}');

COMMENT ON COLUMN roles.name IS
  'Label role untuk tampilan. Bukan tempat data pribadi: email dan deretan 8+ digit ditolak (D-26).';
