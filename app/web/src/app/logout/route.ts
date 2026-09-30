import { NextRequest, NextResponse } from 'next/server';
import { REFRESH_COOKIE, SESSION_COOKIE } from '@/lib/session';

/**
 * Route handler, bukan server component, karena hanya route handler dan server
 * action yang boleh menulis cookie.
 *
 * Dua hal yang tampak sepele dan ternyata menentukan:
 *
 * 1. Cookie basi WAJIB dihapus, bukan diabaikan. Kalau tidak, /members yang
 *    menolak token kedaluwarsa akan melempar ke /login, dan /login melihat
 *    cookie masih ada lalu melempar balik ke /members - lingkaran tanpa ujung.
 *
 * 2. Location ditulis RELATIF. Membangun URL absolut dari request.url atau
 *    nextUrl.origin tidak dapat dipercaya: Next menormalkan host (127.0.0.1
 *    berubah menjadi localhost), sehingga pengguna mendarat di origin tempat
 *    cookie-nya tidak berlaku - dan di belakang proxy, di host yang salah.
 *    Location relatif diselesaikan browser terhadap origin yang sedang dipakai.
 */
const ALASAN = new Set(['kredensial', 'api', 'tiket', 'lambat']);

export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get('reason');
  const location = reason && ALASAN.has(reason) ? `/login?error=${reason}` : '/login';

  const response = new NextResponse(null, { status: 302, headers: { Location: location } });
  response.cookies.delete(SESSION_COOKIE);
  // Refresh token ikut dibuang. Menyisakannya berarti /members akan mencoba
  // memperpanjang dengan token milik session yang baru saja ditinggalkan, dan
  // pengguna mendarat di halaman masuk lewat jalan memutar.
  response.cookies.delete(REFRESH_COOKIE);
  response.cookies.delete('demo_ticket');
  response.cookies.delete('demo_ticket_contexts');
  return response;
}
