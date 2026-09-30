-- 0001_roles.sql
-- Dijalankan sebagai SUPERUSER (postgres), satu kali per database.
-- Membuat tiga role sesuai Infrastructure SSOT sec.8.3 / ADR-001 sec.3.7 (Opsi A).
--
--   app_owner         : pemilik tabel, menjalankan migrasi. Tidak dipakai runtime.
--   app_auth_definer  : pemilik fungsi SECURITY DEFINER pre-context.
--                       NOLOGIN, NOBYPASSRLS, BUKAN pemilik tabel.
--   app_user          : role runtime aplikasi. NOBYPASSRLS, bukan member definer.
--
-- Ganti password di bawah lewat variabel psql:
--   psql -v owner_pw='...' -v user_pw='...' -f 0001_roles.sql

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    CREATE ROLE app_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auth_definer') THEN
    CREATE ROLE app_auth_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE app_owner PASSWORD :'owner_pw';
ALTER ROLE app_user  PASSWORD :'user_pw';

-- app_owner menjadi member app_auth_definer HANYA agar migrasi dapat memindahkan
-- kepemilikan fungsi (ALTER FUNCTION ... OWNER TO). app_owner tidak dipakai runtime;
-- aplikasi selalu terhubung sebagai app_user.
GRANT app_auth_definer TO app_owner;

-- app_user TIDAK boleh menjadi member app_auth_definer (tidak bisa SET ROLE).
-- Baris ini defensif: mencabut keanggotaan bila pernah diberikan.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.roleid
    JOIN pg_roles g ON g.oid = m.member
    WHERE r.rolname = 'app_auth_definer' AND g.rolname = 'app_user'
  ) THEN
    REVOKE app_auth_definer FROM app_user;
  END IF;
END
$$;

-- Schema publik: cabut hak default PUBLIC. Tabel tinggal di sini.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT  USAGE ON SCHEMA public TO app_owner, app_auth_definer, app_user;
GRANT  CREATE ON SCHEMA public TO app_owner;

-- Schema auth: rumah fungsi SECURITY DEFINER (Lampiran A F-01..F-15).
-- Dimiliki app_auth_definer agar fungsi di dalamnya dapat berpindah kepemilikan
-- tanpa memberi app_auth_definer hak CREATE di schema public.
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION app_auth_definer;
REVOKE ALL   ON SCHEMA auth FROM PUBLIC;
GRANT  USAGE ON SCHEMA auth TO app_user, app_owner;

ALTER DATABASE :"db_name" OWNER TO app_owner;
