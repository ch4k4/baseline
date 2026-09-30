-- slice10_test.sql
-- Dijalankan SEBAGAI app_user. Satu transaksi, selalu ROLLBACK.
--
-- RBAC pada lapisan database (DEMO-0301 s.d. 0303): katalog, role, assignment,
-- dan resolver permission efektif. Yang diuji di sini adalah yang ditolak
-- database walau kode aplikasi ditulis ulang: batas tenant, permission platform,
-- role sistem, keunikan assignment aktif, dan hasil resolver.
--
-- Aturan: perbandingan memakai IS DISTINCT FROM / IS NOT TRUE (tahan NULL).
-- Penolakan menerima SATU kode error yang dimaksud, bukan beberapa: kode kedua
-- bisa datang dari lapis lain yang menutupi kerusakan (audit D-09, mutasi S5).

\set ON_ERROR_STOP on
\timing off

BEGIN;

DO $$
DECLARE
  alpha        CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  beta         CONSTANT UUID := '22222222-2222-2222-2222-222222222222';
  m_owner_a    CONSTANT UUID := 'a1a1a1a1-0000-0000-0000-000000000001';
  m_user_a     CONSTANT UUID := 'a1a1a1a1-0000-0000-0000-000000000002';
  m_multi_a    CONSTANT UUID := 'a1a1a1a1-0000-0000-0000-000000000003';
  role_owner_a CONSTANT UUID := '9a9a9a9a-0000-0000-0000-000000000001';
  role_owner_b CONSTANT UUID := '9b9b9b9b-0000-0000-0000-000000000001';
  custom       UUID := gen_random_uuid();
  custom2      UUID := gen_random_uuid();
  v_asg        UUID;
  n            INTEGER;
  ok           BOOLEAN;
  codes        TEXT[];
BEGIN
  ----------------------------------------------------------------- 1
  -- Katalog terbaca seluruhnya, tanpa context tenant, dan tidak dapat ditulis.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM permissions WHERE scope = 'TENANT';
  IF n IS DISTINCT FROM 16 THEN RAISE EXCEPTION 'KASUS 1 GAGAL: % permission tenant, harus 16', n; END IF;
  SELECT count(*) INTO n FROM permissions WHERE scope = 'PLATFORM' AND code LIKE 'platform.%';
  IF n IS DISTINCT FROM 16 THEN RAISE EXCEPTION 'KASUS 1 GAGAL: % permission platform, harus 16', n; END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO permissions (code, scope, description) VALUES ('members.everything', 'TENANT', 'x');
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 1 GAGAL: tenant dapat menambah permission ke katalog'; END IF;

  ok := FALSE;
  BEGIN
    UPDATE permissions SET scope = 'TENANT' WHERE code = 'platform.tenants.read';
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 1 GAGAL: tenant dapat mengubah katalog permission'; END IF;

  ----------------------------------------------------------------- 2
  -- Permission platform tidak dapat dipasang ke role tenant: ditolak FK
  -- (code, scope), bukan hanya validasi aplikasi.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  INSERT INTO roles (id, tenant_id, code, name) VALUES (custom, alpha, 'r10_custom', 'Custom 10');

  ok := FALSE;
  BEGIN
    INSERT INTO role_permissions (tenant_id, role_id, permission_code) VALUES (alpha, custom, 'platform.tenants.read');
  EXCEPTION WHEN foreign_key_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 2 GAGAL: permission platform terpasang ke role tenant'; END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO role_permissions (tenant_id, role_id, permission_code) VALUES (alpha, custom, 'members.everything');
  EXCEPTION WHEN foreign_key_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 2 GAGAL: permission di luar katalog terpasang'; END IF;

  ----------------------------------------------------------------- 3
  -- Role sistem tidak dapat diubah tenant: nama, arsip, isi permission; dan
  -- tenant tidak dapat membuat role sistem.
  UPDATE roles SET name = 'Diambil alih' WHERE id = role_owner_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 3 GAGAL: nama role sistem dapat diubah tenant'; END IF;

  UPDATE roles SET archived_at = now() WHERE id = role_owner_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 3 GAGAL: role sistem dapat diarsipkan tenant'; END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO roles (tenant_id, code, name, is_system) VALUES (alpha, 'r10_palsu', 'Palsu', true);
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 3 GAGAL: tenant dapat membuat role sistem'; END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO role_permissions (tenant_id, role_id, permission_code)
      VALUES (alpha, '9a9a9a9a-0000-0000-0000-000000000003', 'members.invite');  -- tenant_user
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 3 GAGAL: tenant dapat menambah permission ke role sistem'; END IF;

  DELETE FROM role_permissions WHERE role_id = role_owner_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 3 GAGAL: tenant dapat mengosongkan role sistem'; END IF;

  ----------------------------------------------------------------- 4
  -- Batas tenant: role Beta tidak dapat diberikan di Alpha (composite FK), baris
  -- untuk tenant lain ditolak RLS, dan Beta tidak melihat apa pun milik Alpha.
  ok := FALSE;
  BEGIN
    INSERT INTO user_role_assignments (tenant_id, membership_id, role_id) VALUES (alpha, m_user_a, role_owner_b);
  EXCEPTION WHEN foreign_key_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 4 GAGAL: role Beta diberikan kepada anggota Alpha'; END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO user_role_assignments (tenant_id, membership_id, role_id)
      VALUES (beta, 'b2b2b2b2-0000-0000-0000-000000000002', role_owner_b);
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 4 GAGAL: context Alpha menulis assignment untuk Beta'; END IF;

  PERFORM set_config('app.current_tenant_id', beta::text, true);
  SELECT count(*) INTO n FROM roles WHERE tenant_id <> beta;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 4 GAGAL: Beta melihat % role tenant lain', n; END IF;
  SELECT count(*) INTO n FROM user_role_assignments WHERE tenant_id <> beta;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 4 GAGAL: Beta melihat % assignment tenant lain', n; END IF;
  SELECT count(*) INTO n FROM effective_permissions WHERE tenant_id <> beta;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 4 GAGAL: Beta melihat % permission efektif tenant lain', n; END IF;
  SELECT count(*) INTO n FROM role_permissions WHERE tenant_id <> beta;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 4 GAGAL: Beta melihat isi role tenant lain'; END IF;
  -- Dan Beta memang melihat miliknya sendiri (kalau nol, kasus di atas tidak bermakna).
  SELECT count(*) INTO n FROM roles;
  IF n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'KASUS 4 GAGAL: Beta melihat % role miliknya, harus 4', n; END IF;

  ----------------------------------------------------------------- 5
  -- Satu assignment AKTIF per membership + role; riwayat boleh berulang; yang
  -- sudah berakhir tidak dapat dihidupkan kembali.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  INSERT INTO user_role_assignments (tenant_id, membership_id, role_id)
    VALUES (alpha, m_user_a, custom) RETURNING id INTO v_asg;

  ok := FALSE;
  BEGIN
    INSERT INTO user_role_assignments (tenant_id, membership_id, role_id) VALUES (alpha, m_user_a, custom);
  EXCEPTION WHEN unique_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 5 GAGAL: dua assignment aktif untuk role yang sama'; END IF;

  UPDATE user_role_assignments SET ended_at = now() WHERE id = v_asg;
  INSERT INTO user_role_assignments (tenant_id, membership_id, role_id) VALUES (alpha, m_user_a, custom);
  SELECT count(*) INTO n FROM user_role_assignments WHERE membership_id = m_user_a AND role_id = custom;
  IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'KASUS 5 GAGAL: riwayat assignment tidak dapat berulang (%)', n; END IF;

  UPDATE user_role_assignments SET ended_at = NULL WHERE id = v_asg;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 5 GAGAL: assignment yang berakhir dihidupkan kembali'; END IF;

  ----------------------------------------------------------------- 6
  -- Hasil resolver untuk akun seed. Tidak ada permission platform di mana pun.
  SELECT array_agg(permission_code ORDER BY permission_code) INTO codes
    FROM effective_permissions WHERE membership_id = m_user_a;
  IF codes IS DISTINCT FROM ARRAY['menus.read', 'profile.read', 'profile.update']::text[] THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: tenant_user punya %', codes;
  END IF;

  SELECT count(*) INTO n FROM effective_permissions WHERE membership_id = m_owner_a;
  IF n IS DISTINCT FROM 16 THEN RAISE EXCEPTION 'KASUS 6 GAGAL: tenant_owner punya % permission, harus 16', n; END IF;

  -- Penanda owner (D-28) hanya di role tenant_owner: role lain yang memegangnya
  -- membuat anti-eskalasi tidak lagi melindungi pemegang role owner.
  SELECT array_agg(role_id::text) INTO codes FROM role_permissions
    WHERE tenant_id = alpha AND permission_code = 'owners.manage';
  IF codes IS DISTINCT FROM ARRAY[role_owner_a::text] THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: owners.manage dipegang role %', codes;
  END IF;

  SELECT count(*) INTO n FROM effective_permissions WHERE membership_id = m_multi_a AND permission_code = 'members.read';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 6 GAGAL: auditor tidak dapat membaca anggota'; END IF;
  SELECT count(*) INTO n FROM effective_permissions WHERE membership_id = m_multi_a AND permission_code = 'members.invite';
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 6 GAGAL: auditor dapat mengundang'; END IF;

  SELECT count(*) INTO n FROM effective_permissions WHERE permission_code LIKE 'platform.%';
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 6 GAGAL: % permission platform efektif di tenant', n; END IF;

  ----------------------------------------------------------------- 7
  -- Deduplikasi: permission yang datang dari dua role muncul sekali.
  INSERT INTO role_permissions (tenant_id, role_id, permission_code) VALUES (alpha, custom, 'profile.read');
  SELECT count(*) INTO n FROM effective_permissions WHERE membership_id = m_user_a AND permission_code = 'profile.read';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 7 GAGAL: permission ganda muncul % kali', n; END IF;

  ----------------------------------------------------------------- 8
  -- Role yang diarsipkan kehilangan akses, tetapi riwayatnya tetap.
  INSERT INTO role_permissions (tenant_id, role_id, permission_code) VALUES (alpha, custom, 'members.read');
  SELECT count(*) INTO n FROM effective_permissions WHERE membership_id = m_user_a AND permission_code = 'members.read';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 8 GAGAL: permission role custom tidak berlaku'; END IF;

  UPDATE roles SET archived_at = now(), version = version + 1, updated_at = now() WHERE id = custom;
  SELECT count(*) INTO n FROM effective_permissions WHERE membership_id = m_user_a AND permission_code = 'members.read';
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 8 GAGAL: role yang diarsipkan masih memberi akses'; END IF;
  SELECT count(*) INTO n FROM user_role_assignments WHERE role_id = custom;
  IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'KASUS 8 GAGAL: arsip menghapus riwayat assignment'; END IF;

  ----------------------------------------------------------------- 9
  -- Assignment yang diakhiri mencabut permission-nya saat itu juga.
  INSERT INTO roles (id, tenant_id, code, name) VALUES (custom2, alpha, 'r10_custom2', 'Custom 10b');
  INSERT INTO role_permissions (tenant_id, role_id, permission_code) VALUES (alpha, custom2, 'audit.read');
  INSERT INTO user_role_assignments (tenant_id, membership_id, role_id)
    VALUES (alpha, m_user_a, custom2) RETURNING id INTO v_asg;
  SELECT count(*) INTO n FROM effective_permissions WHERE membership_id = m_user_a AND permission_code = 'audit.read';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 9 GAGAL: assignment baru tidak berlaku'; END IF;
  UPDATE user_role_assignments SET ended_at = now() WHERE id = v_asg;
  SELECT count(*) INTO n FROM effective_permissions WHERE membership_id = m_user_a AND permission_code = 'audit.read';
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 9 GAGAL: assignment yang berakhir masih memberi akses'; END IF;

  ----------------------------------------------------------------- 10
  -- Membership yang ditangguhkan tidak punya permission, walau role-nya aktif.
  UPDATE tenant_memberships SET status = 'SUSPENDED' WHERE id = m_multi_a;
  SELECT count(*) INTO n FROM effective_permissions WHERE membership_id = m_multi_a;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 10 GAGAL: anggota ditangguhkan punya % permission', n; END IF;

  ----------------------------------------------------------------- 11
  -- Tanpa context tenant: tidak ada role, assignment, maupun permission efektif.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM effective_permissions;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 11 GAGAL: % permission efektif tanpa context', n; END IF;
  SELECT count(*) INTO n FROM roles;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 11 GAGAL: % role terlihat tanpa context', n; END IF;

  ----------------------------------------------------------------- 12
  -- Resolver berjalan dengan hak PEMANGGIL. Tanpa security_invoker, view memakai
  -- hak pemiliknya; hasil kasus 4 dan 11 lalu bergantung pada pemilik, bukan RLS.
  SELECT count(*) INTO n FROM pg_class
    WHERE relname = 'effective_permissions' AND 'security_invoker=true' = ANY (reloptions);
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 12 GAGAL: effective_permissions tanpa security_invoker'; END IF;

  ----------------------------------------------------------------- 13
  -- Setiap rujukan ke role memuat tenant_id (composite FK), di ketiga tabel.
  SELECT count(*) INTO n FROM pg_constraint c
    WHERE c.contype = 'f' AND c.confrelid = 'roles'::regclass
      AND c.conrelid IN ('role_permissions'::regclass, 'user_role_assignments'::regclass, 'invitation_roles'::regclass)
      AND array_length(c.conkey, 1) = 2
      AND c.confkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'roles'::regclass AND attname = 'tenant_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'roles'::regclass AND attname = 'id')]::int2[];
  IF n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'KASUS 13 GAGAL: % dari 3 FK ke roles memuat tenant_id', n; END IF;

  RAISE NOTICE 'SEMUA 13 KASUS SLICE 10 LULUS';
END
$$;

ROLLBACK;
