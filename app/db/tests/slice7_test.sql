-- slice7_test.sql
-- Dijalankan SEBAGAI app_user.
--
-- Menguji rotasi refresh token dan deteksi pemakaian ulang pada lapisan database.
-- Sifat-sifat ini ditegakkan di sini supaya tetap berlaku walau kode aplikasi
-- ditulis ulang.

\set ON_ERROR_STOP on
\timing off

-- Seluruh berkas berjalan dalam SATU transaksi yang di-ROLLBACK di akhir.
-- Tanpa ini, setiap run meninggalkan tiket, hash, dan hitungan kegagalan, lalu
-- run berikutnya bertabrakan dengan sisa itu: tiga dari empat berkas tes gagal
-- bila dijalankan dua kali tanpa reset (ditemukan audit tes 2026-09-21).
-- Tes yang hasilnya bergantung pada apa yang tersisa di database bukan tes.
BEGIN;

-- Setiap pemeriksaan ditulis tahan NULL: IS DISTINCT FROM, IS NOT TRUE, IS NOT FALSE.
-- `IF x <> y` diam-diam lulus saat x NULL, karena NULL <> y bukan TRUE. Fungsi yang
-- rusak dan tidak mengembalikan baris menghasilkan NULL - persis kerusakan yang
-- harus ditangkap (ditemukan audit tes 2026-09-21).

DO $$
DECLARE
  alpha   CONSTANT UUID  := '11111111-1111-1111-1111-111111111111';
  multi   CONSTANT UUID  := 'cccccccc-0000-0000-0000-000000000001';
  m_alpha CONSTANT UUID  := 'a1a1a1a1-0000-0000-0000-000000000003';
  h1      CONSTANT BYTEA := sha256('refresh-1'::bytea);
  h2      CONSTANT BYTEA := sha256('refresh-2'::bytea);
  h3      CONSTANT BYTEA := sha256('refresh-3'::bytea);
  h4      CONSTANT BYTEA := sha256('refresh-4'::bytea);
  v_session UUID;
  v_family  UUID;
  n         INTEGER;
  r         RECORD;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);

  v_session := auth.create_session('TENANT', multi, alpha, m_alpha, 60);

  ----------------------------------------------------------------- 1
  -- Token pertama terbit beserta family-nya.
  SELECT * INTO r FROM auth.create_refresh_token(v_session, alpha, 'TENANT', h1);
  IF r.token_id IS NULL OR r.family_id IS NULL THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: refresh token pertama tidak terbit';
  END IF;
  v_family := r.family_id;

  ----------------------------------------------------------------- 2
  -- Rotasi berhasil dan mengembalikan session yang sama.
  SELECT * INTO r FROM auth.rotate_refresh_token(h1, h2);
  IF r.status IS DISTINCT FROM 'ROTATED' THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: status rotasi = %', r.status;
  END IF;
  IF r.session_id IS DISTINCT FROM v_session THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: session berubah saat rotasi';
  END IF;
  IF r.family_id IS DISTINCT FROM v_family THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: family berubah saat rotasi';
  END IF;

  ----------------------------------------------------------------- 3
  -- Token baru dapat dirotasi lagi: rantai berlanjut.
  SELECT * INTO r FROM auth.rotate_refresh_token(h2, h3);
  IF r.status IS DISTINCT FROM 'ROTATED' THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: rotasi kedua ditolak (%)', r.status;
  END IF;

  ----------------------------------------------------------------- 4
  -- DETEKSI PEMAKAIAN ULANG: token lama dipakai lagi.
  SELECT * INTO r FROM auth.rotate_refresh_token(h1, h4);
  IF r.status IS DISTINCT FROM 'REUSE' THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: pemakaian ulang tidak terdeteksi (%)', r.status;
  END IF;

  ----------------------------------------------------------------- 5
  -- Akibatnya seluruh family dicabut, termasuk token yang tadinya sah.
  SELECT * INTO r FROM auth.rotate_refresh_token(h3, h4);
  IF r.status IS DISTINCT FROM 'REUSE' THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: token sah dalam family tercabut masih diterima (%)', r.status;
  END IF;

  ----------------------------------------------------------------- 6
  -- Session-nya ikut mati. Mencabut token saja tidak cukup: access token yang
  -- sudah terbit akan tetap berlaku sampai kedaluwarsa kalau session dibiarkan.
  SELECT count(*) INTO n FROM auth.find_session(v_session);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: session masih hidup setelah pemakaian ulang';
  END IF;

  ----------------------------------------------------------------- 7
  -- Hash yang tidak dikenal ditolak sebagai INVALID, bukan REUSE.
  -- Membedakan keduanya penting: REUSE memicu pencabutan, INVALID tidak boleh.
  SELECT * INTO r FROM auth.rotate_refresh_token(sha256('tidak-pernah-ada'::bytea), h4);
  IF r.status IS DISTINCT FROM 'INVALID' THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: hash asing menghasilkan % (harusnya INVALID)', r.status;
  END IF;

  ----------------------------------------------------------------- 8
  -- Token kedaluwarsa ditolak EXPIRED, dan tidak dianggap pemakaian ulang.
  DECLARE
    s2 UUID;
    h5 CONSTANT BYTEA := sha256('refresh-5'::bytea);
    h6 CONSTANT BYTEA := sha256('refresh-6'::bytea);
  BEGIN
    s2 := auth.create_session('TENANT', multi, alpha, m_alpha, 60);
    PERFORM auth.create_refresh_token(s2, alpha, 'TENANT', h5, 1);
    PERFORM pg_sleep(1.1);

    SELECT * INTO r FROM auth.rotate_refresh_token(h5, h6);
    IF r.status IS DISTINCT FROM 'EXPIRED' THEN
      RAISE EXCEPTION 'KASUS 8 GAGAL: token kedaluwarsa menghasilkan %', r.status;
    END IF;
  END;

  ----------------------------------------------------------------- 9
  -- app_user tidak dapat menyentuh tabel refresh token secara langsung
  -- di luar tenant aktifnya, dan tidak dapat memalsukan rotasi.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM refresh_tokens;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 9 GAGAL: refresh token terbaca tanpa tenant context';
  END IF;

  ----------------------------------------------------------------- 10
  -- Refresh token yang sah tidak menghidupkan session yang sudah dicabut.
  DECLARE
    s3 UUID;
    h7 CONSTANT BYTEA := sha256('refresh-7'::bytea);
    h8 CONSTANT BYTEA := sha256('refresh-8'::bytea);
  BEGIN
    s3 := auth.create_session('TENANT', multi, alpha, m_alpha, 60);
    PERFORM auth.create_refresh_token(s3, alpha, 'TENANT', h7);
    PERFORM auth.revoke_session(s3, 'LOGOUT');

    SELECT * INTO r FROM auth.rotate_refresh_token(h7, h8);
    IF r.status IS DISTINCT FROM 'SESSION_GONE' THEN
      RAISE EXCEPTION 'KASUS 10 GAGAL: rotasi atas session tercabut menghasilkan %', r.status;
    END IF;
  END;

  RAISE NOTICE 'SEMUA 10 KASUS SLICE 7 LULUS';
END
$$;

ROLLBACK;
