-- slice11_test.sql
-- Dijalankan SEBAGAI app_user. Satu transaksi, selalu ROLLBACK.
--
-- Slice 11 pada lapisan database: role yang diberikan saat undangan diterima
-- (F-12 edisi 2.3, DEMO-0309), invitation_roles, dan versi membership.
--
-- Aturan: perbandingan tahan NULL; penolakan menerima SATU kode error.

\set ON_ERROR_STOP on
\timing off

BEGIN;

SELECT set_config('test.multi_email_bi', :'multi_email_bi', true) AS _bi \gset

DO $$
DECLARE
  alpha        CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  beta         CONSTANT UUID := '22222222-2222-2222-2222-222222222222';
  multi        CONSTANT UUID := 'cccccccc-0000-0000-0000-000000000001';
  m_owner_a    CONSTANT UUID := 'a1a1a1a1-0000-0000-0000-000000000001';
  m_multi_a    CONSTANT UUID := 'a1a1a1a1-0000-0000-0000-000000000003';
  r_user_a     CONSTANT UUID := '9a9a9a9a-0000-0000-0000-000000000003';
  r_auditor_a  CONSTANT UUID := '9a9a9a9a-0000-0000-0000-000000000004';
  r_owner_b    CONSTANT UUID := '9b9b9b9b-0000-0000-0000-000000000001';
  env_ok       CONSTANT BYTEA := '\x01'::bytea || decode(repeat('00', 28), 'hex');
  multi_bi     BYTEA := decode(current_setting('test.multi_email_bi'), 'hex');
  new_bi       CONSTANT BYTEA := sha256('email-baru-slice11'::bytea);
  tok_new      CONSTANT BYTEA := sha256('token-slice11-baru'::bytea);
  tok_multi    CONSTANT BYTEA := sha256('token-slice11-multi'::bytea);
  new_user     CONSTANT UUID := gen_random_uuid();
  archived     UUID := gen_random_uuid();
  label_role   UUID := gen_random_uuid();
  inv_new      UUID;
  inv_multi    UUID;
  v_member     UUID;
  n            INTEGER;
  ok           BOOLEAN;
  v_cols       TEXT;
BEGIN
  IF octet_length(multi_bi) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'KASUS 0 GAGAL: variabel multi_email_bi tidak diberikan runner';
  END IF;

  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  -- Role custom yang akan diarsipkan sebelum undangan diterima.
  INSERT INTO roles (id, tenant_id, code, name) VALUES (archived, alpha, 'r11_arsip', 'Akan diarsipkan');
  INSERT INTO role_permissions (tenant_id, role_id, permission_code) VALUES (alpha, archived, 'audit.read');

  INSERT INTO user_invitations (tenant_id, email_ciphertext, email_key_version, email_blind_index,
                                identity_hint, invited_by_membership_id, token_hash, expires_at)
  VALUES (alpha, env_ok, 1, sha256('bi-s11-baru'::bytea), new_bi, m_owner_a, tok_new, now() + interval '1 day')
  RETURNING id INTO inv_new;
  INSERT INTO invitation_roles (tenant_id, invitation_id, role_id)
  VALUES (alpha, inv_new, r_auditor_a), (alpha, inv_new, archived);

  ----------------------------------------------------------------- 1
  -- Role tenant lain tidak dapat menjadi role undangan (composite FK), dan
  -- context Alpha tidak dapat menulis role undangan untuk Beta (RLS).
  ok := FALSE;
  BEGIN
    INSERT INTO invitation_roles (tenant_id, invitation_id, role_id) VALUES (alpha, inv_new, r_owner_b);
  EXCEPTION WHEN foreign_key_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 1 GAGAL: role Beta menjadi role undangan Alpha'; END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO invitation_roles (tenant_id, invitation_id, role_id) VALUES (beta, inv_new, r_owner_b);
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 1 GAGAL: context Alpha menulis role undangan Beta'; END IF;

  ----------------------------------------------------------------- 2
  -- Role diarsipkan antara undangan dibuat dan diterima: DILEWATI, bukan
  -- menggagalkan penerimaan. Role lain tetap diberikan, atomik bersama membership.
  UPDATE roles SET archived_at = now() WHERE id = archived;

  PERFORM set_config('app.current_tenant_id', '', true);
  ok := auth.create_identity_for_invitation(tok_new, new_user, new_bi, env_ok, 1, 'scrypt$x');
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 2 GAGAL: identitas undangan tidak dibuat'; END IF;
  v_member := auth.accept_invitation(tok_new, new_user, gen_random_uuid(), env_ok, 1, env_ok, 1, sha256('s11c2'::bytea));
  IF v_member IS NULL THEN RAISE EXCEPTION 'KASUS 2 GAGAL: undangan dengan role diarsipkan tidak dapat diterima'; END IF;

  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM user_role_assignments
    WHERE membership_id = v_member AND role_id = r_auditor_a AND ended_at IS NULL
      AND assigned_by_membership_id = m_owner_a;
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 2 GAGAL: role undangan tidak diberikan (atau tanpa pemberi)'; END IF;
  SELECT count(*) INTO n FROM user_role_assignments WHERE membership_id = v_member AND role_id = archived;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 2 GAGAL: role yang diarsipkan tetap diberikan'; END IF;
  SELECT count(*) INTO n FROM effective_permissions WHERE membership_id = v_member AND permission_code = 'members.read';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 2 GAGAL: anggota baru tidak mendapat permission role undangan'; END IF;

  ----------------------------------------------------------------- 3
  -- Undangan yang sudah diterima adalah catatan: role-nya tidak dapat ditambah
  -- atau dihapus lagi.
  ok := FALSE;
  BEGIN
    INSERT INTO invitation_roles (tenant_id, invitation_id, role_id) VALUES (alpha, inv_new, r_user_a);
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 3 GAGAL: role ditambahkan ke undangan yang sudah diterima'; END IF;

  DELETE FROM invitation_roles WHERE invitation_id = inv_new;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 3 GAGAL: role undangan yang sudah diterima dihapus'; END IF;

  ----------------------------------------------------------------- 4
  -- Anggota lama menerima undangan: role yang sudah dipegang tidak digandakan,
  -- role baru ditambahkan.
  INSERT INTO user_invitations (tenant_id, email_ciphertext, email_key_version, email_blind_index,
                                identity_hint, invited_by_membership_id, token_hash, expires_at)
  VALUES (alpha, env_ok, 1, sha256('bi-s11-multi'::bytea), multi_bi, m_owner_a, tok_multi, now() + interval '1 day')
  RETURNING id INTO inv_multi;
  INSERT INTO invitation_roles (tenant_id, invitation_id, role_id)
  VALUES (alpha, inv_multi, r_auditor_a), (alpha, inv_multi, r_user_a);

  PERFORM set_config('app.current_tenant_id', '', true);
  v_member := auth.accept_invitation(tok_multi, multi, gen_random_uuid(), env_ok, 1, env_ok, 1, sha256('s11c4'::bytea));
  IF v_member IS DISTINCT FROM m_multi_a THEN RAISE EXCEPTION 'KASUS 4 GAGAL: anggota lama tidak dipetakan ke membership-nya'; END IF;

  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM user_role_assignments
    WHERE membership_id = m_multi_a AND role_id = r_auditor_a AND ended_at IS NULL;
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 4 GAGAL: role yang sudah dipegang digandakan (%)', n; END IF;
  SELECT count(*) INTO n FROM user_role_assignments
    WHERE membership_id = m_multi_a AND role_id = r_user_a AND ended_at IS NULL;
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 4 GAGAL: role baru dari undangan tidak diberikan'; END IF;

  ----------------------------------------------------------------- 5
  -- Versi membership dapat dinaikkan tenant (optimistic locking), tetapi kolom
  -- identitas membership tidak.
  UPDATE tenant_memberships SET version = version + 1 WHERE id = m_multi_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 5 GAGAL: versi membership tidak dapat dinaikkan'; END IF;

  ok := FALSE;
  BEGIN
    UPDATE tenant_memberships SET user_id = new_user WHERE id = m_multi_a;
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 5 GAGAL: tenant dapat memindahkan membership ke identitas lain'; END IF;

  ok := FALSE;
  BEGIN
    UPDATE tenant_memberships SET version = 0 WHERE id = m_multi_a;
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 5 GAGAL: versi membership dapat diturunkan ke 0'; END IF;

  ----------------------------------------------------------------- 6
  -- Jalur definer hanya membaca kolom yang dibutuhkan fungsi terdaftar (daftar
  -- PERSIS, bukan "minimal ini"): setiap kolom tambahan adalah pelebaran hak yang
  -- harus terlihat di review.
  --
  -- `code` dan `is_system` masuk pada slice 16 karena F-28 mencari role owner dari
  -- KODE-nya - bukan dari id yang tidak diketahui pemanggil. `name` tetap di luar
  -- daftar: ia label yang dibaca manusia, dan jalur definer tidak pernah
  -- membutuhkannya.
  SELECT string_agg(a.attname::text, ',' ORDER BY a.attname) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.roles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('app_auth_definer', a.attrelid, a.attnum, 'SELECT');
  IF v_cols IS DISTINCT FROM 'archived_at,code,id,is_system,tenant_id' THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: app_auth_definer dapat membaca kolom roles: %', v_cols;
  END IF;

  SELECT string_agg(a.attname::text, ',' ORDER BY a.attname) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.user_role_assignments'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('app_auth_definer', a.attrelid, a.attnum, 'SELECT');
  IF v_cols IS DISTINCT FROM 'ended_at,membership_id,role_id,tenant_id' THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: app_auth_definer dapat membaca kolom assignment: %', v_cols;
  END IF;

  SELECT string_agg(a.attname::text, ',' ORDER BY a.attname) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.role_permissions'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('app_auth_definer', a.attrelid, a.attnum, 'SELECT');
  IF v_cols IS NOT NULL THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: app_auth_definer dapat membaca isi role: %', v_cols;
  END IF;

  ----------------------------------------------------------------- 7
  -- D-26: nama role adalah LABEL, bukan tempat data pribadi. Kolomnya tidak
  -- dienkripsi dan tidak di-masking, sementara sejak slice 12 tenant mengetiknya
  -- sendiri lewat layar. Dua bentuk yang pasti salah tempat ditolak DATABASE,
  -- bukan hanya aplikasi: seed dan skrip menulis lewat jalur yang sama.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);

  ok := FALSE;
  BEGIN
    INSERT INTO roles (tenant_id, code, name) VALUES (alpha, 'r11_email', 'budi@contoh.co.id');
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 7 GAGAL: nama role memuat alamat email'; END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO roles (tenant_id, code, name) VALUES (alpha, 'r11_nik', 'Budi 3204012501900001');
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 7 GAGAL: nama role memuat deretan angka identitas'; END IF;

  -- Kontrol: nama label biasa, termasuk yang memuat angka pendek, tetap boleh.
  -- Aturan yang menolak terlalu banyak akan membuat orang mengakalinya.
  INSERT INTO roles (id, tenant_id, code, name)
  VALUES (label_role, alpha, 'r11_label', 'Supervisor Gudang 2 (shift 3)');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 7 GAGAL: nama label biasa ikut ditolak'; END IF;

  -- Mengubah nama role yang sudah ada dijaga aturan yang sama. Dipakai role
  -- buatan di atas, bukan role sistem: role sistem sudah ditolak lebih dulu oleh
  -- policy, sehingga tidak membuktikan apa pun tentang CHECK ini.
  ok := FALSE;
  BEGIN
    UPDATE roles SET name = 'kontak: budi@contoh.co.id' WHERE id = label_role;
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 7 GAGAL: nama role diubah menjadi alamat email'; END IF;

  RAISE NOTICE 'SEMUA 7 KASUS SLICE 11 LULUS';
END
$$;

ROLLBACK;
