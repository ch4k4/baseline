-- slice14_test.sql
-- Dijalankan SEBAGAI app_user. Transaksi pertama selalu ROLLBACK; transaksi
-- kedua hanya membaca.
--
-- Slice 14 pada lapisan database: support session break-glass (DEMO-0312).
-- Yang diuji di sini adalah baris-baris daftar tes wajib ADR-003 sec.5 yang TIDAK
-- boleh bergantung pada kode aplikasi sama sekali:
--
--   * support session membuka SATU tenant; tenant lain tetap ditolak RLS;
--   * sesi support tidak dapat membaca tabel platform yang dipakai membukanya;
--   * satu baris sesi terlihat berbeda dari tiga context (platform, tenant, support);
--   * durasi > 60 menit, scope READ_WRITE dengan alasan yang salah, dan sesi kedua
--     milik superadmin yang sama: ditolak CHECK dan index, bukan oleh aplikasi;
--   * sesi tidak dapat diperpanjang dan tidak dapat dihidupkan kembali;
--   * F-18 fail-closed dan F-19 mengakhiri sesi yang menempel pada session platform;
--   * notifikasi tenant tidak dapat menunjuk sesi support tenant lain;
--   * READ_ONLY ditolak DI DATABASE (SET TRANSACTION READ ONLY), bukan hanya guard.
--
-- YANG TIDAK DIUJI DI SINI, dan sebabnya: kedaluwarsa. now() adalah waktu MULAI
-- TRANSAKSI, sehingga di dalam satu transaksi sebuah baris tidak pernah dapat
-- melewati expires_at-nya sendiri - dan app_user tidak punya grant untuk menulis
-- started_at, jadi barisnya juga tidak dapat dibuat "sudah lampau". Kedaluwarsa
-- karena itu diuji di lapisan API (slice14 #6), tempat koneksi superuser dapat
-- menua sebuah sesi. Menuliskannya di sini dengan pg_sleep akan menghasilkan tes
-- yang selalu lulus tanpa memeriksa apa pun.
--
-- Aturan: perbandingan tahan NULL; penolakan menerima SATU kode error.

\set ON_ERROR_STOP on
\timing off

BEGIN;

DO $$
DECLARE
  alpha      CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  beta       CONSTANT UUID := '22222222-2222-2222-2222-222222222222';
  superadmin CONSTANT UUID := 'dddddddd-0000-0000-0000-000000000001';
  owner_a    CONSTANT UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  admin_b    CONSTANT UUID := 'bbbbbbbb-0000-0000-0000-000000000001';
  -- Identitas keempat, dipakai KHUSUS untuk percobaan yang harus ditolak CHECK.
  -- Kenapa perlu identitas tersendiri: identitas yang sudah memegang sesi aktif
  -- akan ditolak index unik LEBIH DULU, sehingga percobaan itu gagal dengan kode
  -- error yang salah dan kasusnya lulus karena alasan yang salah. Ditemukan lewat
  -- uji mutasi S4/S5: dengan CHECK durasi dilonggarkan, kasus 4 tetap "gagal",
  -- tetapi karena unique_violation - bukan karena penjaga yang diujinya.
  bebas      CONSTANT UUID := 'cccccccc-0000-0000-0000-000000000001';
  m_owner_a  CONSTANT UUID := 'a1a1a1a1-0000-0000-0000-000000000001';
  sesi_plat  UUID;
  sesi_plat2 UUID;
  sup_a      UUID := gen_random_uuid();
  sup_lain   UUID := gen_random_uuid();
  sup_beta   UUID := gen_random_uuid();
  n          INTEGER;
  ok         BOOLEAN;
  v_notif    UUID;
BEGIN
  -- Dua session PLATFORM sungguhan: support session menggantung pada session
  -- platform yang membukanya (FK), jadi tidak ada jalan membuat sesi support
  -- "tanpa asal".
  PERFORM set_config('app.current_tenant_id', '', true);
  PERFORM set_config('app.context_kind', 'tenant', true);
  sesi_plat  := auth.create_session('PLATFORM', superadmin, NULL, NULL, 60);
  sesi_plat2 := auth.create_session('PLATFORM', superadmin, NULL, NULL, 60);

  PERFORM set_config('app.context_kind', 'platform', true);

  INSERT INTO support_sessions
    (id, tenant_id, superadmin_user_id, platform_session_id, scope, reason_code,
     reason_text_ciphertext, reason_text_key_version, ticket_reference, expires_at)
  VALUES (sup_a, alpha, superadmin, sesi_plat, 'READ_ONLY', 'DATA_INVESTIGATION',
          '\x0102'::bytea, 1, 'TIKET-4417', now() + interval '30 minutes');

  -- Sesi kedua di tenant yang SAMA, milik orang lain. Ada supaya kasus 3 dapat
  -- membuktikan sesi support hanya melihat BARISNYA SENDIRI - bukan sekadar
  -- "melihat satu baris karena hanya ada satu".
  --
  -- CATATAN JUJUR: database tidak menuntut superadmin_user_id benar-benar
  -- memegang role platform; yang menjaganya adalah route platform di aplikasi.
  -- Karena itu baris ini dapat dibuat atas nama owner_a, dan celah itu dicatat
  -- sebagai utang (D-39) - bukan ditutupi dengan tidak mengujinya.
  INSERT INTO support_sessions
    (id, tenant_id, superadmin_user_id, platform_session_id, scope, reason_code,
     reason_text_ciphertext, reason_text_key_version, expires_at)
  VALUES (sup_lain, alpha, owner_a, sesi_plat2, 'READ_ONLY', 'TENANT_REPORTED_BUG',
          '\x03'::bytea, 1, now() + interval '10 minutes');

  -- ---------------------------------------------------------------- KASUS 1
  -- Support session membuka SATU tenant, dan RLS - bukan kode - yang menahan
  -- sisanya. Inilah sebabnya support session tidak memakai role yang mem-bypass
  -- RLS (ADR-003 sec.2.3): batas tenantnya sama persis dengan batas anggota biasa.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  PERFORM set_config('app.context_kind', 'support', true);
  PERFORM set_config('app.support_session_id', sup_a::text, true);

  SELECT count(*) INTO n FROM tenant_memberships WHERE tenant_id = alpha;
  IF n IS NULL OR n < 1 THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: sesi support tidak dapat membaca anggota tenantnya';
  END IF;

  SELECT count(*) INTO n FROM tenant_memberships WHERE tenant_id = beta;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: sesi support ke Alpha membaca anggota Beta (% baris)', n;
  END IF;

  -- Dan tenant yang dibuka ditentukan GUC, bukan klausa WHERE: menyebut tenant
  -- lain secara eksplisit tetap nol baris.
  SELECT count(*) INTO n FROM roles WHERE tenant_id = beta;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: sesi support membaca role Beta (% baris)', n;
  END IF;

  -- ---------------------------------------------------------------- KASUS 2
  -- Hak yang dipakai MEMBUKA sesi tidak terbawa KE DALAM sesi. Tabel platform
  -- tertutup dari context support, sama seperti dari context tenant.
  SELECT count(*) INTO n FROM platform_role_assignments;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: sesi support membaca daftar admin platform (% baris)', n;
  END IF;
  SELECT count(*) INTO n FROM platform_role_permissions;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: sesi support membaca peta hak platform (% baris)', n;
  END IF;
  SELECT count(*) INTO n FROM tenants;
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: sesi support melihat % tenant (harus hanya tenantnya)', n;
  END IF;

  -- ---------------------------------------------------------------- KASUS 3
  -- Satu tabel, tiga context, tiga pemandangan berbeda (ADR-003 sec.2.4).
  SELECT count(*) INTO n FROM support_sessions;
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: context support melihat % baris sesi (harus 1)', n;
  END IF;
  -- Yang terlihat itu memang barisnya sendiri, bukan satu baris kebetulan.
  SELECT count(*) INTO n FROM support_sessions WHERE id = sup_a;
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: context support tidak melihat barisnya sendiri';
  END IF;

  -- Fail-closed: context support TANPA id sesi tidak melihat apa pun. Kalau
  -- app_support_session_id() mengembalikan sesuatu yang cocok dengan semua baris,
  -- pemeriksaan di atas tetap lulus - dan inilah kasus yang menangkapnya.
  PERFORM set_config('app.support_session_id', '', true);
  SELECT count(*) INTO n FROM support_sessions;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: context support tanpa id sesi melihat % baris', n;
  END IF;
  PERFORM set_config('app.support_session_id', sup_a::text, true);

  -- Context tenant: seluruh sesi tenant ini, tanpa syarat id sesi - tenant memang
  -- berhak tahu setiap kali platform membuka aksesnya.
  --
  -- Hitungannya DISARING pada baris milik transaksi ini (dua session platform yang
  -- dibuat di atas), bukan seluruh tabel. Versi pertama menghitung seluruh tabel dan
  -- gagal saat suite API meninggalkan empat baris - kegagalan yang tidak ada
  -- hubungannya dengan apa yang diujinya. Aturan lama yang saya langgar lagi: tes
  -- yang membaca tabel bersama wajib menyaring pada nilai miliknya sendiri.
  PERFORM set_config('app.context_kind', 'tenant', true);
  SELECT count(*) INTO n FROM support_sessions
   WHERE platform_session_id IN (sesi_plat, sesi_plat2);
  IF n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: tenant Alpha melihat % sesi supportnya (harus 2)', n;
  END IF;

  -- Tenant lain: tidak satu pun DARI baris itu.
  PERFORM set_config('app.current_tenant_id', beta::text, true);
  SELECT count(*) INTO n FROM support_sessions
   WHERE platform_session_id IN (sesi_plat, sesi_plat2);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: tenant Beta melihat sesi support Alpha (% baris)', n;
  END IF;

  -- Context platform: semuanya.
  PERFORM set_config('app.current_tenant_id', '', true);
  PERFORM set_config('app.context_kind', 'platform', true);
  SELECT count(*) INTO n FROM support_sessions;
  IF n IS NULL OR n < 2 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: context platform hanya melihat % sesi', n;
  END IF;

  -- ---------------------------------------------------------------- KASUS 4
  -- Batas 60 menit (ADR-003 sec.2.2 butir 5) ditegakkan CHECK. Aplikasi juga
  -- menolaknya dengan pesan, dan itu BUKAN alasan untuk tidak menjaganya di sini:
  -- pesan bisa dihapus dalam satu commit, CHECK tidak.
  ok := FALSE;
  BEGIN
    INSERT INTO support_sessions
      (tenant_id, superadmin_user_id, platform_session_id, scope, reason_code,
       reason_text_ciphertext, reason_text_key_version, expires_at)
    VALUES (beta, bebas, sesi_plat, 'READ_ONLY', 'DATA_INVESTIGATION',
            '\x04'::bytea, 1, now() + interval '61 minutes');
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: sesi support 61 menit diterima';
  END IF;

  -- Dan sesi yang sudah mati sejak lahir juga ditolak.
  ok := FALSE;
  BEGIN
    INSERT INTO support_sessions
      (tenant_id, superadmin_user_id, platform_session_id, scope, reason_code,
       reason_text_ciphertext, reason_text_key_version, expires_at)
    VALUES (beta, bebas, sesi_plat, 'READ_ONLY', 'DATA_INVESTIGATION',
            '\x04'::bytea, 1, now() - interval '1 minute');
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: sesi support yang sudah kedaluwarsa diterima';
  END IF;

  -- ---------------------------------------------------------------- KASUS 5
  -- READ_WRITE hanya untuk alasan yang mengizinkan perubahan (butir 1). Permission
  -- platform.support.start_write saja tidak cukup, dan syarat itu tidak hanya
  -- hidup di service.
  ok := FALSE;
  BEGIN
    INSERT INTO support_sessions
      (tenant_id, superadmin_user_id, platform_session_id, scope, reason_code,
       reason_text_ciphertext, reason_text_key_version, expires_at)
    VALUES (beta, bebas, sesi_plat, 'READ_WRITE', 'SECURITY_INCIDENT',
            '\x05'::bytea, 1, now() + interval '15 minutes');
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: READ_WRITE diterima dengan alasan SECURITY_INCIDENT';
  END IF;

  -- Kontrol: dengan alasan yang benar, READ_WRITE diterima. Tanpa kontrol ini,
  -- CHECK yang menolak SEMUA READ_WRITE akan lulus juga.
  --
  -- Atas nama identitas KETIGA, bukan owner_a: owner_a sudah memegang satu sesi
  -- aktif di atas, dan index "satu sesi aktif per superadmin" akan menolaknya -
  -- kegagalan yang tidak ada hubungannya dengan apa yang diuji di sini.
  INSERT INTO support_sessions
    (id, tenant_id, superadmin_user_id, platform_session_id, scope, reason_code,
     reason_text_ciphertext, reason_text_key_version, expires_at)
  VALUES (sup_beta, beta, admin_b, sesi_plat, 'READ_WRITE',
          'DATA_CORRECTION_REQUESTED_BY_TENANT', '\x06'::bytea, 1,
          now() + interval '15 minutes');

  -- ---------------------------------------------------------------- KASUS 6
  -- Satu sesi AKTIF per superadmin (butir 6), ditegakkan index unik parsial -
  -- bukan oleh pemeriksaan "sudah ada sesi?" di aplikasi, yang akan bocor pada
  -- dua permintaan bersamaan.
  ok := FALSE;
  BEGIN
    INSERT INTO support_sessions
      (tenant_id, superadmin_user_id, platform_session_id, scope, reason_code,
       reason_text_ciphertext, reason_text_key_version, expires_at)
    VALUES (beta, superadmin, sesi_plat2, 'READ_ONLY', 'DATA_INVESTIGATION',
            '\x07'::bytea, 1, now() + interval '15 minutes');
  EXCEPTION WHEN unique_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: superadmin membuka sesi support kedua';
  END IF;

  -- ---------------------------------------------------------------- KASUS 7
  -- Tidak dapat diperpanjang, dan tidak dapat dihidupkan kembali.
  --
  -- "Tidak dapat diperpanjang" bukan pemeriksaan: kolom expires_at tidak punya
  -- grant UPDATE sama sekali, jadi yang menolaknya adalah hak kolom.
  --
  -- Diperiksa sebagai HAK KOLOM, bukan lewat percobaan UPDATE. Sebabnya ditemukan
  -- uji mutasi S7: pelanggaran RLS dan hak kolom yang kurang memakai SQLSTATE yang
  -- SAMA (42501), sehingga percobaan UPDATE tetap "ditolak" walau grant-nya
  -- diberikan - yang menolaknya policy, bukan hak kolom. Dua penjaga tidak boleh
  -- saling menutupi (pelajaran slice 13), jadi masing-masing diperiksa langsung.
  SELECT count(*) INTO n FROM information_schema.column_privileges
   WHERE table_name = 'support_sessions' AND column_name = 'expires_at'
     AND grantee = 'app_user' AND privilege_type = 'UPDATE';
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: app_user punya hak UPDATE atas expires_at (% grant)', n;
  END IF;

  -- Dan percobaannya tetap ditolak, apa pun lapisan yang menolaknya.
  ok := FALSE;
  BEGIN
    UPDATE support_sessions SET expires_at = now() + interval '59 minutes' WHERE id = sup_a;
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: sesi support dapat diperpanjang';
  END IF;

  -- Mengakhiri: boleh, sekali.
  UPDATE support_sessions
     SET status = 'ENDED', ended_at = now(), ended_by = superadmin, end_reason = 'MANUAL'
   WHERE id = sup_a AND status = 'ACTIVE';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: sesi support tidak dapat diakhiri (% baris)', n;
  END IF;

  -- Keadaan setengah tidak dapat ditulis: "berakhir" selalu berarti ada waktunya.
  -- Tanpa kasus ini, CHECK yang menjaganya dapat dihapus tanpa satu tes pun berubah
  -- (uji mutasi S14), dan riwayat sesi kehilangan artinya - sesi ENDED tanpa
  -- ended_at tidak dapat dijawab "kapan platform berhenti membaca data kami?".
  ok := FALSE;
  BEGIN
    UPDATE support_sessions SET status = 'ENDED' WHERE id = sup_lain AND status = 'ACTIVE';
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: sesi berstatus ENDED tanpa waktu berakhir dapat ditulis';
  END IF;

  -- Menghidupkan kembali: nol baris. Policy UPDATE satu arah, sehingga sesi lama
  -- tidak dapat dipakai ulang sebagai jalan masuk tanpa alasan baru.
  UPDATE support_sessions SET status = 'ACTIVE', ended_at = NULL, end_reason = NULL
   WHERE id = sup_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: sesi support yang berakhir dapat dihidupkan (% baris)', n;
  END IF;

  -- Dan setelah sesi berakhir, superadmin yang sama boleh membuka sesi baru -
  -- index parsial memang hanya mengikat yang ACTIVE.
  INSERT INTO support_sessions
    (tenant_id, superadmin_user_id, platform_session_id, scope, reason_code,
     reason_text_ciphertext, reason_text_key_version, expires_at)
  VALUES (alpha, superadmin, sesi_plat, 'READ_ONLY', 'DATA_INVESTIGATION',
          '\x08'::bytea, 1, now() + interval '5 minutes');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: sesi baru ditolak walau sesi lama sudah berakhir';
  END IF;

  -- ---------------------------------------------------------------- KASUS 8
  -- F-18 fail-closed. Dipanggil guard pada SETIAP request, jadi inilah yang
  -- menentukan sesi yang dicabut langsung berhenti berlaku - bukan kedaluwarsa
  -- tokennya.
  SELECT count(*) INTO n FROM auth.find_support_session(sup_a);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: F-18 masih mengembalikan sesi yang sudah berakhir';
  END IF;

  SELECT count(*) INTO n FROM auth.find_support_session(sup_lain);
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: F-18 tidak mengembalikan sesi yang masih aktif';
  END IF;

  SELECT count(*) INTO n FROM auth.find_support_session(gen_random_uuid());
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: F-18 mengembalikan baris untuk id asing';
  END IF;

  -- F-18 juga berjalan TANPA context apa pun - guard memanggilnya sebelum context
  -- ditetapkan. Kalau ia bergantung pada GUC, seluruh jalur support mati.
  PERFORM set_config('app.current_tenant_id', '', true);
  PERFORM set_config('app.context_kind', '', true);
  PERFORM set_config('app.support_session_id', '', true);
  SELECT count(*) INTO n FROM auth.find_support_session(sup_lain);
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: F-18 gagal tanpa context (% baris)', n;
  END IF;

  -- ---------------------------------------------------------------- KASUS 9
  -- F-19: logout session PLATFORM mengakhiri sesi support yang menempel padanya
  -- (ADR-003 sec.2.6 butir 5), dan mengembalikan barisnya supaya pemanggil dapat
  -- memberi tahu tenant.
  SELECT count(*) INTO n FROM auth.end_support_sessions_for_platform_session(sesi_plat2);
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 9 GAGAL: F-19 mengakhiri % sesi (harus 1)', n;
  END IF;

  -- Idempoten: pemanggilan kedua tidak menemukan apa pun untuk diakhiri.
  SELECT count(*) INTO n FROM auth.end_support_sessions_for_platform_session(sesi_plat2);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 9 GAGAL: F-19 mengakhiri sesi yang sama dua kali';
  END IF;

  -- Dan sesi milik session platform LAIN tidak ikut terbawa.
  PERFORM set_config('app.context_kind', 'platform', true);
  SELECT count(*) INTO n FROM support_sessions
   WHERE platform_session_id = sesi_plat AND status = 'ACTIVE';
  IF n IS NULL OR n < 1 THEN
    RAISE EXCEPTION 'KASUS 9 GAGAL: F-19 ikut mengakhiri sesi session platform lain';
  END IF;

  -- ---------------------------------------------------------------- KASUS 10
  -- Notifikasi tenant tidak dapat menunjuk sesi support tenant LAIN. Janji
  -- migrasi 0019 dibayar sebagai composite FK (tenant_id, ref_id), jadi yang
  -- menjaganya bukan pemanggil F-15 yang berhati-hati.
  ok := FALSE;
  BEGIN
    PERFORM auth.notify_tenant_security_event(beta, 'SUPPORT_SESSION_STARTED', sup_lain);
  EXCEPTION WHEN foreign_key_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 10 GAGAL: notifikasi Beta menunjuk sesi support Alpha';
  END IF;

  -- Kontrol: menunjuk sesi tenantnya sendiri tetap boleh.
  v_notif := auth.notify_tenant_security_event(beta, 'SUPPORT_SESSION_STARTED', sup_beta);
  IF v_notif IS NULL THEN
    RAISE EXCEPTION 'KASUS 10 GAGAL: notifikasi untuk sesi tenant sendiri ditolak';
  END IF;

  RAISE NOTICE 'SEMUA 10 KASUS SLICE 14 LULUS';
END
$$;

ROLLBACK;

-- ---------------------------------------------------------------- KASUS 11
-- READ_ONLY ditolak DI DATABASE, bukan hanya di guard (ADR-003 sec.5).
--
-- Transaksi tersendiri karena SET TRANSACTION harus mendahului query pertama -
-- syarat yang sama yang membuat unit of work memasangnya sebelum set_config.
-- Transaksi ini tidak menulis apa pun, jadi tidak ada yang perlu di-ROLLBACK
-- selain formalitas.
BEGIN;
SET TRANSACTION READ ONLY;

DO $$
DECLARE
  alpha CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  n     INTEGER;
  ok    BOOLEAN := FALSE;
BEGIN
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  PERFORM set_config('app.context_kind', 'support', true);

  -- Membaca tetap boleh - sesi READ_ONLY memang untuk membaca.
  SELECT count(*) INTO n FROM tenant_memberships;
  IF n IS NULL OR n < 1 THEN
    RAISE EXCEPTION 'KASUS 11 GAGAL: transaksi READ ONLY tidak dapat membaca anggota';
  END IF;

  -- Menulis ditolak database, dengan kode errornya sendiri. Bukan
  -- insufficient_privilege: hak app_user tidak berubah - yang berubah adalah
  -- sifat transaksinya, dan itu sengaja diperiksa lewat kode yang tepat supaya
  -- kasus ini tidak lulus karena alasan lain.
  BEGIN
    UPDATE tenant_memberships SET version = version + 1 WHERE tenant_id = alpha;
  EXCEPTION WHEN read_only_sql_transaction THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 11 GAGAL: mutasi lolos di transaksi READ ONLY';
  END IF;

  RAISE NOTICE 'KASUS 11 SLICE 14 LULUS';
END
$$;

ROLLBACK;
