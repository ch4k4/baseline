-- slice15_test.sql
-- Dijalankan SEBAGAI app_user. Satu transaksi, selalu ROLLBACK.
--
-- Slice 15 pada lapisan database: skema menu (DEMO-0401) dan pemisahan bacaannya
-- per context (bahan resolver DEMO-0403).
--
-- Yang diuji di sini adalah hal-hal yang TIDAK boleh bergantung pada kode
-- aplikasi:
--
--   * app_user TIDAK dapat menulis menu sama sekali - administrasi menu (P2) tidak
--     ada di baseline, dan pernyataan itu ditegakkan GRANT, bukan "belum ada
--     endpoint";
--   * navigasi tenant terlihat oleh tenant, navigasi konsol platform TIDAK;
--   * menu tenant lain tidak terlihat, walau disebut namanya;
--   * isi seed sama dengan yang dijanjikan (penjaga terhadap kegagalan senyap
--     INSERT di balik FORCE RLS - pelajaran migrasi 0018);
--   * owner_key benar-benar terisi dari tenant_id, karena seluruh foreign key
--     hierarki bergantung padanya.
--
-- Validasi yang menolak PENULISAN (siklus, induk lintas tenant, route di luar
-- allowlist, scope permission yang tidak cocok) TIDAK dapat diuji di sini: app_user
-- tidak punya hak tulis, sehingga setiap percobaan ditolak hak - bukan oleh penjaga
-- yang dimaksud, dan kasus yang lulus karena alasan yang salah lebih buruk daripada
-- kasus yang tidak ada. Penjaga itu diuji di lapisan API lewat koneksi superuser
-- (slice15 #6), tempat hak tidak lagi menutupi constraint.
--
-- Aturan: perbandingan tahan NULL; penolakan menerima SATU kode error.

\set ON_ERROR_STOP on
\timing off

BEGIN;

DO $$
DECLARE
  alpha    CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  beta     CONSTANT UUID := '22222222-2222-2222-2222-222222222222';
  sentinel CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
  n        INTEGER;
  ok       BOOLEAN;
  kode     TEXT[];
BEGIN
  -- ---------------------------------------------------------------- KASUS 1
  -- Context tenant melihat navigasi tenant, dan HANYA itu.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  PERFORM set_config('app.context_kind', 'tenant', true);

  SELECT array_agg(code ORDER BY code) INTO kode FROM menus;
  IF kode IS DISTINCT FROM ARRAY['administration','dashboard','invitations','members','roles','security'] THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: navigasi tenant berisi %', kode;
  END IF;

  -- Menu konsol platform tidak "terlihat tetapi terkunci" - ia TIDAK ADA di sini.
  SELECT count(*) INTO n FROM menus WHERE context_kind = 'PLATFORM';
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: context tenant melihat % menu platform', n;
  END IF;

  -- Pemetaan permissionnya ikut terbatas: yang terbaca hanya milik menu tenant.
  SELECT count(*) INTO n FROM menu_permissions WHERE context_kind = 'PLATFORM';
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: context tenant melihat pemetaan permission platform';
  END IF;

  -- ---------------------------------------------------------------- KASUS 2
  -- Isi seed sama dengan yang dijanjikan. Kasus ini ada karena FORCE RLS berlaku
  -- juga bagi app_owner: tanpa pelepasan sesaat di migrasi, INSERT seed
  -- menyisipkan NOL baris dan berhasil tanpa pesan apa pun (migrasi 0018).
  SELECT count(*) INTO n FROM menu_permissions;
  IF n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: pemetaan permission tenant % baris (harus 4)', n;
  END IF;

  -- Setiap pemetaan menunjuk permission yang benar-benar ada di katalog, dan
  -- scopenya cocok dengan context menunya (CHECK + composite FK di 0021).
  SELECT count(*) INTO n
  FROM menu_permissions mp
  JOIN permissions p ON p.code = mp.permission_code AND p.scope = mp.permission_scope
  WHERE mp.context_kind = 'TENANT';
  IF n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: hanya % pemetaan yang cocok dengan katalog', n;
  END IF;

  -- Grup "Administrasi" memang tanpa route dan tanpa pemetaan: ia muncul hanya bila
  -- punya anak yang terlihat. Kalau seed memberinya route, resolver akan
  -- menampilkannya kepada semua orang dan pemangkasan tidak pernah teruji.
  SELECT count(*) INTO n FROM menus m
   WHERE m.code = 'administration' AND m.path IS NULL
     AND NOT EXISTS (SELECT 1 FROM menu_permissions mp WHERE mp.menu_id = m.id);
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: grup administrasi bukan grup tanpa route/tanpa pemetaan';
  END IF;

  -- Dan hanya satu menu yang ditandai terbuka bagi setiap session sah.
  SELECT array_agg(code ORDER BY code) INTO kode FROM menus WHERE is_public_authenticated;
  IF kode IS DISTINCT FROM ARRAY['dashboard'] THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: menu terbuka tanpa permission: %', kode;
  END IF;

  -- ---------------------------------------------------------------- KASUS 3
  -- owner_key terisi dari tenant_id. Seluruh FK hierarki memakainya, jadi kolom
  -- yang salah isi berarti induk lintas tenant menjadi mungkin.
  SELECT count(*) INTO n FROM menus WHERE tenant_id IS NULL AND owner_key IS DISTINCT FROM sentinel;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: % menu platform tanpa owner_key sentinel', n;
  END IF;

  -- Dan hierarki seed memang satu tingkat dengan induk yang ada di scope yang sama.
  SELECT count(*) INTO n
  FROM menus anak
  JOIN menus induk ON induk.owner_key = anak.owner_key AND induk.id = anak.parent_id
  WHERE anak.parent_id IS NOT NULL;
  IF n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: % menu anak yang induknya sah (harus 4)', n;
  END IF;

  -- ---------------------------------------------------------------- KASUS 4
  -- app_user tidak dapat menulis menu, dalam bentuk apa pun.
  --
  -- Diperiksa sebagai HAK TABEL lebih dulu, bukan hanya lewat percobaan. Sebabnya
  -- pelajaran yang sama dengan slice 14 S7: pelanggaran RLS dan hak yang kurang
  -- memakai SQLSTATE yang SAMA (42501), sehingga percobaan INSERT tetap "ditolak"
  -- walau grant-nya diberikan - yang menolak adalah ketiadaan policy, bukan
  -- ketiadaan hak. Ditemukan uji mutasi M7. Dua penjaga, dua pemeriksaan.
  SELECT array_agg(DISTINCT privilege_type ORDER BY privilege_type) INTO kode
  FROM information_schema.role_table_grants
  WHERE grantee = 'app_user' AND table_name IN ('menus', 'menu_permissions');
  IF kode IS DISTINCT FROM ARRAY['SELECT'] THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: app_user punya hak % pada tabel menu', kode;
  END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO menus (tenant_id, code, label, path) VALUES (alpha, 'palsu', 'Palsu', '/dashboard');
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: app_user dapat membuat menu';
  END IF;

  ok := FALSE;
  BEGIN
    UPDATE menus SET label = 'Diubah' WHERE code = 'dashboard';
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: app_user dapat mengubah label menu';
  END IF;

  ok := FALSE;
  BEGIN
    DELETE FROM menus WHERE code = 'dashboard';
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: app_user dapat menghapus menu';
  END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO menu_permissions (tenant_id, menu_id, context_kind, permission_code, permission_scope)
    SELECT alpha, m.id, 'TENANT', 'audit.read', 'TENANT' FROM menus m WHERE m.code = 'dashboard';
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: app_user dapat memetakan permission ke menu';
  END IF;

  -- ---------------------------------------------------------------- KASUS 5
  -- Context platform melihat konsol platform, dan TIDAK melihat navigasi tenant.
  PERFORM set_config('app.current_tenant_id', '', true);
  PERFORM set_config('app.context_kind', 'platform', true);

  SELECT array_agg(code ORDER BY code) INTO kode FROM menus;
  -- platform-tenants sejak migrasi 0025 (D-56).
  IF kode IS DISTINCT FROM ARRAY['platform-admins','platform-support','platform-tenants'] THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: navigasi platform berisi %', kode;
  END IF;

  SELECT count(*) INTO n FROM menu_permissions;
  IF n IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: pemetaan permission platform % baris (harus 3)', n;
  END IF;

  -- ---------------------------------------------------------------- KASUS 6
  -- Context yang TIDAK DISET sama sekali tidak membuka apa pun. app_context_kind()
  -- fail-closed ke 'tenant', jadi tanpa tenant di GUC hasilnya harus menu platform
  -- yang dipublikasikan saja - bukan menu konsol platform, dan bukan menu tenant
  -- mana pun. Inilah yang membuat kelalaian menetapkan context tidak menjadi
  -- kebocoran.
  PERFORM set_config('app.context_kind', '', true);
  SELECT count(*) INTO n FROM menus WHERE context_kind = 'PLATFORM';
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: context kosong membuka % menu konsol platform', n;
  END IF;

  -- ---------------------------------------------------------------- KASUS 7
  -- Menu tenant lain tidak terlihat, walau tenantnya disebut namanya. Seed hanya
  -- memuat menu platform, jadi kasus ini memerlukan satu menu tenant sungguhan -
  -- dan app_user tidak dapat membuatnya. Yang dapat dibuktikan di sini adalah
  -- policy-nya: dibaca dari context Beta, baris milik Alpha harus nol.
  --
  -- Pembuktian penuh (menu tenant yang benar-benar ada dan tidak terlihat dari
  -- tenant lain) ada di lapisan API slice15 #5, tempat koneksi superuser dapat
  -- membuatnya. Dikatakan apa adanya supaya kasus ini tidak dianggap lebih kuat
  -- daripada yang sebenarnya.
  PERFORM set_config('app.current_tenant_id', beta::text, true);
  PERFORM set_config('app.context_kind', 'tenant', true);
  SELECT count(*) INTO n FROM menus WHERE tenant_id = alpha;
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: Beta melihat menu milik Alpha (% baris)', n;
  END IF;

  -- Kontrol: Beta tetap melihat navigasi tenant yang dipublikasikan platform.
  SELECT count(*) INTO n FROM menus WHERE tenant_id IS NULL;
  IF n IS NULL OR n < 6 THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: Beta kehilangan navigasi tenant (% baris)', n;
  END IF;

  RAISE NOTICE 'SEMUA 7 KASUS SLICE 15 LULUS';
END
$$;

ROLLBACK;
