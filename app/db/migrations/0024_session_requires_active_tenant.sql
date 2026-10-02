-- 0024_session_requires_active_tenant.sql
-- Dijalankan sebagai app_owner.
--
-- F-21 (auth.find_session) menjadi pemeriksaan yang dijanjikan dokumennya.
--
-- Infrastructure SSOT sec.8.6 menuntut setiap request protected memverifikasi tenant
-- berstatus ACTIVE dan membership masih aktif, dan Lampiran A mencatat F-21 membaca
-- sessions, tenant_memberships, DAN tenants - "membership tidak ACTIVE -> kosong".
-- Fungsi yang terpasang sejak 0004 hanya membaca sessions. Tidak ada satu tempat pun
-- yang memeriksa status tenant per request: tenant yang disuspend tetap dapat dipakai
-- setiap anggota yang sedang masuk, sampai session-nya kedaluwarsa sendiri.
--
-- Untuk membership, celahnya tertutup dari arah lain (penangguhan anggota mencabut
-- session-nya, dan effective_permissions hanya menghitung membership ACTIVE). Untuk
-- tenant TIDAK ada penutup apa pun - dan ditemukan saat merancang suspend tenant
-- (D-47): endpoint suspend di atas F-21 yang lama hanya akan menulis status yang
-- tidak dibaca siapa pun.
--
-- Aturan baru, satu tempat untuk keduanya:
--   * session TENANT hidup hanya bila membership-nya ACTIVE dan tenant-nya ACTIVE;
--   * session PLATFORM tidak punya tenant maupun membership, jadi tidak terdampak.
--     Token SUPPORT memakai session PLATFORM ditambah F-18, dan ADR-003 sec.2.2 aturan
--     10 justru mengizinkan support pada tenant yang disuspend - aturan itu milik
--     jalur support, bukan F-21.
--
-- Bentuk kembalian TIDAK berubah, jadi pemanggil tidak berubah: session yang tidak
-- memenuhi syarat sama dengan session yang tidak ada (nol baris -> 401).
--
-- Grant kolom dan policy definer_read untuk tenants dan tenant_memberships sudah ada
-- sejak F-22 (find_membership) membaca kolom yang sama; tidak ada hak baru di sini.

CREATE OR REPLACE FUNCTION auth.find_session(p_session_id UUID)
RETURNS TABLE (
  session_id    UUID,
  context_kind  VARCHAR,
  tenant_id     UUID,
  user_id       UUID,
  membership_id UUID,
  expires_at    TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.context_kind, s.tenant_id, s.user_id, s.membership_id, s.expires_at
  FROM sessions s
  LEFT JOIN tenant_memberships m ON m.id = s.membership_id AND m.tenant_id = s.tenant_id
  LEFT JOIN tenants t ON t.id = s.tenant_id
  WHERE s.id = p_session_id
    AND s.status = 'ACTIVE'
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND (
      s.context_kind = 'PLATFORM'
      OR (m.status = 'ACTIVE' AND t.status = 'ACTIVE')
    );
$$;
ALTER FUNCTION auth.find_session(UUID) OWNER TO app_auth_definer;
REVOKE ALL ON FUNCTION auth.find_session(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.find_session(UUID) TO app_user;

COMMENT ON FUNCTION auth.find_session(uuid) IS
  'F-21 pre-context: baris session untuk verifikasi setiap request; session TENANT hanya bila membership dan tenant ACTIVE';
