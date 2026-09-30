-- slice9_test.sql
-- Dijalankan SEBAGAI app_user.
--
-- D-09 undangan pada lapisan database: yang ditolak database walau kode
-- aplikasi ditulis ulang. Kriptografinya tidak diuji di sini (database tidak
-- memegang kunci); ciphertext dan blind index cukup berbentuk sah.

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- Blind index GLOBAL identitas multi@demo.local, dari runner (lihat slice1).
SELECT set_config('test.multi_email_bi', :'multi_email_bi', true) AS _bi \gset

DO $$
DECLARE
  alpha      CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  beta       CONSTANT UUID := '22222222-2222-2222-2222-222222222222';
  owner_a    CONSTANT UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  multi      CONSTANT UUID := 'cccccccc-0000-0000-0000-000000000001';
  m_owner_a  CONSTANT UUID := 'a1a1a1a1-0000-0000-0000-000000000001';  -- owner Alpha
  m_owner_b  CONSTANT UUID := 'b2b2b2b2-0000-0000-0000-000000000001';  -- owner Beta
  env_ok     CONSTANT BYTEA := '\x01'::bytea || decode(repeat('00', 28), 'hex');
  multi_bi   BYTEA := decode(current_setting('test.multi_email_bi'), 'hex');
  new_bi     CONSTANT BYTEA := sha256('email-baru-slice9'::bytea);  -- belum punya identitas
  tok_multi  CONSTANT BYTEA := sha256('token-multi'::bytea);
  tok_new    CONSTANT BYTEA := sha256('token-baru'::bytea);
  tok_exp    CONSTANT BYTEA := sha256('token-kedaluwarsa'::bytea);
  new_user   CONSTANT UUID := gen_random_uuid();
  inv_multi  UUID;
  inv_new    UUID;
  v_member   UUID;
  n          INTEGER;
  ok         BOOLEAN;
  r          RECORD;
BEGIN
  IF octet_length(multi_bi) IS DISTINCT FROM 32 THEN
    RAISE EXCEPTION 'KASUS 0 GAGAL: variabel multi_email_bi tidak diberikan runner';
  END IF;

  PERFORM set_config('app.current_tenant_id', alpha::text, true);

  INSERT INTO user_invitations (tenant_id, email_ciphertext, email_key_version, email_blind_index,
                                identity_hint, invited_by_membership_id, token_hash, expires_at)
  VALUES (alpha, env_ok, 1, sha256('bi-multi'::bytea), multi_bi, m_owner_a, tok_multi, now() + interval '1 day')
  RETURNING id INTO inv_multi;

  INSERT INTO user_invitations (tenant_id, email_ciphertext, email_key_version, email_blind_index,
                                identity_hint, invited_by_membership_id, token_hash, expires_at)
  VALUES (alpha, env_ok, 1, sha256('bi-baru'::bytea), new_bi, m_owner_a, tok_new, now() + interval '1 day')
  RETURNING id INTO inv_new;

  ----------------------------------------------------------------- 1
  -- Tenant dapat MENULIS hash token dan petunjuk identitas, tetapi tidak pernah
  -- MEMBACANYA. Yang dapat dibaca tenant bocor lewat bug SELECT * mana pun.
  ok := FALSE;
  BEGIN
    PERFORM token_hash FROM user_invitations LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 1 GAGAL: app_user dapat membaca token_hash'; END IF;

  ok := FALSE;
  BEGIN
    PERFORM identity_hint FROM user_invitations LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 1 GAGAL: app_user dapat membaca identity_hint'; END IF;

  ----------------------------------------------------------------- 2
  -- Tenant tidak dapat membuat atau mengubah undangan menjadi ACCEPTED. Kalau
  -- bisa, tenant dapat "menerima" undangan atas nama orang lain.
  ok := FALSE;
  BEGIN
    UPDATE user_invitations SET status = 'ACCEPTED' WHERE id = inv_new;
  -- HANYA insufficient_privilege (policy RLS). CHECK status/accepted_membership_id
  -- juga akan menolak, tetapi itu lapisan kedua; menerima check_violation di sini
  -- membuat tes lulus walau policy-nya dilonggarkan (mutasi S5, audit D-09).
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 2 GAGAL: tenant dapat menandai undangan ACCEPTED'; END IF;

  ok := FALSE;
  BEGIN
    UPDATE user_invitations SET accepted_membership_id = m_owner_a WHERE id = inv_new;
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 2 GAGAL: tenant dapat mengisi accepted_membership_id'; END IF;

  ----------------------------------------------------------------- 3
  -- Isolasi: Beta tidak melihat undangan Alpha, tidak dapat menulis undangan
  -- Alpha, dan pengundang harus membership tenant yang sama (composite FK).
  PERFORM set_config('app.current_tenant_id', beta::text, true);
  SELECT count(*) INTO n FROM user_invitations WHERE id IN (inv_multi, inv_new);
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 3 GAGAL: Beta melihat % undangan Alpha', n; END IF;

  UPDATE user_invitations SET status = 'REVOKED' WHERE id = inv_new;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 3 GAGAL: Beta mencabut undangan Alpha'; END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO user_invitations (tenant_id, email_ciphertext, email_key_version, email_blind_index,
                                  identity_hint, invited_by_membership_id, token_hash, expires_at)
    VALUES (alpha, env_ok, 1, sha256('x3'::bytea), new_bi, m_owner_a, sha256('t3'::bytea), now() + interval '1 day');
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 3 GAGAL: Beta dapat menulis undangan untuk Alpha'; END IF;

  ok := FALSE;
  BEGIN
    -- Undangan Beta dengan pengundang dari Alpha.
    INSERT INTO user_invitations (tenant_id, email_ciphertext, email_key_version, email_blind_index,
                                  identity_hint, invited_by_membership_id, token_hash, expires_at)
    VALUES (beta, env_ok, 1, sha256('x3b'::bytea), new_bi, m_owner_a, sha256('t3b'::bytea), now() + interval '1 day');
  EXCEPTION WHEN foreign_key_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 3 GAGAL: pengundang lintas tenant tidak ditolak composite FK'; END IF;

  PERFORM set_config('app.current_tenant_id', alpha::text, true);

  ----------------------------------------------------------------- 4
  -- Satu undangan PENDING per email per tenant; setelah dicabut, boleh lagi.
  ok := FALSE;
  BEGIN
    INSERT INTO user_invitations (tenant_id, email_ciphertext, email_key_version, email_blind_index,
                                  identity_hint, invited_by_membership_id, token_hash, expires_at)
    VALUES (alpha, env_ok, 1, sha256('bi-baru'::bytea), new_bi, m_owner_a, sha256('t4'::bytea), now() + interval '1 day');
  EXCEPTION WHEN unique_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 4 GAGAL: dua undangan PENDING untuk email yang sama'; END IF;

  ----------------------------------------------------------------- 5
  -- Bentuk: masa berlaku maksimal 7 hari; plaintext di kolom ciphertext ditolak.
  ok := FALSE;
  BEGIN
    INSERT INTO user_invitations (tenant_id, email_ciphertext, email_key_version, email_blind_index,
                                  identity_hint, invited_by_membership_id, token_hash, expires_at)
    VALUES (alpha, env_ok, 1, sha256('x5'::bytea), new_bi, m_owner_a, sha256('t5'::bytea), now() + interval '8 days');
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 5 GAGAL: undangan 8 hari diterima'; END IF;

  ok := FALSE;
  BEGIN
    INSERT INTO user_invitations (tenant_id, email_ciphertext, email_key_version, email_blind_index,
                                  identity_hint, invited_by_membership_id, token_hash, expires_at)
    VALUES (alpha, convert_to('orang@contoh.test', 'UTF8'), 1, sha256('x5b'::bytea), new_bi, m_owner_a,
            sha256('t5b'::bytea), now() + interval '1 day');
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 5 GAGAL: email plaintext diterima di kolom ciphertext'; END IF;

  ----------------------------------------------------------------- 6
  -- F-11: hanya undangan PENDING yang belum kedaluwarsa, dicari lewat hash token.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM auth.find_invitation_for_acceptance(sha256('palsu'::bytea));
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 6 GAGAL: hash palsu menemukan undangan'; END IF;

  SELECT * INTO r FROM auth.find_invitation_for_acceptance(tok_new);
  IF r.invitation_id IS DISTINCT FROM inv_new OR r.tenant_id IS DISTINCT FROM alpha
     OR r.identity_hint IS DISTINCT FROM new_bi THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: F-11 tidak menemukan undangan yang sah';
  END IF;

  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  INSERT INTO user_invitations (tenant_id, email_ciphertext, email_key_version, email_blind_index,
                                identity_hint, invited_by_membership_id, token_hash, expires_at)
  VALUES (alpha, env_ok, 1, sha256('bi-exp'::bytea), new_bi, m_owner_a, tok_exp, now() + interval '1 second');
  PERFORM pg_sleep(1.2);
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM auth.find_invitation_for_acceptance(tok_exp);
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 6 GAGAL: undangan kedaluwarsa masih dapat diterima'; END IF;

  ----------------------------------------------------------------- 7
  -- F-16: identitas baru hanya untuk email undangan, dan hanya sekali.
  ok := auth.create_identity_for_invitation(tok_new, new_user, sha256('email-lain'::bytea), env_ok, 1, 'scrypt$x');
  IF ok IS NOT FALSE THEN RAISE EXCEPTION 'KASUS 7 GAGAL: identitas dibuat untuk email yang BUKAN email undangan'; END IF;

  ok := auth.create_identity_for_invitation(tok_new, new_user, multi_bi, env_ok, 1, 'scrypt$x');
  IF ok IS NOT FALSE THEN RAISE EXCEPTION 'KASUS 7 GAGAL: email yang sudah punya identitas dibuat ulang'; END IF;

  ok := auth.create_identity_for_invitation(tok_new, new_user, new_bi, env_ok, 1, 'scrypt$x');
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'KASUS 7 GAGAL: identitas untuk email undangan tidak dibuat'; END IF;

  ok := auth.create_identity_for_invitation(tok_new, gen_random_uuid(), new_bi, env_ok, 1, 'scrypt$x');
  IF ok IS NOT FALSE THEN RAISE EXCEPTION 'KASUS 7 GAGAL: identitas kedua untuk email yang sama dibuat'; END IF;

  ----------------------------------------------------------------- 8
  -- F-12: identitas LAIN tidak dapat menerima undangan orang lain.
  v_member := auth.accept_invitation(tok_new, owner_a, gen_random_uuid(), env_ok, 1, env_ok, 1, sha256('c8'::bytea));
  IF v_member IS NOT NULL THEN RAISE EXCEPTION 'KASUS 8 GAGAL: owner Alpha menerima undangan untuk email lain'; END IF;

  ----------------------------------------------------------------- 9
  -- F-12: penerimaan atomik - membership + profil + status undangan.
  v_member := auth.accept_invitation(tok_new, new_user, gen_random_uuid(), env_ok, 1, env_ok, 1, sha256('c9'::bytea));
  IF v_member IS NULL THEN RAISE EXCEPTION 'KASUS 9 GAGAL: pemilik email undangan tidak dapat menerima'; END IF;

  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM tenant_memberships m
    JOIN tenant_member_profiles p ON p.membership_id = m.id
    WHERE m.id = v_member AND m.user_id = new_user AND m.status = 'ACTIVE';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 9 GAGAL: membership + profil tidak terbentuk (%)', n; END IF;

  SELECT count(*) INTO n FROM user_invitations
    WHERE id = inv_new AND status = 'ACCEPTED' AND accepted_membership_id = v_member;
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 9 GAGAL: undangan tidak ditandai ACCEPTED'; END IF;

  ----------------------------------------------------------------- 10
  -- Sekali pakai: token yang sama tidak menerima dua kali, dan tidak lagi
  -- ditemukan F-11. Tenant tidak dapat mencabut undangan yang sudah diterima.
  PERFORM set_config('app.current_tenant_id', '', true);
  v_member := auth.accept_invitation(tok_new, new_user, gen_random_uuid(), env_ok, 1, env_ok, 1, sha256('c10'::bytea));
  IF v_member IS NOT NULL THEN RAISE EXCEPTION 'KASUS 10 GAGAL: token undangan dipakai dua kali'; END IF;
  SELECT count(*) INTO n FROM auth.find_invitation_for_acceptance(tok_new);
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 10 GAGAL: undangan yang sudah diterima masih ditemukan F-11'; END IF;

  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  UPDATE user_invitations SET status = 'REVOKED' WHERE id = inv_new;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 10 GAGAL: undangan ACCEPTED dapat dicabut'; END IF;

  ----------------------------------------------------------------- 11
  -- Anggota yang sudah aktif menerima undangan: tidak ada profil kedua, dan
  -- undangan ditandai diterima dengan membership yang sudah ada.
  PERFORM set_config('app.current_tenant_id', '', true);
  v_member := auth.accept_invitation(tok_multi, multi, gen_random_uuid(), env_ok, 1, env_ok, 1, sha256('c11'::bytea));
  IF v_member IS DISTINCT FROM 'a1a1a1a1-0000-0000-0000-000000000003'::uuid THEN
    RAISE EXCEPTION 'KASUS 11 GAGAL: anggota lama tidak dipetakan ke membership lamanya (%)', v_member;
  END IF;
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM tenant_member_profiles WHERE membership_id = v_member;
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 11 GAGAL: profil anggota lama berjumlah %', n; END IF;

  ----------------------------------------------------------------- 12
  -- Membership dari undangan tidak membawa permission apa pun sampai diberi role
  -- (default-deny, AC DEMO-0210). Sejak slice 10 (D-21 lunas) hak mengundang
  -- adalah permission, bukan penanda is_owner - kolomnya sudah tidak ada.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM effective_permissions ep
    JOIN tenant_memberships m ON m.id = ep.membership_id
    WHERE m.user_id = new_user;
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 12 GAGAL: anggota baru dari undangan punya % permission', n; END IF;

  SELECT count(*) INTO n FROM information_schema.columns
    WHERE table_name = 'tenant_memberships' AND column_name = 'is_owner';
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'KASUS 12 GAGAL: penanda is_owner masih ada'; END IF;

  ----------------------------------------------------------------- 13
  -- Membership yang ditangguhkan TIDAK dihidupkan lewat undangan. Kalau bisa,
  -- anggota yang di-suspend cukup minta diundang ulang (atau owner lain
  -- mengundangnya) untuk melewati penangguhan.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  INSERT INTO user_invitations (tenant_id, email_ciphertext, email_key_version, email_blind_index,
                                identity_hint, invited_by_membership_id, token_hash, expires_at)
  VALUES (alpha, env_ok, 1, sha256('bi-multi'::bytea), multi_bi, m_owner_a, sha256('token-multi-2'::bytea), now() + interval '1 day');
  UPDATE tenant_memberships SET status = 'SUSPENDED' WHERE id = 'a1a1a1a1-0000-0000-0000-000000000003';

  PERFORM set_config('app.current_tenant_id', '', true);
  v_member := auth.accept_invitation(sha256('token-multi-2'::bytea), multi, gen_random_uuid(), env_ok, 1, env_ok, 1, sha256('c13'::bytea));
  IF v_member IS NOT NULL THEN RAISE EXCEPTION 'KASUS 13 GAGAL: undangan menghidupkan membership yang ditangguhkan'; END IF;

  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM tenant_memberships
    WHERE id = 'a1a1a1a1-0000-0000-0000-000000000003' AND status = 'SUSPENDED';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 13 GAGAL: status membership berubah'; END IF;
  SELECT count(*) INTO n FROM user_invitations WHERE email_blind_index = sha256('bi-multi'::bytea) AND status = 'PENDING';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'KASUS 13 GAGAL: undangan yang ditolak ditandai terpakai'; END IF;

  RAISE NOTICE 'SEMUA 13 KASUS SLICE 9 LULUS';
END
$$;

ROLLBACK;
