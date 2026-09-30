-- 0008_audit_logs.sql
-- Dijalankan sebagai app_owner.
--
-- Audit log (DEMO-0110, Lampiran A F-14).
--
-- Mixed-ownership: tenant_id NULL untuk kejadian pre-context dan platform.
-- Login yang gagal memang belum tahu tenant mana - dan seringkali belum tahu
-- siapa. Memaksa tenant_id NOT NULL akan membuat justru kejadian yang paling
-- perlu dicatat tidak dapat dicatat.
--
-- DUA KEPUTUSAN YANG MENENTUKAN SEGALANYA DI SINI:
--
-- 1. TIDAK ADA email, token, atau password di tabel ini. Yang disimpan hanya
--    hash identifier. Inilah yang membuat audit dapat disimpan 12 bulan tanpa
--    berbenturan dengan hak penghapusan data pribadi: tidak ada data pribadi
--    untuk dihapus. Kalau email masuk ke sini, seluruh kebijakan retensi harus
--    dirombak.
--
-- 2. Append-only, ditegakkan dengan mencabut UPDATE dan DELETE dari SEMUA role
--    aplikasi. Audit yang bisa diubah oleh kode yang diauditnya bukan audit.

\set ON_ERROR_STOP on

CREATE TABLE audit_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- clock_timestamp(), BUKAN now(). now() mengembalikan waktu MULAI TRANSAKSI,
  -- sehingga seluruh kejadian dalam satu transaksi mendapat stempel yang persis
  -- sama - dan urutan antar kejadian menjadi tidak dapat ditentukan. Untuk audit,
  -- yang dicatat harus waktu kejadian, bukan waktu transaksi dibuka.
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  tenant_id             UUID NULL REFERENCES tenants (id),
  event_type            VARCHAR(64) NOT NULL,
  outcome               VARCHAR(16) NOT NULL,
  actor_user_id         UUID NULL REFERENCES users (id) ON DELETE SET NULL,
  actor_session_id      UUID NULL,
  -- Hash identifier yang dipakai saat percobaan (mis. email dinormalisasi).
  -- Dipakai untuk menghitung percobaan gagal tanpa pernah menyimpan emailnya.
  actor_identifier_hash BYTEA NULL,
  subject_type          VARCHAR(64) NULL,
  subject_id            UUID NULL,
  detail                JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_logs_outcome_ck CHECK (outcome IN ('SUCCESS', 'FAILURE'))
);

CREATE INDEX audit_logs_tenant_time_idx ON audit_logs (tenant_id, occurred_at DESC);
CREATE INDEX audit_logs_event_time_idx  ON audit_logs (event_type, occurred_at DESC);

-- Index untuk penghitungan percobaan gagal: hanya baris yang relevan yang masuk,
-- sehingga tabel audit yang membesar tidak memperlambat setiap login.
CREATE INDEX audit_logs_failure_idx
  ON audit_logs (actor_identifier_hash, occurred_at DESC)
  WHERE outcome = 'FAILURE' AND actor_identifier_hash IS NOT NULL;

-- Pasangannya: mencari keberhasilan terakhir, karena login yang berhasil
-- menihilkan hitungan kegagalan sebelumnya.
CREATE INDEX audit_logs_success_idx
  ON audit_logs (actor_identifier_hash, occurred_at DESC)
  WHERE outcome = 'SUCCESS' AND actor_identifier_hash IS NOT NULL;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE  ROW LEVEL SECURITY;

-- app_user boleh MEMBACA baris tenant aktifnya (untuk audit viewer nanti),
-- tetapi tidak boleh menulis apa pun. Penulisan hanya lewat F-14.
GRANT SELECT ON audit_logs TO app_user;
GRANT SELECT, INSERT ON audit_logs TO app_auth_definer;

-- Append-only ditegakkan di sini. Tanpa baris ini, pemilik tabel dan siapa pun
-- yang mendapat grant nanti dapat menghapus jejaknya sendiri.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_user, app_auth_definer;

CREATE POLICY tenant_scope ON audit_logs FOR SELECT TO app_user
  USING (tenant_id = app_current_tenant());

CREATE POLICY definer_read   ON audit_logs FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_insert ON audit_logs FOR INSERT TO app_auth_definer WITH CHECK (true);
