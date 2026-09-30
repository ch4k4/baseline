-- 0007_context_functions.sql
-- Dijalankan sebagai app_owner (member app_auth_definer; lihat 0001).
--
-- Fungsi pre-context tambahan untuk pemilihan dan perpindahan context.
-- Register Lampiran A: F-05 (buat tiket), F-06 (konsumsi tiket), F-09 (cabut session).

\set ON_ERROR_STOP on

-- F-05 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.create_selection_ticket(
  p_user_id     UUID,
  p_token_hash  BYTEA,
  p_ttl_seconds INTEGER DEFAULT 300
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_ttl_seconds < 1 OR p_ttl_seconds > 300 THEN
    RAISE EXCEPTION 'TTL tiket di luar batas (1..300 detik): %', p_ttl_seconds
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO auth_selection_tickets (user_id, token_hash, expires_at)
  VALUES (p_user_id, p_token_hash, now() + make_interval(secs => p_ttl_seconds))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- F-06 -------------------------------------------------------------------------
-- Konsumsi tiket. Sekali pakai ditegakkan oleh UPDATE berkondisi dalam satu
-- pernyataan: dua permintaan bersamaan, hanya satu yang mendapat baris.
-- Memeriksa dulu lalu meng-update kemudian akan membuka celah balapan.
CREATE OR REPLACE FUNCTION auth.consume_selection_ticket(p_token_hash BYTEA)
RETURNS TABLE (user_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE auth_selection_tickets t
  SET consumed_at = now()
  WHERE t.token_hash = p_token_hash
    AND t.consumed_at IS NULL
    AND t.expires_at > now()
  RETURNING t.user_id;
$$;

-- F-09 -------------------------------------------------------------------------
-- Cabut session. Dipakai saat berpindah tenant: session lama harus mati sebelum
-- yang baru dipakai, supaya token lama tidak terus berlaku di tenant lama.
CREATE OR REPLACE FUNCTION auth.revoke_session(
  p_session_id UUID,
  p_reason     VARCHAR DEFAULT 'CONTEXT_SWITCH'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE sessions
  SET status = 'REVOKED', revoked_at = now(), revocation_reason = p_reason
  WHERE id = p_session_id AND revoked_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- F-04b ------------------------------------------------------------------------
-- Apakah identitas ini benar-benar anggota aktif tenant tersebut.
-- Dipakai sebelum membuat session hasil pemilihan/perpindahan context. Tanpa ini,
-- tiket yang sah bisa dipakai menunjuk tenant mana pun.
CREATE OR REPLACE FUNCTION auth.find_membership(p_user_id UUID, p_tenant_id UUID)
RETURNS TABLE (membership_id UUID, tenant_slug VARCHAR, tenant_name VARCHAR)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT m.id, t.slug, t.name
  FROM tenant_memberships m
  JOIN tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id
    AND m.tenant_id = p_tenant_id
    AND m.status = 'ACTIVE'
    AND t.status = 'ACTIVE';
$$;

-- grant untuk pencabutan --------------------------------------------------------
-- UPDATE diberikan PER KOLOM. Dengan begitu fungsi pencabutan hanya dapat
-- mencabut; ia tidak dapat memindahkan session ke tenant lain walaupun kode di
-- dalamnya nanti berubah atau salah tulis.
GRANT UPDATE (status, revoked_at, revocation_reason) ON sessions TO app_auth_definer;

CREATE POLICY definer_update ON sessions
  FOR UPDATE TO app_auth_definer USING (true) WITH CHECK (true);

-- kepemilikan + hak eksekusi -----------------------------------------------------

ALTER FUNCTION auth.create_selection_ticket(UUID, BYTEA, INTEGER) OWNER TO app_auth_definer;
ALTER FUNCTION auth.consume_selection_ticket(BYTEA)               OWNER TO app_auth_definer;
ALTER FUNCTION auth.revoke_session(UUID, VARCHAR)                 OWNER TO app_auth_definer;
ALTER FUNCTION auth.find_membership(UUID, UUID)                   OWNER TO app_auth_definer;

REVOKE ALL ON FUNCTION auth.create_selection_ticket(UUID, BYTEA, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.consume_selection_ticket(BYTEA)               FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.revoke_session(UUID, VARCHAR)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.find_membership(UUID, UUID)                   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth.create_selection_ticket(UUID, BYTEA, INTEGER) TO app_user;
GRANT EXECUTE ON FUNCTION auth.consume_selection_ticket(BYTEA)               TO app_user;
GRANT EXECUTE ON FUNCTION auth.revoke_session(UUID, VARCHAR)                 TO app_user;
GRANT EXECUTE ON FUNCTION auth.find_membership(UUID, UUID)                   TO app_user;
