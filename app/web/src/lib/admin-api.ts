import { apiFetch, isTimeout, PESAN_LAMBAT } from './api-fetch';

/**
 * Klien administrasi (slice 12). Semua panggilan berjalan di server Next, jadi
 * token tidak pernah menyentuh browser.
 *
 * Dua hal yang sengaja tidak disederhanakan:
 *
 *   1. 401, 403, 404, dan 409 dibedakan sampai ke halaman. Menyamakan 403 dengan
 *      401 mengusir orang yang sekadar tidak punya hak (pelajaran slice 10), dan
 *      menyamakan 409 dengan "gagal" menyembunyikan satu-satunya kesalahan yang
 *      punya obat jelas: muat ulang, lalu coba lagi.
 *   2. Tidak ada tebakan hak di sisi web. Tombol boleh disembunyikan berdasarkan
 *      permission efektif, tetapi yang MENOLAK tetap API. Menyembunyikan tombol
 *      bukan kontrol akses.
 */

export type Gagal = {
  ok: false;
  reason: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOTFOUND' | 'CONFLICT' | 'INVALID' | 'ERROR';
  detail?: string;
};
export type Hasil<T> = ({ ok: true } & T) | Gagal;

function gagalDariStatus(status: number, pesan?: string): Gagal {
  if (status === 401) return { ok: false, reason: 'UNAUTHORIZED' };
  if (status === 403) return { ok: false, reason: 'FORBIDDEN' };
  if (status === 404) return { ok: false, reason: 'NOTFOUND' };
  if (status === 409) return { ok: false, reason: 'CONFLICT', detail: pesan };
  if (status === 400) return { ok: false, reason: 'INVALID', detail: pesan };
  return { ok: false, reason: 'ERROR', detail: pesan ?? `API menjawab ${status}` };
}

async function panggil<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Hasil<{ data: T }>> {
  let res: Response;
  try {
    res = await apiFetch(path, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'ERROR',
      detail: isTimeout(error) ? PESAN_LAMBAT : 'API tidak dapat dihubungi. Sudah dijalankan?',
    };
  }

  const teks = await res.text();
  let body: any = null;
  try {
    body = teks ? JSON.parse(teks) : null;
  } catch {
    body = null;
  }

  if (!res.ok) return gagalDariStatus(res.status, typeof body?.message === 'string' ? body.message : undefined);
  return { ok: true, data: body as T };
}

// ---------------------------------------------------------------- bentuk data

export interface RoleRef {
  id: string;
  code: string;
  name: string;
  archived: boolean;
}

export interface Member {
  membership_id: string;
  display_name: string;
  contact_email_masked: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ENDED';
  version: number;
  roles: RoleRef[];
}

export interface Halaman {
  limit: number;
  offset: number;
  total: number;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  archived: boolean;
  version: number;
  permissions: string[];
  active_members: number;
}

export interface PermissionItem {
  code: string;
  description: string;
}

export interface Invitation {
  id: string;
  email_masked: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expires_at: string;
  created_at: string;
}

// ---------------------------------------------------------------- pembacaan

export interface SupportAktif {
  sessionId: string;
  scope: 'READ_ONLY' | 'READ_WRITE';
  expiresAt: string;
  /**
   * Sisa umur sesi dalam detik, DIHITUNG DATABASE. Banner memakai angka ini dan
   * tidak mengurangkan dua tanggal sendiri: pengurangan itu benar di mesin
   * pengembangan dan salah tujuh jam di mesin target, dan bannerlah yang paling
   * perlu benar - orang memutuskan kapan berhenti dari angka itu.
   */
  remainingSeconds: number | null;
  tenantName: string | null;
}

export function permissionsSaya(token: string) {
  return panggil<{
    kind: 'TENANT' | 'PLATFORM' | 'SUPPORT';
    tenantId: string | null;
    permissions: string[];
    /** Hanya pada kind SUPPORT (DEMO-0312): bahan banner mode support. */
    support?: SupportAktif;
  }>(token, '/api/v1/me/permissions');
}

export interface FilterAnggota {
  status?: string;
  roleId?: string;
  email?: string;
  limit: number;
  offset: number;
}

export function daftarAnggota(token: string, f: FilterAnggota) {
  const q = new URLSearchParams();
  if (f.status) q.set('status', f.status);
  if (f.roleId) q.set('roleId', f.roleId);
  if (f.email) q.set('email', f.email);
  q.set('limit', String(f.limit));
  q.set('offset', String(f.offset));
  return panggil<{ tenantId: string; members: Member[]; page: Halaman; canInvite: boolean }>(
    token,
    `/api/v1/members?${q.toString()}`,
  );
}

export function anggota(token: string, membershipId: string) {
  return panggil<Member>(token, `/api/v1/members/${encodeURIComponent(membershipId)}`);
}

export function daftarRole(token: string) {
  return panggil<{ roles: Role[] }>(token, '/api/v1/roles');
}

export function role(token: string, id: string) {
  return panggil<Role>(token, `/api/v1/roles/${encodeURIComponent(id)}`);
}

export function katalogPermission(token: string) {
  return panggil<{ permissions: PermissionItem[] }>(token, '/api/v1/permissions');
}

export function daftarUndangan(token: string) {
  return panggil<{ invitations: Invitation[] }>(token, '/api/v1/invitations');
}

// ---------------------------------------------------------------- perubahan

export function ubahProfil(token: string, membershipId: string, displayName: string, version: number) {
  return panggil<Member>(token, `/api/v1/members/${encodeURIComponent(membershipId)}/profile`, {
    method: 'PATCH',
    body: JSON.stringify({ displayName, version }),
  });
}

export function tangguhkan(token: string, membershipId: string, version: number) {
  return panggil<Member>(token, `/api/v1/members/${encodeURIComponent(membershipId)}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export function aktifkanKembali(token: string, membershipId: string, version: number) {
  return panggil<Member>(token, `/api/v1/members/${encodeURIComponent(membershipId)}/reactivate`, {
    method: 'POST',
    body: JSON.stringify({ version }),
  });
}

export function gantiRoleAnggota(token: string, membershipId: string, roleIds: string[], version: number) {
  return panggil<Member>(token, `/api/v1/members/${encodeURIComponent(membershipId)}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ roleIds, version }),
  });
}

export function buatRole(token: string, code: string, name: string) {
  return panggil<Role>(token, '/api/v1/roles', { method: 'POST', body: JSON.stringify({ code, name }) });
}

export function gantiNamaRole(token: string, id: string, name: string, version: number) {
  return panggil<Role>(token, `/api/v1/roles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, version }),
  });
}

export function arsipkanRole(token: string, id: string, version: number) {
  return panggil<unknown>(token, `/api/v1/roles/${encodeURIComponent(id)}?version=${version}`, {
    method: 'DELETE',
  });
}

export function gantiPermissionRole(token: string, id: string, permissions: string[], version: number) {
  return panggil<Role>(token, `/api/v1/roles/${encodeURIComponent(id)}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissions, version }),
  });
}

export function undang(token: string, email: string, roleIds: string[]) {
  return panggil<unknown>(token, '/api/v1/invitations', {
    method: 'POST',
    body: JSON.stringify({ email, roleIds }),
  });
}

export function cabutUndangan(token: string, id: string) {
  return panggil<unknown>(token, `/api/v1/invitations/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------- platform (slice 13)

export interface AdminPlatform {
  id: string;
  user_id: string;
  role_code: string;
  granted_at: string;
  granted_by: string | null;
  reason: string | null;
}

export function daftarAdminPlatform(token: string) {
  return panggil<{ admins: AdminPlatform[] }>(token, '/api/v1/platform/admins');
}

export function beriAdminPlatform(token: string, userId: string, reason: string) {
  return panggil<{ id: string }>(token, '/api/v1/platform/admins', {
    method: 'POST',
    body: JSON.stringify({ userId, reason: reason || null }),
  });
}

export function cabutAdminPlatform(token: string, id: string) {
  return panggil<unknown>(token, `/api/v1/platform/admins/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------- registry tenant (D-56)

export interface TenantPlatform {
  id: string;
  slug: string;
  name: string;
  status: 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | string;
  created_at: string;
}

export function daftarTenantPlatform(token: string) {
  return panggil<{ tenants: TenantPlatform[] }>(token, '/api/v1/platform/tenants');
}

/** Suspend atau aktifkan kembali (D-47). Transisi yang tidak sah dijawab 409 oleh API. */
export function ubahStatusTenant(token: string, id: string, status: 'ACTIVE' | 'SUSPENDED') {
  return panggil<{ tenantId: string; status: string; previousStatus: string }>(
    token,
    `/api/v1/platform/tenants/${encodeURIComponent(id)}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
}

// ---------------------------------------------------------------- menu (slice 15)

/**
 * Satu butir navigasi dari `GET /me/menu`. TIDAK memuat kode permission: navigasi
 * adalah petunjuk tampilan, dan membocorkan peta hak akses lewatnya memberi daftar
 * yang justru disembunyikan respons 403.
 */
export interface ButirMenu {
  code: string;
  label: string;
  path: string | null;
  icon: string | null;
  children: ButirMenu[];
}

export function menuSaya(token: string) {
  return panggil<{ menu: ButirMenu[] }>(token, '/api/v1/me/menu');
}

// ---------------------------------------------------------------- support session (slice 14)

export interface SesiSupport {
  id: string;
  tenant_id: string;
  superadmin_user_id: string;
  scope: 'READ_ONLY' | 'READ_WRITE';
  reason_code: string;
  ticket_reference: string | null;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  end_reason: string | null;
  status: string;
}

export function daftarSesiSupport(token: string) {
  return panggil<{ sessions: SesiSupport[] }>(token, '/api/v1/platform/support-sessions');
}

export interface BukaSesiInput {
  tenantId: string;
  reasonCode: string;
  reasonText: string;
  scope: string;
  durationMinutes: number;
  ticketReference: string | null;
}

/**
 * Jawabannya memuat TOKEN SUPPORT. Token itu tidak pernah dikembalikan ke browser
 * sebagai nilai yang terbaca JavaScript: pemanggil menaruhnya di cookie httpOnly,
 * sama seperti token session (Demo Foundation sec.12).
 */
export function bukaSesiSupport(token: string, input: BukaSesiInput) {
  return panggil<{
    session: SesiSupport;
    forcedReadOnly: boolean;
    supportToken: string;
    expiresIn: number;
  }>(token, '/api/v1/platform/support-sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Sisi TENANT: sesi dukungan atas tenant ini (audit.read). Bukan endpoint platform -
 * yang membedakannya adalah context session, bukan alamatnya.
 */
export function sesiSupportTenant(token: string) {
  return panggil<{ sessions: SesiSupport[] }>(token, '/api/v1/support-sessions');
}

export function akhiriSesiSupport(token: string, id: string) {
  return panggil<{ status: string }>(
    token,
    `/api/v1/platform/support-sessions/${encodeURIComponent(id)}/end`,
    { method: 'POST' },
  );
}

// ---------------------------------------------------------------- notifikasi keamanan

export interface NotifikasiKeamanan {
  id: string;
  type: string;
  ref_id: string;
  created_at: string;
  read_at: string | null;
}

export function daftarNotifikasi(token: string) {
  return panggil<{ notifications: NotifikasiKeamanan[]; unread: number }>(
    token,
    '/api/v1/notifications/security',
  );
}

export function tandaiNotifikasiTerbaca(token: string, id: string) {
  return panggil<{ status: string }>(
    token,
    `/api/v1/notifications/security/${encodeURIComponent(id)}/read`,
    { method: 'POST' },
  );
}
