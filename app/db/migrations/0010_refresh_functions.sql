-- 0010_refresh_functions.sql
-- Dijalankan sebagai app_owner (member app_auth_definer; lihat 0001).
--
-- Rotasi refresh token dan deteksi pemakaian ulang (DEMO-0204, F-09/F-10).
--
-- GAGASAN INTINYA:
-- Refresh token hanya boleh dipakai SEKALI. Setiap pemakaian menukarnya dengan
-- token baru dalam "family" yang sama. Kalau sebuah token yang SUDAH dirotasi
-- dipakai lagi, hanya ada dua kemungkinan: token itu dicuri, atau salinan lama
-- masih beredar. Keduanya berbahaya, dan responsnya sama - seluruh family dan
-- session-nya dicabut. Pencuri terusir, pemilik sah diminta masuk lagi.
--
-- Deteksi ini hanya bekerja kalau rotasi ATOMIK. Memeriksa dulu lalu menulis
-- kemudian membuka celah: dua permintaan bersamaan sama-sama lolos pemeriksaan,
-- dan pemakaian ulang yang sesungguhnya lolos sebagai "kebetulan bersamaan".
-- Karena itu barisnya dikunci SELECT ... FOR UPDATE.

\set ON_ERROR_STOP on

-- F-09a: terbitkan refresh token pertama untuk sebuah session -----------------
CREATE OR REPLACE FUNCTION auth.create_refresh_token(
  p_session_id   UUID,
  p_tenant_id    UUID,
  p_context_kind VARCHAR,
  p_token_hash   BYTEA,
  p_ttl_seconds  INTEGER DEFAULT 2592000
)
RETURNS TABLE (token_id UUID, family_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_family UUID := gen_random_uuid();
  v_id     UUID;
BEGIN
  INSERT INTO refresh_tokens (
    context_kind, tenant_id, session_id, token_hash, family_id, expires_at
  )
  VALUES (
    p_context_kind, p_tenant_id, p_session_id, p_token_hash, v_family,
    clock_timestamp() + make_interval(secs => p_ttl_seconds)
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_family;
END;
$$;

-- F-10: rotasi + deteksi pemakaian ulang ---------------------------------------
-- status: ROTATED | REUSE | EXPIRED | INVALID | SESSION_GONE
CREATE OR REPLACE FUNCTION auth.rotate_refresh_token(
  p_old_hash    BYTEA,
  p_new_hash    BYTEA,
  p_ttl_seconds INTEGER DEFAULT 2592000
)
RETURNS TABLE (
  status       VARCHAR,
  session_id   UUID,
  tenant_id    UUID,
  context_kind VARCHAR,
  family_id    UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  rec    refresh_tokens%ROWTYPE;
  v_new  UUID;
BEGIN
  -- FOR UPDATE menahan permintaan kedua sampai yang pertama selesai. Tanpa ini,
  -- dua pemakaian bersamaan atas token yang sama sama-sama dinyatakan sah.
  SELECT * INTO rec FROM refresh_tokens t
  WHERE t.token_hash = p_old_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'INVALID'::varchar, NULL::uuid, NULL::uuid, NULL::varchar, NULL::uuid;
    RETURN;
  END IF;

  -- Sudah pernah dirotasi atau sudah dicabut: ini pemakaian ulang.
  IF rec.rotated_at IS NOT NULL OR rec.revoked_at IS NOT NULL THEN
    PERFORM auth.revoke_token_family(rec.family_id, 'REUSE_DETECTED');
    RETURN QUERY SELECT 'REUSE'::varchar, rec.session_id, rec.tenant_id,
                        rec.context_kind, rec.family_id;
    RETURN;
  END IF;

  IF rec.expires_at <= clock_timestamp() THEN
    RETURN QUERY SELECT 'EXPIRED'::varchar, rec.session_id, rec.tenant_id,
                        rec.context_kind, rec.family_id;
    RETURN;
  END IF;

  -- Refresh token yang sah TIDAK menghidupkan kembali session yang sudah mati.
  -- Kalau pemeriksaan ini hanya ada di kode aplikasi, keluar dari satu tab dan
  -- merotasi dari tab lain akan mencetak access token baru untuk session yang
  -- sudah dicabut. Karena itu syaratnya ditegakkan di sini.
  PERFORM 1 FROM sessions s
  WHERE s.id = rec.session_id
    AND s.revoked_at IS NULL
    AND s.expires_at > clock_timestamp();

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'SESSION_GONE'::varchar, rec.session_id, rec.tenant_id,
                        rec.context_kind, rec.family_id;
    RETURN;
  END IF;

  INSERT INTO refresh_tokens (
    context_kind, tenant_id, session_id, token_hash, family_id, expires_at
  )
  VALUES (
    rec.context_kind, rec.tenant_id, rec.session_id, p_new_hash, rec.family_id,
    clock_timestamp() + make_interval(secs => p_ttl_seconds)
  )
  RETURNING id INTO v_new;

  UPDATE refresh_tokens
  SET rotated_at = clock_timestamp(), replaced_by_id = v_new
  WHERE id = rec.id;

  RETURN QUERY SELECT 'ROTATED'::varchar, rec.session_id, rec.tenant_id,
                      rec.context_kind, rec.family_id;
END;
$$;

-- pencabutan satu family beserta session-nya ------------------------------------
CREATE OR REPLACE FUNCTION auth.revoke_token_family(
  p_family_id UUID,
  p_reason    VARCHAR DEFAULT 'REUSE_DETECTED'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE refresh_tokens
  SET revoked_at = clock_timestamp()
  WHERE family_id = p_family_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Mencabut token saja tidak cukup: access token yang sudah terbit tetap
  -- berlaku sampai kedaluwarsa kalau session-nya dibiarkan hidup.
  UPDATE sessions
  SET status = 'REVOKED', revoked_at = clock_timestamp(), revocation_reason = p_reason
  WHERE id IN (SELECT DISTINCT session_id FROM refresh_tokens WHERE family_id = p_family_id)
    AND revoked_at IS NULL;

  RETURN v_count;
END;
$$;

-- grant ---------------------------------------------------------------------------
GRANT UPDATE (rotated_at, replaced_by_id, revoked_at) ON refresh_tokens TO app_auth_definer;

ALTER FUNCTION auth.create_refresh_token(UUID, UUID, VARCHAR, BYTEA, INTEGER) OWNER TO app_auth_definer;
ALTER FUNCTION auth.rotate_refresh_token(BYTEA, BYTEA, INTEGER)               OWNER TO app_auth_definer;
ALTER FUNCTION auth.revoke_token_family(UUID, VARCHAR)                        OWNER TO app_auth_definer;

REVOKE ALL ON FUNCTION auth.create_refresh_token(UUID, UUID, VARCHAR, BYTEA, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.rotate_refresh_token(BYTEA, BYTEA, INTEGER)               FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.revoke_token_family(UUID, VARCHAR)                        FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth.create_refresh_token(UUID, UUID, VARCHAR, BYTEA, INTEGER) TO app_user;
GRANT EXECUTE ON FUNCTION auth.rotate_refresh_token(BYTEA, BYTEA, INTEGER)               TO app_user;
GRANT EXECUTE ON FUNCTION auth.revoke_token_family(UUID, VARCHAR)                        TO app_user;
