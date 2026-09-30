import { apiFetch, isTimeout, PESAN_LAMBAT } from './api-fetch';

export interface Member {
  membership_id: string;
  display_name: string;
  contact_email_masked: string;
  status: string;
}

export type MembersResult =
  | { ok: true; tenantId: string; members: Member[]; canInvite: boolean }
  | { ok: false; reason: 'UNAUTHORIZED' | 'FORBIDDEN' | 'ERROR'; detail?: string };

/**
 * Dipanggil dari server component. Token tidak pernah melewati browser.
 * 401 dibedakan dari error lain supaya halaman bisa mengarahkan ke login
 * alih-alih menampilkan layar error yang menyesatkan saat session kedaluwarsa.
 */
export interface ContextItem {
  // kind ada sejak DEMO-0311: daftar ini dapat memuat context PLATFORM, yang
  // tidak punya tenant. Pemakainya WAJIB menyaring - "pindah ke tenant" yang
  // menyertakan baris platform akan mengirim tenantId kosong.
  kind?: 'TENANT' | 'PLATFORM';
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
}

/** Daftar tenant milik identitas ini. Gagal diam-diam: pemindah tenant hanya pelengkap. */
export async function fetchContexts(token: string): Promise<ContextItem[]> {
  try {
    const res = await apiFetch('/api/v1/me/contexts', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    return ((await res.json()) as { contexts: ContextItem[] }).contexts;
  } catch {
    return [];
  }
}

export async function fetchMembers(token: string): Promise<MembersResult> {
  let res: Response;
  try {
    res = await apiFetch('/api/v1/members', {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'ERROR',
      detail: isTimeout(error) ? PESAN_LAMBAT : 'API tidak dapat dihubungi. Sudah dijalankan?',
    };
  }

  // 401 = session tidak berlaku (perpanjang atau masuk ulang). 403 = session
  // SAH tetapi tanpa permission (slice 10). Menyamakan keduanya - seperti sebelum
  // RBAC - mengeluarkan paksa pengguna yang hanya tidak punya hak melihat daftar.
  if (res.status === 401) return { ok: false, reason: 'UNAUTHORIZED' };
  if (res.status === 403) return { ok: false, reason: 'FORBIDDEN' };
  if (!res.ok) return { ok: false, reason: 'ERROR', detail: `API menjawab ${res.status}` };

  const body = (await res.json()) as { tenantId: string; members: Member[]; canInvite?: boolean };
  // canInvite hanya MENAMPILKAN form. Yang menolak tetap API (403 untuk bukan
  // owner); menyembunyikan tombol bukan kontrol akses.
  return { ok: true, tenantId: body.tenantId, members: body.members, canInvite: body.canInvite === true };
}

export interface Invitation {
  id: string;
  email_masked: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expires_at: string;
  created_at: string;
}

/** Daftar undangan tenant ini (hanya owner). Gagal = daftar kosong plus penanda. */
export async function fetchInvitations(token: string): Promise<{ ok: boolean; invitations: Invitation[] }> {
  try {
    const res = await apiFetch('/api/v1/invitations', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, invitations: [] };
    return { ok: true, invitations: ((await res.json()) as { invitations: Invitation[] }).invitations };
  } catch {
    return { ok: false, invitations: [] };
  }
}
