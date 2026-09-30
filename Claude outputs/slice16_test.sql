-- slice16_test.sql
-- Dijalankan SEBAGAI app_user. Satu transaksi, selalu ROLLBACK.
--
-- Slice 16 pada lapisan database: siapa yang boleh MEMBUAT tenant, dan siapa yang
-- boleh membaca template role.
--
-- Kasus 1 lahir dari uji mutasi P8: melepas syarat `app_context_kind() = 'platform'`
-- dari policy platform_insert TIDAK menggagalkan satu tes pun, padahal akibatnya
-- setiap session tenant dapat membuat tenant baru. Tes API tidak dapat menangkapnya -
-- ia selalu memanggil endpoint platform, yang memang berjalan di context platform.
-- Yang dapat menangkapnya hanya pemeriksaan pada lapisan ini.
--
-- Aturan: perbandingan tahan NULL; penolakan menerima SATU kode error.

\set ON_ERROR_STOP on
\timing off

BEGIN;

DO $$
DECLARE
  alpha CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  n     INTEGER;
  kode  TEXT[];
BEGIN
  -- ---------------------------------------------------------------- KASUS 1
  -- Context TENANT tidak dapat membuat tenant, dan tidak dapat mengubah statusnya.
  -- Keduanya jalur pengambilalihan: tenant yang dapat membuat tenant dapat membuat
  -- dirinya tetangga baru, dan tenant yang dapat mengubah status dapat menghidupkan
  -- kembali tenant yang sengaja disuspend platform.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  PERFORM set_config('app.context_kind', 'tenant', true);

  BEGIN
    INSERT INTO tenants (id, slug, name, status)
    VALUES (gen_random_uuid(), 'uji-ambil-alih', 'Uji Ambil Alih', 'PROVISIONING');
    RAISE EXCEPTION 'KASUS 1 GAGAL: context tenant berhasil membuat tenant';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;   -- 42501: policy platform_insert menolak
  END;

  UPDATE tenants SET status = 'SUSPENDED' WHERE id = alpha;
  IF (SELECT status FROM tenants WHERE id = alpha) IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: context tenant mengubah status tenantnya sendiri';
  END IF;

  -- ---------------------------------------------------------------- KASUS 2
  -- Template role adalah katalog platform: TIDAK terbaca dari context tenant.
  -- Kalau terbaca, tenant mengetahui bentuk role bawaan seluruh platform - dan
  -- lebih penting, batas "katalog platform" berhenti berarti.
  SELECT count(*) INTO n FROM role_templates;
  IF n <> 0 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: context tenant membaca % baris role_templates', n;
  END IF;
  SELECT count(*) INTO n FROM role_template_permissions;
  IF n <> 0 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: context tenant membaca % baris template permission', n;
  END IF;

  -- Dari context platform, katalognya terbaca - jadi nol baris di atas memang karena
  -- policy, bukan karena tabelnya kosong.
  PERFORM set_config('app.context_kind', 'platform', true);
  SELECT count(*) INTO n FROM role_templates;
  IF n <> 4 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: context platform melihat % template (harus 4)', n;
  END IF;
  SELECT count(*) INTO n FROM role_template_permissions;
  IF n <> 24 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: context platform melihat % pemetaan template (harus 24)', n;
  END IF;

  -- Dan isinya cocok dengan katalog permission: template yang menunjuk permission
  -- platform akan ditolak foreign key, tetapi template yang menunjuk permission yang
  -- SUDAH PENSIUN tidak - jadi diperiksa di sini.
  SELECT count(*) INTO n
  FROM role_template_permissions tp
  JOIN permissions p ON p.code = tp.permission_code AND p.scope = tp.permission_scope
  WHERE p.retired_at IS NULL;
  IF n <> 24 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: hanya % pemetaan template menunjuk permission aktif', n;
  END IF;

  -- ---------------------------------------------------------------- KASUS 3
  -- Hak tulis katalog TIDAK ada untuk siapa pun di runtime - diubah lewat migrasi.
  -- Diperiksa dari information_schema, bukan dengan mencoba INSERT: RLS dan grant
  -- yang kurang memakai SQLSTATE yang sama (42501), jadi percobaan INSERT akan lulus
  -- walau grantnya diberikan (pelajaran slice 14 dan M7 slice 15).
  --
  -- Dibaca dari pg_catalog (aclexplode), BUKAN dari information_schema: view
  -- information_schema hanya menampilkan hak yang boleh DILIHAT pemanggil, dan
  -- app_user bukan anggota app_auth_definer - sehingga hak peran definer selalu
  -- tampak kosong dari sini. Versi pertama kasus 4 lulus/gagal karena sebab itu,
  -- bukan karena hak yang diuji.
  SELECT array_agg(DISTINCT x.privilege_type ORDER BY x.privilege_type) INTO kode
  FROM pg_class c, aclexplode(c.relacl) x
  WHERE c.relname IN ('role_templates', 'role_template_permissions')
    AND x.grantee::regrole::text IN ('app_user', 'app_auth_definer');
  IF kode IS DISTINCT FROM ARRAY['SELECT'] THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: hak tabel pada katalog template = %', kode;
  END IF;

  -- Grant kolom untuk peran definer (F-27 membacanya) juga hanya SELECT.
  SELECT array_agg(DISTINCT x.privilege_type ORDER BY x.privilege_type) INTO kode
  FROM pg_attribute a, aclexplode(a.attacl) x
  WHERE a.attrelid IN ('role_templates'::regclass, 'role_template_permissions'::regclass)
    AND x.grantee::regrole::text IN ('app_user', 'app_auth_definer');
  IF kode IS NOT NULL AND kode IS DISTINCT FROM ARRAY['SELECT'] THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: hak kolom pada katalog template = %', kode;
  END IF;

  -- ---------------------------------------------------------------- KASUS 4
  -- crypto_keys tetap TERTUTUP untuk app_user - termasuk sesudah slice ini menambah
  -- jalur tulis lewat F-26. Yang mendapat hak tulis hanyalah peran definer.
  SELECT array_agg(DISTINCT x.privilege_type ORDER BY x.privilege_type) INTO kode
  FROM pg_class c, aclexplode(c.relacl) x
  WHERE c.relname = 'crypto_keys' AND x.grantee::regrole::text = 'app_user';
  IF kode IS NOT NULL THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: app_user punya hak tabel % pada crypto_keys', kode;
  END IF;

  SELECT array_agg(DISTINCT x.privilege_type ORDER BY x.privilege_type) INTO kode
  FROM pg_attribute a, aclexplode(a.attacl) x
  WHERE a.attrelid = 'crypto_keys'::regclass AND x.grantee::regrole::text = 'app_user';
  IF kode IS NOT NULL THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: app_user punya hak kolom % pada crypto_keys', kode;
  END IF;

  -- Peran definer: BOLEH membaca (F-24/F-25) dan menulis (F-26) - dan hanya itu.
  SELECT array_agg(DISTINCT x.privilege_type ORDER BY x.privilege_type) INTO kode
  FROM pg_attribute a, aclexplode(a.attacl) x
  WHERE a.attrelid = 'crypto_keys'::regclass AND x.grantee::regrole::text = 'app_auth_definer';
  IF kode IS DISTINCT FROM ARRAY['INSERT', 'SELECT'] THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: hak kolom peran definer pada crypto_keys = %', kode;
  END IF;

  -- ---------------------------------------------------------------- KASUS 5
  -- Tenant yang dibuat platform TIDAK terlihat oleh tenant lain, termasuk saat
  -- statusnya masih PROVISIONING. Dibuktikan dengan membaca dari context tenant
  -- Alpha: yang terlihat hanya barisnya sendiri.
  PERFORM set_config('app.context_kind', 'tenant', true);
  SELECT count(*) INTO n FROM tenants;
  IF n <> 1 THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: context tenant melihat % baris tenants (harus 1)', n;
  END IF;

  RAISE NOTICE 'SEMUA 5 KASUS SLICE 16 LULUS';
END $$;

ROLLBACK;
