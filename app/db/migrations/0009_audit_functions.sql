-- 0009_audit_functions.sql
-- Dijalankan sebagai app_owner (member app_auth_definer; lihat 0001).
--
-- F-14 penulis audit, dan penghitung percobaan gagal untuk rate limiting.
--
-- Keduanya SECURITY DEFINER karena harus bekerja pada kejadian pre-context:
-- login yang gagal belum punya tenant, dan justru itu yang paling perlu dicatat
-- dan dibatasi.

\set ON_ERROR_STOP on

-- F-14 -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.write_audit_event(
  p_event_type            VARCHAR,
  p_outcome               VARCHAR,
  p_tenant_id             UUID    DEFAULT NULL,
  p_actor_user_id         UUID    DEFAULT NULL,
  p_actor_session_id      UUID    DEFAULT NULL,
  p_actor_identifier_hash BYTEA   DEFAULT NULL,
  p_subject_type          VARCHAR DEFAULT NULL,
  p_subject_id            UUID    DEFAULT NULL,
  p_detail                JSONB   DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Penjaga terakhir terhadap kebocoran data pribadi ke audit. Kode aplikasi
  -- seharusnya tidak pernah mengirim kunci ini; kalau toh terjadi, ditolak di
  -- sini, bukan diam-diam tersimpan selama 12 bulan.
  IF p_detail ?| ARRAY['email', 'password', 'token', 'ticket', 'password_hash'] THEN
    RAISE EXCEPTION 'detail audit memuat kunci terlarang (email/password/token/ticket)'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO audit_logs (
    event_type, outcome, tenant_id, actor_user_id, actor_session_id,
    actor_identifier_hash, subject_type, subject_id, detail
  )
  VALUES (
    p_event_type, p_outcome, p_tenant_id, p_actor_user_id, p_actor_session_id,
    p_actor_identifier_hash, p_subject_type, p_subject_id, COALESCE(p_detail, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- penghitung percobaan gagal ------------------------------------------------------
-- Rate limiting berbasis data yang sudah ada, bukan penghitung di memori.
-- Alasannya: penghitung di memori hilang saat proses dimulai ulang, dan
-- "restart untuk membuka kunci" bukan sifat yang diinginkan dari rate limit.
CREATE OR REPLACE FUNCTION auth.count_recent_failures(
  p_identifier_hash BYTEA,
  p_window_seconds  INTEGER DEFAULT 300,
  p_event_type      VARCHAR DEFAULT 'auth.login'
)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  -- Hanya kegagalan SETELAH keberhasilan terakhir yang dihitung.
  --
  -- Tanpa aturan ini, orang yang salah ketik beberapa kali lalu berhasil masuk
  -- tetap membawa hitungan itu, dan bisa terkunci pada percobaan berikutnya
  -- yang sah. Menihilkan hitungan setelah keberhasilan adalah praktik umum dan
  -- tidak melemahkan apa pun: siapa pun yang berhasil masuk sudah di dalam.
  SELECT count(*)::int
  FROM audit_logs a
  WHERE a.actor_identifier_hash = p_identifier_hash
    AND a.outcome = 'FAILURE'
    AND a.event_type = p_event_type
    AND a.occurred_at > clock_timestamp() - make_interval(secs => p_window_seconds)
    AND a.occurred_at > COALESCE(
      (SELECT max(s.occurred_at) FROM audit_logs s
        WHERE s.actor_identifier_hash = p_identifier_hash
          AND s.outcome = 'SUCCESS'
          AND s.event_type = p_event_type),
      '-infinity'::timestamptz);
$$;

ALTER FUNCTION auth.write_audit_event(VARCHAR, VARCHAR, UUID, UUID, UUID, BYTEA, VARCHAR, UUID, JSONB)
  OWNER TO app_auth_definer;
ALTER FUNCTION auth.count_recent_failures(BYTEA, INTEGER, VARCHAR) OWNER TO app_auth_definer;

REVOKE ALL ON FUNCTION auth.write_audit_event(VARCHAR, VARCHAR, UUID, UUID, UUID, BYTEA, VARCHAR, UUID, JSONB)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.count_recent_failures(BYTEA, INTEGER, VARCHAR) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth.write_audit_event(VARCHAR, VARCHAR, UUID, UUID, UUID, BYTEA, VARCHAR, UUID, JSONB)
  TO app_user;
GRANT EXECUTE ON FUNCTION auth.count_recent_failures(BYTEA, INTEGER, VARCHAR) TO app_user;
