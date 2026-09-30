-- slice13_test.sql
-- Dijalankan SEBAGAI app_user. Satu transaksi, selalu ROLLBACK.
--
-- Slice 13 pada lapisan database: guard platform (DEMO-0311) dan notifikasi
-- keamanan tenant (DEMO-0313). Yang diuji di sini adalah hal-hal yang TIDAK
-- boleh bergantung pada kode aplikasi:
--
--   * daftar admin platform dan peta hak platform tidak terbaca dari context
--     tenant - termasuk oleh kode yang lupa memeriksa apa pun;
--   * context platform TIDAK membuka tabel tenant-owned (ADR-003 sec.5 baris
--     pertama, sisi database);
--   * role tenant tidak dapat memperoleh permission platform;
--   * session PLATFORM tidak dapat diterbitkan untuk identitas tanpa role platform;
--   * notifikasi tenant hanya dapat ditulis lewat F-15, dan tidak menyeberang tenant.
--
-- Aturan: perbandingan tahan NULL; penolakan menerima SATU kode error.

\set ON_ERROR_STOP on
\timing off

BEGIN;

DO $$
DECLARE
  alpha       CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  beta        CONSTANT UUID := '22222222-2222-2222-2222-222222222222';
  superadmin  CONSTANT UUID := 'dddddddd-0000-0000-0000-000000000001';
  owner_a     CONSTANT UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  m_owner_a   CONSTANT UUID := 'a1a1a1a1-0000-0000-0000-000000000001';
  uji_role    CONSTANT UUID := gen_random_uuid();
  n           INTEGER;
  katalog     INTEGER;
  ok          BOOLEAN;
  v_notif     UUID;
  v_sesi      UUID;
  v_support   UUID;
BEGIN
  -- ---------------------------------------------------------------- KASUS 1
  -- Tanpa context platform, tabel platform tidak ada isinya bagi app_user.
  -- Bukan "kurang kolom" atau "ditolak": NOL BARIS, sehingga kode yang lupa
  -- memeriksa context tidak mendapat data untuk disalahgunakan.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  PERFORM set_config('app.context_kind', 'tenant', true);

  SELECT count(*) INTO n FROM platform_role_assignments;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: assignment platform terbaca dari context tenant (% baris)', n;
  END IF;

  SELECT count(*) INTO n FROM platform_role_permissions;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: peta hak platform terbaca dari context tenant (% baris)', n;
  END IF;

  -- Dan saat context_kind TIDAK DISET sama sekali. Ini yang membuat app_context_kind()
  -- harus fail-closed: kalau nilai kosong dibaca sebagai 'platform', kode yang
  -- lupa menetapkan context akan membuka seluruh tabel platform - dan pemeriksaan
  -- di atas tidak akan menangkapnya, karena di sana context memang diset.
  PERFORM set_config('app.context_kind', '', true);
  SELECT count(*) INTO n FROM platform_role_assignments;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: tabel platform terbuka saat context_kind kosong (% baris)', n;
  END IF;
  PERFORM set_config('app.context_kind', 'tenant', true);

  -- ---------------------------------------------------------------- KASUS 2
  -- Pada context platform, isinya ada DAN sama dengan katalog permission
  -- PLATFORM. Kasus ini menangkap kegagalan yang paling berbahaya dari migrasi
  -- 0018: FORCE RLS pada permissions berlaku juga bagi app_owner, sehingga
  -- INSERT ... SELECT pengisian tabel ini pernah menyisipkan NOL baris dan
  -- berhasil tanpa pesan apa pun.
  PERFORM set_config('app.current_tenant_id', '', true);
  PERFORM set_config('app.context_kind', 'platform', true);

  SELECT count(*) INTO n        FROM platform_role_permissions WHERE role_code = 'platform_superadmin';
  SELECT count(*) INTO katalog  FROM permissions WHERE scope = 'PLATFORM' AND retired_at IS NULL;
  IF n IS DISTINCT FROM katalog OR n = 0 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: peta hak platform % baris, katalog % baris', n, katalog;
  END IF;

  -- Dan superadmin hasil bootstrap benar-benar ada, tepat satu yang aktif.
  SELECT count(*) INTO n FROM platform_role_assignments
   WHERE user_id = superadmin AND role_code = 'platform_superadmin' AND revoked_at IS NULL;
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: assignment superadmin aktif % baris (harus 1)', n;
  END IF;

  -- ---------------------------------------------------------------- KASUS 3
  -- Context platform TIDAK membuka tabel tenant-owned. Ini baris pertama daftar
  -- tes wajib ADR-003 sec.5 pada sisi database: superadmin tanpa support session
  -- tidak dapat membaca data tenant. Yang menahannya bukan permission aplikasi
  -- melainkan policy tenant, yang menuntut tenant_id = app_current_tenant() -
  -- dan pada context platform nilainya kosong.
  SELECT count(*) INTO n FROM tenant_memberships;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: context platform membaca tenant_memberships (% baris)', n;
  END IF;
  SELECT count(*) INTO n FROM tenant_member_profiles;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: context platform membaca profil anggota (% baris)', n;
  END IF;
  SELECT count(*) INTO n FROM roles;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: context platform membaca role tenant (% baris)', n;
  END IF;

  -- ---------------------------------------------------------------- KASUS 4
  -- Role tenant tidak dapat memperoleh permission platform. Ditolak foreign key
  -- (permission_code, permission_scope) -> permissions (code, scope), bukan oleh
  -- validasi aplikasi: scope pada role_permissions selalu 'TENANT'.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  PERFORM set_config('app.context_kind', 'tenant', true);

  -- Dipakai role BUATAN, bukan role sistem: isi role sistem sudah ditolak lebih
  -- dulu oleh policy, sehingga percobaan atasnya tidak membuktikan apa pun
  -- tentang scope permission. (Pelajaran yang sama dengan slice 11 kasus 7.)
  INSERT INTO roles (id, tenant_id, code, name)
  VALUES (uji_role, alpha, 'r13_uji', 'Peran Uji Slice 13');

  ok := FALSE;
  BEGIN
    INSERT INTO role_permissions (tenant_id, role_id, permission_code)
    VALUES (alpha, uji_role, 'platform.admins.manage');
  EXCEPTION WHEN foreign_key_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: role tenant menerima permission platform';
  END IF;

  -- Kontrol: permission tenant tetap dapat dipasang ke role yang sama.
  INSERT INTO role_permissions (tenant_id, role_id, permission_code)
  VALUES (alpha, uji_role, 'members.read');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: permission tenant ikut tertolak';
  END IF;

  -- ---------------------------------------------------------------- KASUS 5
  -- F-07 menolak session yang tidak berhak.
  --
  -- (a) PLATFORM untuk identitas tanpa role platform;
  -- (b) PLATFORM yang membawa tenant;
  -- (c) TENANT atas membership yang bukan milik user itu.
  ok := FALSE;
  BEGIN
    v_sesi := auth.create_session('PLATFORM', owner_a, NULL, NULL, 60);
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: session PLATFORM terbit untuk identitas tanpa role platform';
  END IF;

  ok := FALSE;
  BEGIN
    v_sesi := auth.create_session('PLATFORM', superadmin, alpha, m_owner_a, 60);
  EXCEPTION WHEN invalid_parameter_value THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: session PLATFORM menerima tenant';
  END IF;

  ok := FALSE;
  BEGIN
    v_sesi := auth.create_session('TENANT', superadmin, alpha, m_owner_a, 60);
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: session TENANT terbit atas membership orang lain';
  END IF;

  -- Kontrol: yang berhak tetap dapat. Aturan yang menolak semuanya juga akan
  -- membuat kasus di atas lulus tanpa arti.
  v_sesi := auth.create_session('PLATFORM', superadmin, NULL, NULL, 60);
  IF v_sesi IS NULL THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: superadmin tidak dapat memperoleh session PLATFORM';
  END IF;

  -- ---------------------------------------------------------------- KASUS 6
  -- F-04 menyertakan context PLATFORM sebagai BARIS untuk superadmin, dan tidak
  -- menyertakannya untuk identitas tenant biasa.
  SELECT count(*) INTO n FROM auth.list_login_contexts(superadmin)
   WHERE context_kind = 'PLATFORM';
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: context PLATFORM superadmin % baris (harus 1)', n;
  END IF;

  -- Superadmin demo tidak punya membership tenant: seluruh barisnya PLATFORM.
  SELECT count(*) INTO n FROM auth.list_login_contexts(superadmin)
   WHERE context_kind = 'TENANT';
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: superadmin demo punya context tenant (% baris)', n;
  END IF;

  SELECT count(*) INTO n FROM auth.list_login_contexts(owner_a)
   WHERE context_kind = 'PLATFORM';
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: identitas tenant biasa mendapat context PLATFORM';
  END IF;

  -- F-13 sejalan dengan itu.
  SELECT count(*) INTO n FROM auth.get_platform_roles(superadmin);
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: F-13 mengembalikan % role untuk superadmin', n;
  END IF;
  SELECT count(*) INTO n FROM auth.get_platform_roles(owner_a);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: F-13 memberi role platform ke identitas tenant';
  END IF;

  -- ---------------------------------------------------------------- KASUS 7
  -- Notifikasi keamanan tenant: satu jalan masuk, dan itu bukan app_user.
  --
  -- Sejak migrasi 0020 ref_id adalah FOREIGN KEY ke support_sessions (janji yang
  -- ditulis 0019 dan dibayar di sana), jadi notifikasi tidak dapat lagi menunjuk
  -- id karangan. Satu sesi support sungguhan dibuat lebih dulu - dan itu justru
  -- membuat kasus ini lebih dekat ke keadaan nyata daripada sebelumnya.
  PERFORM set_config('app.current_tenant_id', '', true);
  PERFORM set_config('app.context_kind', 'platform', true);
  v_support := gen_random_uuid();
  INSERT INTO support_sessions
    (id, tenant_id, superadmin_user_id, platform_session_id, scope, reason_code,
     reason_text_ciphertext, reason_text_key_version, expires_at)
  VALUES (v_support, alpha, superadmin, v_sesi, 'READ_ONLY', 'DATA_INVESTIGATION',
          '\x00'::bytea, 1, now() + interval '30 minutes');

  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  PERFORM set_config('app.context_kind', 'tenant', true);
  ok := FALSE;
  BEGIN
    INSERT INTO tenant_notifications (tenant_id, type, ref_id)
    VALUES (alpha, 'SUPPORT_SESSION_STARTED', v_support);
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: app_user dapat menulis notifikasi keamanan';
  END IF;

  -- Lewat F-15: boleh.
  v_notif := auth.notify_tenant_security_event(alpha, 'SUPPORT_SESSION_STARTED', v_support);
  IF v_notif IS NULL THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: F-15 tidak menghasilkan notifikasi';
  END IF;

  -- Tipe di luar allowlist ditolak fungsinya.
  ok := FALSE;
  BEGIN
    PERFORM auth.notify_tenant_security_event(alpha, 'APA_SAJA', v_support);
  EXCEPTION WHEN invalid_parameter_value THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: tipe notifikasi di luar allowlist diterima';
  END IF;

  -- Tenant yang tidak ada ditolak.
  ok := FALSE;
  BEGIN
    PERFORM auth.notify_tenant_security_event(gen_random_uuid(), 'SUPPORT_SESSION_STARTED', v_support);
  EXCEPTION WHEN foreign_key_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: notifikasi untuk tenant yang tidak ada diterima';
  END IF;

  -- Terbaca di tenantnya sendiri.
  SELECT count(*) INTO n FROM tenant_notifications WHERE id = v_notif;
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: notifikasi tidak terbaca di tenantnya sendiri';
  END IF;

  -- ---------------------------------------------------------------- KASUS 8
  -- Tidak menyeberang tenant, dan tidak dapat dijadikan "belum dibaca" lagi.
  PERFORM set_config('app.current_tenant_id', beta::text, true);
  SELECT count(*) INTO n FROM tenant_notifications WHERE id = v_notif;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: notifikasi Alpha terbaca dari Beta';
  END IF;

  -- Beta juga tidak dapat menandainya terbaca (baris itu tidak ada untuknya).
  UPDATE tenant_notifications SET read_at = now(), read_by_membership_id = NULL WHERE id = v_notif;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: Beta menandai notifikasi Alpha terbaca';
  END IF;

  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  UPDATE tenant_notifications SET read_at = now(), read_by_membership_id = m_owner_a
   WHERE id = v_notif;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: pemilik tenant tidak dapat menandai terbaca';
  END IF;

  -- Sekali jalan: yang sudah terbaca tidak dapat dikembalikan.
  UPDATE tenant_notifications SET read_at = NULL, read_by_membership_id = NULL WHERE id = v_notif;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: notifikasi yang sudah dibaca dapat dikembalikan';
  END IF;

  -- Dan "terbaca" tidak dapat ditulis setengah: pembaca tanpa waktu baca.
  --
  -- Yang menolaknya adalah WITH CHECK pada policy UPDATE, dan kode error itulah
  -- yang dituntut di sini - BUKAN "pokoknya ditolak". Di bawahnya masih ada CHECK
  -- di tabel yang menolak hal yang sama dengan kode berbeda; menerima kedua kode
  -- akan membuat kasus ini tetap lulus walau policy-nya dilonggarkan, yaitu
  -- persis kerusakan yang seharusnya ia tangkap (uji mutasi P8).
  v_notif := auth.notify_tenant_security_event(alpha, 'SUPPORT_SESSION_ENDED', v_support);
  ok := FALSE;
  BEGIN
    UPDATE tenant_notifications SET read_by_membership_id = m_owner_a WHERE id = v_notif;
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: pembaca tercatat tanpa waktu baca';
  END IF;

  RAISE NOTICE 'SEMUA 8 KASUS SLICE 13 LULUS';
END
$$;

ROLLBACK;
