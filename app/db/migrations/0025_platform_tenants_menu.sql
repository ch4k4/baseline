-- 0025_platform_tenants_menu.sql
-- Dijalankan sebagai app_owner.
--
-- Menu "Tenant" di konsol platform (D-56): layar registry tenant, tempat tenant
-- disuspend dan diaktifkan kembali (D-47).
--
-- Navigasi web tidak punya daftar menu sendiri sejak slice 15 - menu yang tidak ada
-- di tabel ini tidak muncul di layar. Karena itu menunya lahir bersama halamannya,
-- bukan sebelumnya (KerangkaPlatform.tsx).
--
-- Syarat lihatnya platform.tenants.read, sama dengan GET /platform/tenants. Tombol
-- suspend/reactivate di halaman itu dijaga platform.tenants.update_status oleh API,
-- bukan oleh menu: menu hanya menentukan apa yang terlihat.

\set ON_ERROR_STOP on

BEGIN;

-- menus dan menu_permissions FORCE RLS sejak 0021, dan pemiliknya pun tunduk padanya.
-- Dibuka hanya di dalam transaksi ini, seperti 0023 mengisi katalog templat role.
ALTER TABLE menus            NO FORCE ROW LEVEL SECURITY;
ALTER TABLE menu_permissions NO FORCE ROW LEVEL SECURITY;

INSERT INTO menus (id, tenant_id, context_kind, parent_id, code, label, path, icon, sort_order, is_system, is_public_authenticated)
VALUES
  -- Urutan 10: registry tenant adalah pekerjaan utama konsol platform, di depan
  -- admin platform (20) dan sesi dukungan (30).
  ('e0000000-0000-0000-0000-000000000013', NULL, 'PLATFORM', NULL, 'platform-tenants', 'Tenant', '/platform/tenants', 'building', 10, TRUE, FALSE);

INSERT INTO menu_permissions (tenant_id, menu_id, context_kind, permission_code, permission_scope)
VALUES
  (NULL, 'e0000000-0000-0000-0000-000000000013', 'PLATFORM', 'platform.tenants.read', 'PLATFORM');

ALTER TABLE menus            FORCE ROW LEVEL SECURITY;
ALTER TABLE menu_permissions FORCE ROW LEVEL SECURITY;

COMMIT;
