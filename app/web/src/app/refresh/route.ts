import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { apiFetch, isTimeout } from '@/lib/api-fetch';
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  cookieOptions,
  refreshCookieOptions,
  IS_PRODUCTION,
} from '@/lib/session';

/**
 * Memperpanjang sesi dengan menukar refresh token.
 *
 * Ini route handler, bukan bagian dari halaman, karena hanya route handler dan
 * server action yang boleh menulis cookie. Server component yang merender
 * /members TIDAK BISA - itulah alasan halaman mengalihkan ke sini alih-alih
 * memperbarui token di tempat.
 *
 * TUJUANNYA TETAP, TIDAK DIAMBIL DARI PARAMETER. Menerima ?next= akan membuat
 * halaman ini menjadi pengalih terbuka: tautan /refresh?next=https://situs-palsu
 * berangkat dari domain yang benar dan mendarat di tempat lain. Selama hanya ada
 * satu halaman terlindungi, tujuan yang dipatok adalah jawaban yang jujur.
 *
 * Location ditulis RELATIF - lihat alasannya di logout/route.ts.
 */

function keLogin(alasan: string) {
  const response = new NextResponse(null, {
    status: 302,
    headers: { Location: `/logout?reason=${alasan}` },
  });
  return response;
}

export async function GET() {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) return keLogin('kredensial');

  let res: Response;
  try {
    res = await apiFetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (error) {
    return keLogin(isTimeout(error) ? 'lambat' : 'api');
  }

  // Penolakan di sini bisa berarti token sudah dipakai orang lain - dan kalau
  // begitu, seluruh rantainya baru saja dicabut oleh database. Satu-satunya
  // jalan yang benar sesudahnya adalah masuk lagi.
  if (!res.ok) return keLogin('kredensial');

  const body = (await res.json()) as { accessToken: string; refreshToken: string };

  const response = new NextResponse(null, {
    status: 302,
    headers: { Location: '/dashboard?diperbarui=1' },
  });
  response.cookies.set(SESSION_COOKIE, body.accessToken, cookieOptions(IS_PRODUCTION));
  response.cookies.set(REFRESH_COOKIE, body.refreshToken, refreshCookieOptions(IS_PRODUCTION));
  return response;
}
