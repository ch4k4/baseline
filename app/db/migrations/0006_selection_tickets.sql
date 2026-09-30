-- 0006_selection_tickets.sql
-- Dijalankan sebagai app_owner.
--
-- Tiket pemilihan context (ADR-002, DEMO-0211).
--
-- Masalah yang dipecahkan: identitas yang punya akses ke lebih dari satu tenant
-- belum boleh menerima session apa pun sebelum memilih tenant. Tapi ia sudah
-- membuktikan kepemilikan password, dan bukti itu tidak boleh dibuang - kalau
-- dibuang, pengguna harus memasukkan password dua kali.
--
-- Tiket adalah kredensial sementara yang HANYA bisa dipakai untuk satu hal:
-- menukar dirinya dengan session pada tenant yang memang miliknya.
--
-- Sifat yang ditegakkan di sini, bukan di kode aplikasi:
--   - sekali pakai         -> consumed_at, di-update atomik oleh F-06
--   - berumur pendek       -> expires_at, maksimum 5 menit (CHECK)
--   - tidak dapat ditebak  -> yang disimpan hash, bukan token mentah
--   - tidak terikat tenant -> justru karena tenant belum dipilih

\set ON_ERROR_STOP on

CREATE TABLE auth_selection_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  BYTEA NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  CONSTRAINT auth_selection_tickets_ttl_ck
    CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '5 minutes')
);

CREATE INDEX auth_selection_tickets_user_idx ON auth_selection_tickets (user_id);

ALTER TABLE auth_selection_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_selection_tickets FORCE  ROW LEVEL SECURITY;

-- app_user tidak mendapat grant apa pun. Satu-satunya jalan masuk adalah fungsi
-- SECURITY DEFINER di 0007 - sama seperti users dan credentials.
GRANT SELECT, INSERT, UPDATE ON auth_selection_tickets TO app_auth_definer;

CREATE POLICY definer_read   ON auth_selection_tickets FOR SELECT TO app_auth_definer USING (true);
CREATE POLICY definer_insert ON auth_selection_tickets FOR INSERT TO app_auth_definer WITH CHECK (true);
CREATE POLICY definer_update ON auth_selection_tickets FOR UPDATE TO app_auth_definer USING (true) WITH CHECK (true);
