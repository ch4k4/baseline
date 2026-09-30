'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { apiFetch } from '@/lib/api-fetch';
import { REFRESH_COOKIE, SESSION_COOKIE, SUPPORT_COOKIE, setTokenCookies } from '@/lib/session';
import { BERANDA } from '@/lib/guard';

/**
 * Aksi yang dipakai kerangka halaman administrasi (keluar dan pindah tenant).
 * Ditaruh terpisah supaya layout dan halaman memakai kode yang sama.
 */

export async function keluar() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  // Cabut di server DULU, baru hapus cookie. Menghapus cookie saja hanya membuat
  // browser lupa - sessionnya tetap hidup bagi siapa pun yang sempat menyalinnya.
  if (token) {
    try {
      await apiFetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      /* API tidak terjangkau; cookie tetap dibuang di bawah */
    }
  }

  store.delete(SESSION_COOKIE);
  store.delete(REFRESH_COOKIE);
  redirect('/login');
}

export async function pindahTenant(formData: FormData) {
  const tenantId = String(formData.get('tenantId') ?? '');
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token || !tenantId) redirect('/login');

  let res: Response;
  try {
    res = await apiFetch('/api/v1/me/context-switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ tenantId }),
    });
  } catch {
    redirect(`${BERANDA}?gagal=api`);
  }

  // Penolakan bukan alasan mengeluarkan orang: session lama masih sah, jadi
  // pengguna dikembalikan ke berandanya, bukan ke halaman masuk.
  if (!res.ok) redirect(`${BERANDA}?gagal=pindah`);

  // Pasangan token LAMA diganti seluruhnya. Menyisakan refresh token lama berarti
  // menyisakan jalan kembali ke tenant sebelumnya.
  const body = (await res.json()) as { accessToken: string; refreshToken: string };
  setTokenCookies(store, body);

  // Selalu kembali ke beranda, bukan ke halaman terakhir: hak di tenant baru
  // bisa berbeda, dan mendarat di halaman yang langsung menolak itu membingungkan.
  redirect(BERANDA);
}

/**
 * Mengakhiri sesi support dari banner (DEMO-0312).
 *
 * Dua langkah, dan urutannya penting: sesi diakhiri DI SERVER lebih dulu, baru
 * cookie dibuang. Menghapus cookie saja hanya membuat browser ini berhenti
 * memakai tokennya - sesinya tetap ACTIVE, tenant tetap terbuka bagi siapa pun
 * yang memegang salinan token itu, dan notifikasi "sesi berakhir" tidak pernah
 * terkirim ke tenant.
 *
 * Yang dipakai untuk mengakhiri adalah token PLATFORM (demo_session), bukan token
 * support: route platform menolak token support. Itulah sebabnya kedua token hidup
 * di cookie yang berbeda.
 */
export async function akhiriSesiSupportAksi(formData: FormData) {
  const sessionId = String(formData.get('sessionId') ?? '');
  const store = await cookies();
  const platform = store.get(SESSION_COOKIE)?.value;

  if (platform && sessionId) {
    try {
      await apiFetch(`/api/v1/platform/support-sessions/${encodeURIComponent(sessionId)}/end`, {
        method: 'POST',
        headers: { authorization: `Bearer ${platform}` },
      });
    } catch {
      /* API tidak terjangkau; cookie tetap dibuang - sesinya akan kedaluwarsa sendiri */
    }
  }

  store.delete(SUPPORT_COOKIE);
  redirect('/platform/support-sessions?ok=sesi-diakhiri');
}
