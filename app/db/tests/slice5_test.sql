-- slice5_test.sql
-- Dijalankan SEBAGAI app_user.
--
-- Menguji sifat tiket pemilihan context dan pencabutan session pada lapisan
-- database - bukan pada lapisan aplikasi. Sifat yang dijaga database tidak bisa
-- dilupakan kode, dan tidak hilang kalau nanti API ditulis ulang.

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
  alpha  CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  beta   CONSTANT UUID := '22222222-2222-2222-2222-222222222222';
  multi  CONSTANT UUID := 'cccccccc-0000-0000-0000-000000000001';
  solo   CONSTANT UUID := 'bbbbbbbb-0000-0000-0000-000000000001';  -- hanya Beta
  h1     CONSTANT BYTEA := sha256('tiket-satu'::bytea);
  h2     CONSTANT BYTEA := sha256('tiket-dua'::bytea);
  h3     CONSTANT BYTEA := sha256('tiket-tiga'::bytea);
  n          INTEGER;
  v_uid      UUID;
  v_ticket   UUID;
  v_session  UUID;
  v_member   UUID;
  ok         BOOLEAN;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);

  ----------------------------------------------------------------- 1
  -- Tiket dibuat tanpa tenant context (memang belum ada tenant yang dipilih).
  v_ticket := auth.create_selection_ticket(multi, h1, 300);
  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: tiket tidak terbuat';
  END IF;

  ----------------------------------------------------------------- 2
  -- app_user tidak boleh menyentuh tabel tiket secara langsung.
  ok := FALSE;
  BEGIN
    EXECUTE 'SELECT count(*) FROM auth_selection_tickets';
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: app_user dapat membaca tabel tiket langsung';
  END IF;

  ----------------------------------------------------------------- 3
  -- Konsumsi pertama berhasil dan mengembalikan pemiliknya.
  SELECT t.user_id INTO v_uid FROM auth.consume_selection_ticket(h1) t;
  IF v_uid IS DISTINCT FROM multi THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: konsumsi pertama mengembalikan %', v_uid;
  END IF;

  ----------------------------------------------------------------- 4
  -- SEKALI PAKAI: konsumsi kedua atas tiket yang sama harus kosong.
  SELECT count(*) INTO n FROM auth.consume_selection_ticket(h1);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: tiket dapat dipakai dua kali';
  END IF;

  ----------------------------------------------------------------- 5
  -- Hash yang tidak dikenal tidak mengembalikan apa pun - DAN tidak menyentuh
  -- tiket lain yang masih terbuka.
  --
  -- Tiket sah sengaja dibuka lebih dulu. Tanpanya, fungsi yang mengabaikan hash
  -- sama sekali pun lulus, karena tidak ada tiket terbuka untuk "dicuri"
  -- (dibuktikan audit tes 2026-09-21).
  PERFORM auth.create_selection_ticket(multi, h3, 300);

  SELECT count(*) INTO n FROM auth.consume_selection_ticket(sha256('palsu'::bytea));
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: tiket palsu diterima';
  END IF;

  SELECT t.user_id INTO v_uid FROM auth.consume_selection_ticket(h3) t;
  IF v_uid IS DISTINCT FROM multi THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: tiket sah ikut terpakai oleh hash palsu';
  END IF;

  ----------------------------------------------------------------- 6
  -- TTL dibatasi database, bukan hanya oleh kode pemanggil.
  ok := FALSE;
  BEGIN
    PERFORM auth.create_selection_ticket(multi, h2, 3600);
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: tiket berumur 1 jam diterima';
  END IF;

  ----------------------------------------------------------------- 7
  -- Keanggotaan diperiksa sebelum session dibuat: multi memang anggota Alpha.
  SELECT m.membership_id INTO v_member FROM auth.find_membership(multi, alpha) m;
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: keanggotaan sah tidak ditemukan';
  END IF;

  ----------------------------------------------------------------- 8
  -- Identitas yang hanya anggota Beta tidak menemukan keanggotaan di Alpha.
  -- Inilah yang mencegah tiket sah dipakai menunjuk tenant orang lain.
  SELECT count(*) INTO n FROM auth.find_membership(solo, alpha);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: keanggotaan lintas tenant ditemukan';
  END IF;

  ----------------------------------------------------------------- 9
  -- Pencabutan session: session yang dicabut tidak lagi dapat diresolusikan.
  v_session := auth.create_session('TENANT', multi, alpha,
                                   'a1a1a1a1-0000-0000-0000-000000000003', 60);
  SELECT count(*) INTO n FROM auth.find_session(v_session);
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 9 GAGAL: session baru tidak dapat diresolusikan';
  END IF;

  IF auth.revoke_session(v_session, 'CONTEXT_SWITCH') IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 9 GAGAL: pencabutan melaporkan tidak ada baris';
  END IF;

  SELECT count(*) INTO n FROM auth.find_session(v_session);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 9 GAGAL: session tercabut masih dapat dipakai';
  END IF;

  ----------------------------------------------------------------- 10
  -- Mencabut dua kali tidak menghasilkan error, hanya false. Idempoten.
  IF auth.revoke_session(v_session, 'CONTEXT_SWITCH') IS NOT FALSE THEN
    RAISE EXCEPTION 'KASUS 10 GAGAL: pencabutan kedua melaporkan berhasil';
  END IF;

  RAISE NOTICE 'SEMUA 10 KASUS SLICE 5 LULUS';
END
$$;

ROLLBACK;
