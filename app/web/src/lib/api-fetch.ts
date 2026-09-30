import { API_BASE } from './session';

/**
 * SATU-SATUNYA jalan dari web ke API (D-20).
 *
 * Sebelum ini setiap halaman memanggil fetch() sendiri tanpa batas waktu. API yang
 * mati terdeteksi cepat (koneksi ditolak), tetapi API yang HIDUP dan macet -
 * query terkunci, pool habis, proses tergantung - membuat halaman ikut menggantung
 * tanpa pesan apa pun, selama yang dimaui runtime.
 *
 * Batas waktu memakai AbortSignal.timeout, bukan Promise.race: race hanya
 * berhenti MENUNGGU, sedangkan permintaannya tetap hidup dan memegang socket.
 * Signal benar-benar membatalkan permintaan, termasuk saat membaca body.
 *
 * Tes: web/test/d20.spec.ts - termasuk pemeriksaan bahwa tidak ada fetch() lain
 * di src/ yang melewati berkas ini.
 */

const DEFAULT_TIMEOUT_MS = 5000;

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  // Nilai ngawur ditolak keras. Diam-diam kembali ke default berarti orang yang
  // menyetel API_TIMEOUT_MS=5s mengira batasnya berlaku padahal tidak.
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`API_TIMEOUT_MS tidak sah: "${raw}" (harus bilangan bulat milidetik > 0)`);
  }
  return n;
}

export const API_TIMEOUT_MS = parseTimeout(process.env.API_TIMEOUT_MS);

export const PESAN_LAMBAT = 'API tidak menjawab tepat waktu. Coba lagi sebentar lagi.';

/** true bila kegagalan berasal dari batas waktu, bukan dari koneksi ditolak. */
export function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/')) throw new Error('path API harus diawali /');
  return fetch(`${API_BASE}${path}`, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
}
