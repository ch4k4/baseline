-- 0016_audit_event_catalog.sql
-- Dijalankan sebagai app_owner.
--
-- D-30 (keputusan pemilik proyek 2026-09-23): allowlist nama event audit.
--
-- Lampiran A mewajibkan penulis audit menolak action di luar allowlist. Daftar
-- itu ditaruh di DATABASE sebagai katalog, ditegakkan foreign key dari
-- audit_logs, bukan sebagai daftar di badan F-14. Alasannya: hari ini F-14
-- memang satu-satunya penulis (app_user tidak punya INSERT ke audit_logs, tes
-- slice 6 kasus 6), tetapi Lampiran A sudah merencanakan penulis kedua (F-15,
-- event support ke audit tenant). Aturan yang dipasang di tabel berlaku untuk
-- setiap penulis, termasuk yang ditambahkan nanti.
--
-- Isinya = Demo Foundation sec.15 (edisi 2.4), termasuk nama yang fiturnya
-- belum dibuat (tenant, platform, support, menu). Kode aplikasi memegang daftar
-- yang sama di src/auth/audit-events.ts; tes slice 6 membandingkan keduanya.
--
-- Catatan: kegagalan menulis audit tidak menggagalkan operasi yang diauditnya
-- (AuditService menelan error). Karena itu nama yang salah ketik TIDAK terlihat
-- saat runtime - yang menangkapnya adalah tipe TypeScript dan tes, bukan pengguna.
-- Aturan penulisan: ASCII murni.

\set ON_ERROR_STOP on

CREATE TABLE audit_event_types (
  code        VARCHAR(64)  PRIMARY KEY,
  description VARCHAR(200) NOT NULL,
  retired_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT audit_event_types_code_ck CHECK (code ~ '^[a-z_]+(\.[a-z_]+)+$')
);

COMMENT ON TABLE audit_event_types IS
  'Katalog nama event audit (Demo Foundation sec.15). Hasil ada di kolom outcome, bukan di nama.';

INSERT INTO audit_event_types (code, description) VALUES
  ('auth.login',                  'Login: SUCCESS atau FAILURE dengan reason code'),
  ('auth.login.context_required', 'Identitas lintas tenant: tiket pemilihan context diterbitkan'),
  ('auth.login.throttled',        'Percobaan login ditolak rate limiting'),
  ('auth.select_context',         'Penukaran tiket dengan session pada satu tenant'),
  ('auth.context_switch',         'Perpindahan tenant tanpa password'),
  ('auth.refresh',                'Rotasi refresh token'),
  ('auth.refresh.reuse_detected', 'Refresh token dipakai ulang; seluruh family dicabut'),
  ('auth.logout',                 'Session dicabut atas permintaan pemiliknya'),
  ('identity.created',            'Identitas global baru dibuat saat menerima undangan'),
  ('tenant.created',              'Tenant baru dibuat platform'),
  ('tenant.status_changed',       'Status tenant diubah platform'),
  ('platform.admin_granted',      'Hak admin platform diberikan'),
  ('platform.admin_revoked',      'Hak admin platform dicabut'),
  ('platform.identity_suspended', 'Identitas global ditangguhkan platform'),
  ('platform.identity_unlocked',  'Identitas global dibuka kuncinya platform'),
  ('support.session.started',     'Support session break-glass dimulai'),
  ('support.session.ended',       'Support session berakhir'),
  ('support.session.revoked',     'Support session dicabut sebelum berakhir'),
  ('support.data_revealed',       'Field DP-1 dibuka dalam support session'),
  ('support.mutation',            'Mutasi dalam support session READ_WRITE'),
  ('invitation.created',          'Undangan anggota dibuat atau diperbarui'),
  ('invitation.revoked',          'Undangan dicabut'),
  ('invitation.accepted',         'Undangan diterima; membership terbentuk'),
  ('member.profile_updated',      'Profil anggota tenant diubah'),
  ('member.suspended',            'Anggota tenant ditangguhkan'),
  ('member.reactivated',          'Anggota tenant diaktifkan kembali'),
  ('member.roles_replaced',       'Role anggota tenant diganti'),
  ('role.created',                'Role tenant dibuat'),
  ('role.updated',                'Role tenant diubah'),
  ('role.archived',               'Role tenant diarsipkan'),
  ('role.permissions_replaced',   'Isi permission sebuah role diganti'),
  ('menu.created',                'Menu dibuat'),
  ('menu.updated',                'Menu diubah'),
  ('menu.archived',               'Menu diarsipkan'),
  ('menu.permissions_replaced',   'Permission sebuah menu diganti'),
  ('authz.denied',                'Permintaan ditolak guard: permission, method, pola route');

ALTER TABLE audit_event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event_types FORCE  ROW LEVEL SECURITY;
GRANT SELECT ON audit_event_types TO app_user;
-- Katalog bukan data tenant: seluruh baris terbaca, tetapi hanya dibaca.
-- Tidak ada GRANT INSERT/UPDATE/DELETE untuk siapa pun; penambahan nama event
-- adalah migrasi, sama seperti katalog permission.
CREATE POLICY catalog_read ON audit_event_types FOR SELECT TO app_user USING (true);

-- Penegakan: setiap baris audit, ditulis fungsi definer mana pun, wajib memakai
-- nama yang ada di katalog.
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_event_type_fkey
  FOREIGN KEY (event_type) REFERENCES audit_event_types (code);
