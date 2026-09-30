import { cookies } from 'next/headers';

/**
 * Next.js di sini berperan sebagai BFF (backend for frontend), bukan SPA.
 *
 * Akibatnya, dan ini disengaja:
 *   - token TIDAK PERNAH sampai ke JavaScript browser (cookie httpOnly);
 *   - browser hanya berbicara dengan Next, jadi tidak ada CORS untuk diurus;
 *   - NestJS tidak pernah terekspos langsung ke jaringan tempat browser berada.
 *
 * Sejak slice 7 isi cookie session adalah JWT bertanda tangan, bukan lagi session
 * id mentah, dan ada cookie kedua untuk refresh token. Yang TIDAK berubah adalah
 * sifat pentingnya: keduanya httpOnly, jadi tidak satu pun terbaca JavaScript.
 */

export const SESSION_COOKIE = 'demo_session';

/**
 * Tiket pemilihan tenant. Cookie terpisah, umur pendek, dan tetap httpOnly:
 * tiket adalah kredensial walau hanya bisa ditukar satu kali.
 */
export const TICKET_COOKIE = 'demo_ticket';

/**
 * Refresh token. Cookie terpisah dari access token, dan itu bukan kerapian
 * belaka: keduanya punya umur yang berbeda, dan yang satu ditukar sementara
 * yang lain hanya kedaluwarsa. Menyatukannya membuat perbedaan itu hilang.
 */
export const REFRESH_COOKIE = 'demo_refresh';

/**
 * Token support session (DEMO-0312). Cookie TERSENDIRI, bukan menimpa
 * demo_session, dan itu menentukan banyak hal:
 *
 *   - session PLATFORM superadmin tetap hidup di sebelahnya, sehingga ia dapat
 *     mengakhiri sesi supportnya sendiri (endpoint platform) dan kembali ke konsol
 *     tanpa masuk ulang;
 *   - token support tidak punya refresh token, jadi tidak ada pasangan untuk
 *     disimpan - umurnya sudah sepanjang sesinya;
 *   - menghapus cookie ini BUKAN mengakhiri sesi support. Yang mengakhirinya
 *     adalah baris di database; cookie hanya membuat browser berhenti memakainya.
 */
export const SUPPORT_COOKIE = 'demo_support';

export const API_BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

export interface SessionContext {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  membershipId: string;
}

export function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // secure=false hanya boleh di localhost. Di produksi wajib true, dan itulah
    // kenapa nilainya diturunkan dari environment, bukan dipatok di kode.
    secure,
    path: '/',
    maxAge: 60 * 60,
  };
}

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Umur cookie refresh melebihi umur access token dengan sengaja - itulah
 * gunanya. Yang membatasi sesi tetap database, bukan cookie ini: token yang
 * kedaluwarsa atau sudah dipakai ditolak walau cookie-nya masih ada.
 */
export function refreshCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  };
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Satu-satunya tempat pasangan token menjadi cookie. */
export function setTokenCookies(
  store: { set: (name: string, value: string, options: object) => void },
  pair: TokenPair,
): void {
  store.set(SESSION_COOKIE, pair.accessToken, cookieOptions(IS_PRODUCTION));
  store.set(REFRESH_COOKIE, pair.refreshToken, refreshCookieOptions(IS_PRODUCTION));
}

/**
 * Umur cookie support dipatok pada sisa umur sesinya (detik), bukan satu jam:
 * cookie yang hidup lebih lama daripada sesinya hanya menghasilkan 401 yang
 * membingungkan.
 */
export function supportCookieOptions(secure: boolean, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: Math.max(1, maxAgeSeconds),
  };
}

export async function getSupportToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SUPPORT_COOKIE)?.value ?? null;
}

export function ticketCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: 300, // sama dengan batas TTL yang ditegakkan database
  };
}

export interface TicketPayload {
  contexts: string; // JSON daftar tenant, hanya untuk ditampilkan
}

export async function getTicket(): Promise<TicketPayload | null> {
  const store = await cookies();
  const contexts = store.get('demo_ticket_contexts')?.value;
  const ticket = store.get(TICKET_COOKIE)?.value;
  if (!ticket || !contexts) return null;
  return { contexts };
}

/** Token mentah untuk dipakai server-side. Tidak pernah dikirim ke komponen klien. */
export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value ?? null;
}
