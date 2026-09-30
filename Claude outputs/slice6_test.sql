-- slice6_test.sql
-- Dijalankan SEBAGAI app_user.
--
-- Menguji sifat audit yang harus ditegakkan database: append-only, tidak memuat
-- data pribadi, dan hanya terlihat oleh tenant pemiliknya.

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
  alpha CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  beta  CONSTANT UUID := '22222222-2222-2222-2222-222222222222';
  multi CONSTANT UUID := 'cccccccc-0000-0000-0000-000000000001';
  h     CONSTANT BYTEA := sha256('identifier-uji'::bytea);
  n     INTEGER;
  v_id  UUID;
  ok    BOOLEAN;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);

  ----------------------------------------------------------------- 1
  -- Kejadian pre-context dapat dicatat tanpa tenant dan tanpa pelaku.
  -- Inilah kasus login gagal: belum tahu tenant, belum tahu siapa.
  v_id := auth.write_audit_event('auth.login', 'FAILURE', NULL, NULL, NULL, h);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: audit pre-context tidak tercatat';
  END IF;

  ----------------------------------------------------------------- 2
  -- Penghitung percobaan gagal membaca kejadian itu.
  IF (auth.count_recent_failures(h, 300) >= 1) IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: percobaan gagal tidak terhitung';
  END IF;

  ----------------------------------------------------------------- 3
  -- Hitungan terikat per identitas, bukan global.
  --
  -- Kalau sifat ini hilang, satu penyerang dapat mengunci SELURUH pengguna
  -- hanya dengan menghantam satu alamat yang tidak ada.
  DECLARE
    h_lain CONSTANT BYTEA := sha256('identifier-lain'::bytea);
  BEGIN
    n := auth.count_recent_failures(h, 300);
    PERFORM auth.write_audit_event('auth.login', 'FAILURE', NULL, NULL, NULL, h_lain);
    PERFORM auth.write_audit_event('auth.login', 'FAILURE', NULL, NULL, NULL, h_lain);
    IF auth.count_recent_failures(h, 300) IS DISTINCT FROM n THEN
      RAISE EXCEPTION 'KASUS 3 GAGAL: kegagalan identitas lain ikut terhitung';
    END IF;
    IF auth.count_recent_failures(h_lain, 300) IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'KASUS 3 GAGAL: kegagalan identitas lain tidak terhitung pada dirinya';
    END IF;
  END;

  ----------------------------------------------------------------- 4
  -- PENJAGA DATA PRIBADI: detail yang memuat email ditolak.
  ok := FALSE;
  BEGIN
    PERFORM auth.write_audit_event('auth.login', 'FAILURE', NULL, NULL, NULL, h,
                                   NULL, NULL, '{"email":"a@b.c"}'::jsonb);
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: detail berisi email diterima';
  END IF;

  ok := FALSE;
  BEGIN
    PERFORM auth.write_audit_event('auth.login', 'FAILURE', NULL, NULL, NULL, h,
                                   NULL, NULL, '{"token":"rahasia"}'::jsonb);
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: detail berisi token diterima';
  END IF;

  ----------------------------------------------------------------- 5
  -- APPEND-ONLY: app_user tidak dapat mengubah audit.
  ok := FALSE;
  BEGIN
    EXECUTE 'UPDATE audit_logs SET outcome = ''SUCCESS''';
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: app_user dapat mengubah audit';
  END IF;

  ok := FALSE;
  BEGIN
    EXECUTE 'DELETE FROM audit_logs';
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: app_user dapat menghapus audit';
  END IF;

  ----------------------------------------------------------------- 6
  -- app_user juga tidak dapat menulis audit langsung; hanya lewat F-14.
  ok := FALSE;
  BEGIN
    EXECUTE 'INSERT INTO audit_logs (event_type, outcome) VALUES (''palsu'', ''SUCCESS'')';
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: app_user dapat menulis audit langsung';
  END IF;

  ----------------------------------------------------------------- 7
  -- Audit tenant lain tidak terlihat, sama seperti data tenant lainnya.
  -- Kedua baris ditulis di sini, tidak mengandalkan efek samping kasus lain:
  -- tes yang bergantung pada urutan akan rusak begitu satu kasus diubah.
  PERFORM auth.write_audit_event('auth.login', 'SUCCESS', alpha, multi, NULL, NULL);
  PERFORM auth.write_audit_event('auth.login', 'SUCCESS', beta, multi, NULL, NULL);

  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM audit_logs WHERE tenant_id = beta;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: audit tenant lain terbaca';
  END IF;

  SELECT count(*) INTO n FROM audit_logs;
  IF n = 0 THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: audit tenant sendiri tidak terbaca';
  END IF;

  ----------------------------------------------------------------- 8
  -- Baris pre-context (tenant_id NULL) tidak terlihat app_user mana pun.
  -- Baris itu memang bukan milik tenant siapa pun.
  SELECT count(*) INTO n FROM audit_logs WHERE tenant_id IS NULL;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: audit pre-context terlihat oleh tenant';
  END IF;

  ----------------------------------------------------------------- 9
  -- Keberhasilan menihilkan hitungan kegagalan sebelumnya.
  PERFORM set_config('app.current_tenant_id', '', true);
  DECLARE
    h2 CONSTANT BYTEA := sha256('identifier-reset'::bytea);
  BEGIN
    PERFORM auth.write_audit_event('auth.login', 'FAILURE', NULL, NULL, NULL, h2);
    PERFORM auth.write_audit_event('auth.login', 'FAILURE', NULL, NULL, NULL, h2);
    IF auth.count_recent_failures(h2, 300) IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'KASUS 9 GAGAL: dua kegagalan tidak terhitung';
    END IF;

    PERFORM auth.write_audit_event('auth.login', 'SUCCESS', alpha, multi, NULL, h2);
    IF auth.count_recent_failures(h2, 300) IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'KASUS 9 GAGAL: keberhasilan tidak menihilkan hitungan';
    END IF;

    PERFORM auth.write_audit_event('auth.login', 'FAILURE', NULL, NULL, NULL, h2);
    IF auth.count_recent_failures(h2, 300) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'KASUS 9 GAGAL: kegagalan setelah keberhasilan tidak terhitung';
    END IF;
  END;

  ----------------------------------------------------------------- 10
  -- D-30: nama event audit di luar katalog ditolak DATABASE, bukan sekadar
  -- daftar di dalam satu fungsi. Nama yang salah ketik tidak boleh tersimpan:
  -- penulisan audit sengaja tidak menggagalkan operasi yang diauditnya, jadi
  -- baris yang hilang tidak akan terlihat siapa pun.
  PERFORM set_config('app.current_tenant_id', '', true);
  ok := FALSE;
  BEGIN
    PERFORM auth.write_audit_event('auth.login.gagal', 'FAILURE', NULL, NULL, NULL, h);
  EXCEPTION WHEN foreign_key_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 10 GAGAL: nama event di luar katalog tercatat';
  END IF;

  -- Katalognya sendiri terbaca seluruhnya, tetapi tidak dapat ditulis tenant:
  -- menambah nama event adalah migrasi, sama seperti katalog permission.
  SELECT count(*) INTO n FROM audit_event_types;
  IF n IS DISTINCT FROM 37 THEN
    RAISE EXCEPTION 'KASUS 10 GAGAL: katalog berisi % nama, harus 37', n;
  END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO audit_event_types (code, description) VALUES ('auth.login.gagal', 'x');
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 10 GAGAL: tenant dapat menambah nama event';
  END IF;

  RAISE NOTICE 'SEMUA 10 KASUS SLICE 6 LULUS';
END
$$;

ROLLBACK;
