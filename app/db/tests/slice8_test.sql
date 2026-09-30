-- slice8_test.sql
-- Dijalankan SEBAGAI app_user.
--
-- D-01 pada lapisan database: bukan kriptografinya (database tidak pernah
-- memegang kunci), melainkan bentuk yang DITOLAK database walau kode aplikasi
-- ditulis ulang - plaintext yang menyelinap ke kolom ciphertext, blind index
-- berukuran salah, duplikat email dalam satu tenant, dan kunci tenant yang
-- diminta dari luar context-nya.

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- Setiap pemeriksaan ditulis tahan NULL: IS DISTINCT FROM, IS NOT TRUE, IS NOT FALSE.

DO $$
DECLARE
  alpha      CONSTANT UUID := '11111111-1111-1111-1111-111111111111';
  beta       CONSTANT UUID := '22222222-2222-2222-2222-222222222222';
  owner_a    CONSTANT UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  -- Envelope bentuk sah (versi 1 + 28 byte) tanpa isi bermakna: database hanya
  -- memeriksa BENTUK, dan itu yang diuji di sini.
  env_ok     CONSTANT BYTEA := '\x01'::bytea || decode(repeat('00', 28), 'hex');
  bi_ok      CONSTANT BYTEA := sha256('blind-index-uji-baru'::bytea);
  n          INTEGER;
  v_member   UUID;
  v_bi_alpha BYTEA;
  v_bi_beta  BYTEA;
  r          RECORD;
  ok         BOOLEAN;
BEGIN
  ----------------------------------------------------------------- 1
  -- DEK terbungkus hanya lewat fungsi. Tidak ada jalur SELECT langsung.
  ok := FALSE;
  BEGIN
    EXECUTE 'SELECT count(*) FROM crypto_keys';
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 1 GAGAL: app_user dapat membaca crypto_keys langsung';
  END IF;

  ----------------------------------------------------------------- 2
  -- Kunci platform tersedia tanpa tenant context (login terjadi sebelum tenant
  -- diketahui) dan berbentuk DEK terbungkus, bukan kunci mentah 32 byte.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT * INTO r FROM auth.get_active_key('platform_identity_blind_index', NULL);
  IF r.key_version IS DISTINCT FROM 1 OR octet_length(r.wrapped_dek) IS DISTINCT FROM 61 THEN
    RAISE EXCEPTION 'KASUS 2 GAGAL: kunci platform tidak tersedia atau berbentuk salah (%, % byte)',
      r.key_version, octet_length(r.wrapped_dek);
  END IF;

  ----------------------------------------------------------------- 3
  -- Kunci tenant HANYA diserahkan di dalam context tenant pemiliknya.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT count(*) INTO n FROM auth.get_active_key('identity', alpha);
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: kunci Alpha tidak tersedia di context Alpha';
  END IF;

  SELECT count(*) INTO n FROM auth.get_active_key('identity', beta);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: kunci Beta diserahkan di context Alpha';
  END IF;

  SELECT count(*) INTO n FROM auth.get_key_version('identity_blind_index', beta, 1);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: versi kunci Beta diserahkan di context Alpha';
  END IF;

  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM auth.get_active_key('identity', alpha);
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 3 GAGAL: kunci tenant diserahkan tanpa context';
  END IF;

  ----------------------------------------------------------------- 4
  -- Tidak ada kolom plaintext yang tersisa. Kolom lama yang "lupa dihapus"
  -- adalah cara paling umum enkripsi field berakhir sebagai enkripsi setengah.
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (table_name, column_name) IN (('users', 'email'),
                                      ('tenant_member_profiles', 'display_name'),
                                      ('tenant_member_profiles', 'contact_email'));
  IF n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'KASUS 4 GAGAL: % kolom plaintext masih ada', n;
  END IF;

  -- Persiapan kasus 5-8: membership baru tanpa profil di Beta, milik identitas
  -- yang sebelumnya hanya anggota Alpha. Semua di-ROLLBACK di akhir berkas.
  PERFORM set_config('app.current_tenant_id', alpha::text, true);
  SELECT contact_email_blind_index INTO v_bi_alpha
  FROM tenant_member_profiles LIMIT 1;

  PERFORM set_config('app.current_tenant_id', beta::text, true);
  SELECT contact_email_blind_index INTO v_bi_beta
  FROM tenant_member_profiles LIMIT 1;
  INSERT INTO tenant_memberships (tenant_id, user_id) VALUES (beta, owner_a)
  RETURNING id INTO v_member;

  IF v_bi_alpha IS NULL OR v_bi_beta IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: persiapan tidak lengkap (seed belum berjalan?)';
  END IF;

  ----------------------------------------------------------------- 5
  -- PLAINTEXT DI KOLOM CIPHERTEXT DITOLAK. Ini penjaga terakhir kalau suatu saat
  -- ada kode yang menulis nama apa adanya, melewati crypto adapter.
  ok := FALSE;
  BEGIN
    INSERT INTO tenant_member_profiles (
      tenant_id, membership_id,
      display_name_ciphertext, display_name_key_version,
      contact_email_ciphertext, contact_email_key_version, contact_email_blind_index)
    VALUES (beta, v_member, convert_to('Nama Polos Tanpa Enkripsi', 'UTF8'), 1, env_ok, 1, bi_ok);
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 5 GAGAL: plaintext diterima di kolom ciphertext';
  END IF;

  ----------------------------------------------------------------- 6
  -- Blind index berukuran salah ditolak (HMAC-SHA-256 selalu 32 byte).
  ok := FALSE;
  BEGIN
    INSERT INTO tenant_member_profiles (
      tenant_id, membership_id,
      display_name_ciphertext, display_name_key_version,
      contact_email_ciphertext, contact_email_key_version, contact_email_blind_index)
    VALUES (beta, v_member, env_ok, 1, env_ok, 1, decode(repeat('ab', 16), 'hex'));
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 6 GAGAL: blind index 16 byte diterima';
  END IF;

  ----------------------------------------------------------------- 7
  -- Email kontak unik PER TENANT: blind index yang sama dengan anggota Beta
  -- lain ditolak di Beta.
  ok := FALSE;
  BEGIN
    INSERT INTO tenant_member_profiles (
      tenant_id, membership_id,
      display_name_ciphertext, display_name_key_version,
      contact_email_ciphertext, contact_email_key_version, contact_email_blind_index)
    VALUES (beta, v_member, env_ok, 1, env_ok, 1, v_bi_beta);
  EXCEPTION WHEN unique_violation THEN ok := TRUE;
  END;
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'KASUS 7 GAGAL: email kontak ganda dalam satu tenant diterima';
  END IF;

  ----------------------------------------------------------------- 8
  -- ...tapi keunikan itu tidak melintasi tenant. Nilai yang sama milik Alpha
  -- diterima di Beta - dan karena kuncinya per tenant, email yang sama di dua
  -- tenant memang tidak pernah menghasilkan nilai yang sama.
  BEGIN
    INSERT INTO tenant_member_profiles (
      tenant_id, membership_id,
      display_name_ciphertext, display_name_key_version,
      contact_email_ciphertext, contact_email_key_version, contact_email_blind_index)
    VALUES (beta, v_member, env_ok, 1, env_ok, 1, v_bi_alpha);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: keunikan email kontak berlaku lintas tenant (harusnya per tenant)';
  END;

  SELECT count(*) INTO n FROM tenant_member_profiles WHERE membership_id = v_member;
  IF n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'KASUS 8 GAGAL: profil dengan blind index milik tenant lain tidak tersimpan';
  END IF;

  RAISE NOTICE 'SEMUA 8 KASUS SLICE 8 LULUS';
END
$$;

ROLLBACK;
