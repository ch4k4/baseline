-- slice1_test.sql
-- Dijalankan SEBAGAI app_user:
--   psql "postgres://app_user:...@localhost/saas_demo" -v ON_ERROR_STOP=1 -f slice1_test.sql
--
-- Gagal = keluar dengan exit code bukan nol dan pesan yang menyebut nomor kasus.
-- Tidak ada output "hijau" yang palsu: setiap kasus memeriksa nilai, bukan sekadar
-- memastikan query tidak error.

\set ON_ERROR_STOP on
\timing off

-- Seluruh berkas berjalan dalam SATU transaksi yang di-ROLLBACK di akhir.
-- Tanpa ini, setiap run meninggalkan tiket, hash, dan hitungan kegagalan, lalu
-- run berikutnya bertabrakan dengan sisa itu: tiga dari empat berkas tes gagal
-- bila dijalankan dua kali tanpa reset (ditemukan audit tes 2026-09-21).
-- Tes yang hasilnya bergantung pada apa yang tersisa di database bukan tes.
BEGIN;

-- Blind index email identitas uji, diserahkan runner (db.ps1/db.sh) sebagai
-- variabel psql. Tes ini berjalan sebagai app_user yang - dengan benar - tidak
-- dapat membaca users maupun menghitung blind index: kuncinya tidak pernah ada di
-- database. Variabel psql tidak diganti di dalam blok $$, jadi dititipkan lewat
-- setting transaksi. Tanpa variabel ini berkas berhenti di baris berikut.
SELECT set_config('test.multi_email_bi', :'multi_email_bi', true) AS _bi \gset

-- Setiap pemeriksaan ditulis tahan NULL: IS DISTINCT FROM, IS NOT TRUE, IS NOT FALSE.
-- `IF x <> y` diam-diam lulus saat x NULL, karena NULL <> y bukan TRUE. Fungsi yang
-- rusak dan tidak mengembalikan baris menghasilkan NULL - persis kerusakan yang
-- harus ditangkap (ditemukan audit tes 2026-09-21).

DO $$
DECLARE
  alpha  CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  beta   CONSTANT UUID := '22222222-2222-2222-2222-222222222222';
  multi  CONSTANT UUID := 'cccccccc-0000-0000-0000-000000000001';
  m_beta CONSTANT UUID := 'b2b2b2b2-0000-0000-0000-000000000001';
  m_multi_beta CONSTANT UUID := 'b2b2b2b2-0000-0000-0000-000000000002';
  superadmin CONSTANT UUID := 'dddddddd-0000-0000-0000-000000000001';
  n            INTEGER;
  v_uid        UUID;
  v_session    UUID;
  v_ctx        INTEGER;
  ok           BOOLEAN;
BEGIN
  ----------------------------------------------------------------- 1
  -- Tanpa tenant context: nol baris, bukan error. Fail-closed.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM tenant_memberships;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: tanpa context terbaca % baris, harusnya 0', n;
  END IF;

  ----------------------------------------------------------------- 2
  -- Context Alpha: hanya baris Alpha.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM tenant_memberships;
  IF n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: Alpha terbaca % membership, harusnya 3', n;
  END IF;
  SELECT count(*) INTO n FROM tenant_memberships WHERE tenant_id <> alpha;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: bocor % baris tenant lain', n;
  END IF;

  ----------------------------------------------------------------- 3
  -- Context Beta: hanya baris Beta.
  PERFORM set_config('app.current_tenant_id', beta::text, true);
  SELECT count(*) INTO n FROM tenant_memberships;
  IF n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: Beta terbaca % membership, harusnya 2', n;
  END IF;

  ----------------------------------------------------------------- 4
  -- Known-ID attack: menyebut id baris tenant lain secara eksplisit.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM tenant_memberships WHERE id = m_beta;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: baris tenant lain terbaca lewat known ID';
  END IF;

  ----------------------------------------------------------------- 5
  -- WITH CHECK: menulis baris milik tenant lain ditolak.
  ok := FALSE;
  BEGIN
    INSERT INTO tenant_memberships (tenant_id, user_id)
    VALUES (beta, multi);
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN ok := TRUE;
    WHEN unique_violation THEN
      RAISE EXCEPTION 'KASUS 5 GAGAL: insert menembus RLS dan baru ditolak UNIQUE';
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: insert lintas tenant tidak ditolak';
  END IF;

  ----------------------------------------------------------------- 6
  -- app_user tidak punya grant apa pun ke users / credentials.
  ok := FALSE;
  BEGIN
    EXECUTE 'SELECT count(*) FROM users';
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: app_user dapat membaca tabel users';
  END IF;

  ok := FALSE;
  BEGIN
    EXECUTE 'SELECT count(*) FROM credentials';
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: app_user dapat membaca tabel credentials';
  END IF;

  ----------------------------------------------------------------- 7
  -- app_user tidak dapat menjelma jadi app_auth_definer.
  ok := FALSE;
  BEGIN
    EXECUTE 'SET ROLE app_auth_definer';
  EXCEPTION WHEN OTHERS THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: app_user berhasil SET ROLE app_auth_definer';
  END IF;

  ----------------------------------------------------------------- 8
  -- INTI OPSI A: fungsi definer membaca identitas TANPA tenant context.
  -- Sejak D-01 pencarian lewat blind index; email tidak pernah sampai ke database.
  -- Normalisasi email kini tugas aplikasi (normalize.ts) dan diuji di API slice 8.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT user_id INTO v_uid
  FROM auth.find_identity_for_login(decode(current_setting('test.multi_email_bi'), 'hex'));
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: fungsi definer mengembalikan 0 baris (inilah cacat v1.1-v1.2)';
  END IF;
  IF v_uid IS DISTINCT FROM multi THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: user_id salah (%)', v_uid;
  END IF;

  -- Blind index yang tidak dikenal tidak mengembalikan apa pun.
  SELECT count(*) INTO n FROM auth.find_identity_for_login(sha256('bukan-blind-index'::bytea));
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: blind index asing menemukan identitas';
  END IF;

  ----------------------------------------------------------------- 9
  -- F-04: user lintas tenant melihat dua context, tetap tanpa GUC.
  SELECT count(*) INTO v_ctx FROM auth.list_login_contexts(multi);
  IF v_ctx IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'KASUS 9 GAGAL: context multi-tenant = %, harusnya 2', v_ctx;
  END IF;

  ----------------------------------------------------------------- 10
  -- F-07 + F-08: buat session tenant, lalu resolusikan tanpa GUC.
  v_session := auth.create_session('TENANT', multi, alpha,
                                   'a1a1a1a1-0000-0000-0000-000000000003', 60);
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM auth.find_session(v_session);
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 10 GAGAL: session tidak dapat diresolusikan tanpa context';
  END IF;

  ----------------------------------------------------------------- 11
  -- Session hanya terlihat app_user pada tenant yang benar.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM sessions WHERE id = v_session;
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 11 GAGAL: session tidak terlihat di tenant pemiliknya';
  END IF;
  PERFORM set_config('app.current_tenant_id', beta::text, true);
  SELECT count(*) INTO n FROM sessions WHERE id = v_session;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 11 GAGAL: session Alpha terbaca dari context Beta';
  END IF;

  ----------------------------------------------------------------- 12
  -- Composite FK: session yang menunjuk membership tenant lain ditolak DATABASE.
  --
  -- Dipakai membership multi SENDIRI di Beta, bukan membership orang lain.
  -- Sejak DEMO-0311 F-07 juga menolak membership yang bukan milik user itu, dan
  -- kalau kasus ini memakai membership orang lain, penolakan datang dari sana -
  -- composite FK tidak lagi teruji, padahal itulah satu-satunya yang membuktikan
  -- batas TENANT (bukan batas orang).
  ok := FALSE;
  BEGIN
    PERFORM auth.create_session('TENANT', multi, alpha, m_multi_beta, 60);
  EXCEPTION WHEN foreign_key_violation THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'KASUS 12 GAGAL: session lintas tenant tidak ditolak composite FK';
  END IF;

  ----------------------------------------------------------------- 13
  -- Session PLATFORM tidak pernah terlihat app_user, apa pun GUC-nya.
  --
  -- Pelakunya superadmin, bukan identitas tenant biasa: sejak DEMO-0311 F-07
  -- menolak menerbitkan session PLATFORM untuk identitas tanpa role platform,
  -- jadi session semacam itu tidak lagi dapat dibuat untuk diuji. Baris ini
  -- karena itu bergantung pada perintah bootstrap yang berjalan sebelum tes.
  v_session := auth.create_session('PLATFORM', superadmin, NULL, NULL, 60);
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM sessions WHERE id = v_session;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 13 GAGAL: session PLATFORM terlihat oleh app_user';
  END IF;

  ----------------------------------------------------------------- 14
  -- Grant kolom: app_auth_definer hanya dapat membaca kolom yang memang dibutuhkan
  -- fungsi pre-context - daftarnya diperiksa PERSIS lewat katalog.
  --
  -- Versi sebelumnya memakai fungsi probe yang berjalan sebagai app_user. Itu
  -- hanya membuktikan app_user tidak punya grant ke users (sudah kasus 6), bukan
  -- batas jalur definer: menambah grant created_at ke app_auth_definer tidak
  -- membuatnya gagal (dibuktikan audit tes 2026-09-21).
  DECLARE
    v_cols TEXT;
  BEGIN
    SELECT string_agg(a.attname::text, ',' ORDER BY a.attname) INTO v_cols
    FROM pg_attribute a
    WHERE a.attrelid = 'public.users'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege('app_auth_definer', a.attrelid, a.attnum, 'SELECT');
    IF v_cols IS DISTINCT FROM 'email_blind_index,id,status' THEN
      RAISE EXCEPTION 'KASUS 14 GAGAL: app_auth_definer dapat membaca kolom users: %', v_cols;
    END IF;

    SELECT string_agg(a.attname::text, ',' ORDER BY a.attname) INTO v_cols
    FROM pg_attribute a
    WHERE a.attrelid = 'public.credentials'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege('app_auth_definer', a.attrelid, a.attnum, 'SELECT');
    IF v_cols IS DISTINCT FROM 'id,password_hash,user_id' THEN
      RAISE EXCEPTION 'KASUS 14 GAGAL: app_auth_definer dapat membaca kolom credentials: %', v_cols;
    END IF;

    -- Sejak D-01 jalur definer tidak membaca profil sama sekali, dan tidak pernah
    -- membaca ciphertext email global: login cukup tahu identitas mana yang cocok.
    SELECT string_agg(a.attname::text, ',' ORDER BY a.attname) INTO v_cols
    FROM pg_attribute a
    WHERE a.attrelid = 'public.tenant_member_profiles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege('app_auth_definer', a.attrelid, a.attnum, 'SELECT');
    IF v_cols IS NOT NULL THEN
      RAISE EXCEPTION 'KASUS 14 GAGAL: app_auth_definer dapat membaca kolom profil: %', v_cols;
    END IF;
  END;

  ----------------------------------------------------------------- 15
  -- Setiap tabel aplikasi ber-RLS ENABLE dan FORCE. FORCE yang terlepas membuat
  -- pemilik tabel melewati policy tanpa jejak di tes lain: migrasi 0015 melepasnya
  -- sesaat untuk menambah katalog, dan lupa memasangnya kembali tidak tertangkap
  -- tes mana pun sebelum kasus ini (audit mutasi D-28, S4).
  --
  -- PENGECUALIAN yang dinyatakan, bukan aturan yang dilonggarkan. Satu tabel boleh
  -- tanpa RLS, dan hanya karena alasan yang ditulis di sini:
  --
  --   schema_migrations  ledger migrasi (0001b). Tidak memuat data tenant, dan
  --                      satu-satunya penulisnya adalah PEMILIK tabel (pemasang
  --                      berjalan sebagai app_owner). Karena FORCE berlaku juga bagi
  --                      pemilik, memasang RLS di sini hanya akan mengunci penulisnya
  --                      sendiri tanpa melindungi siapa pun. Yang menjaganya: tidak
  --                      ada grant apa pun untuk app_user maupun peran definer,
  --                      diperiksa tes ledger (api/test/migration.test.ts kasus 3).
  --
  -- Menambah nama ke daftar ini WAJIB disertai alasan di atas. Tabel baru yang lupa
  -- dipasangi RLS akan tetap menggagalkan kasus ini - itulah gunanya.
  DECLARE
    v_tabel TEXT;
    v_kecuali CONSTANT TEXT[] := ARRAY['schema_migrations'];
  BEGIN
    SELECT string_agg(c.relname::text, ',' ORDER BY c.relname) INTO v_tabel
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'auth') AND c.relkind IN ('r', 'p')
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
      AND NOT (c.relname::text = ANY (v_kecuali));
    IF v_tabel IS NOT NULL THEN
      RAISE EXCEPTION 'KASUS 15 GAGAL: tabel tanpa RLS ENABLE+FORCE: %', v_tabel;
    END IF;

    -- Pengecualian yang sudah tidak diperlukan juga cacat: ia membuat daftar di atas
    -- terbaca seperti masih berlaku. Kalau tabelnya kelak dipasangi RLS, namanya
    -- harus dikeluarkan dari daftar.
    SELECT string_agg(c.relname::text, ',' ORDER BY c.relname) INTO v_tabel
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'auth') AND c.relkind IN ('r', 'p')
      AND c.relname::text = ANY (v_kecuali)
      AND c.relrowsecurity;
    IF v_tabel IS NOT NULL THEN
      RAISE EXCEPTION 'KASUS 15 GAGAL: pengecualian RLS sudah tidak diperlukan untuk %', v_tabel;
    END IF;
    SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r';
    IF n < 16 THEN RAISE EXCEPTION 'KASUS 15 GAGAL: hanya % tabel terbaca', n; END IF;
  END;

  RAISE NOTICE 'SEMUA 15 KASUS LULUS';
END
$$;

ROLLBACK;
