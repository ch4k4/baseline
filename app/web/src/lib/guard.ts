import { redirect } from 'next/navigation';
import { getRefreshToken, getSessionToken, getSupportToken } from './session';
import { Gagal } from './admin-api';
import { PESAN_GAGAL } from './pesan';

/**
 * Penjaga halaman administrasi (slice 12).
 *
 * Satu tempat, karena tiga keputusan berikut harus sama di semua halaman dan
 * mudah salah bila ditulis ulang di tiap berkas:
 *
 *   401 = session tidak berlaku  -> coba perpanjang sekali, lalu keluar.
 *   403 = session SAH, hak kurang -> halaman /403; pengguna TETAP masuk, karena
 *         di tenant lain haknya mungkin berbeda (pelajaran slice 10).
 *   404 = di luar tenant ini      -> "tidak ditemukan", bukan "ditolak": tenant
 *         lain tidak boleh dapat memastikan keberadaan sebuah id.
 *
 * Perpanjangan selalu mendarat di /dashboard (lihat refresh/route.ts), jadi
 * tidak ada lingkaran antara halaman dan /refresh.
 */

export const BERANDA = '/dashboard';

/**
 * Token untuk halaman TENANT. Tanpa token: perpanjang bila masih mungkin.
 *
 * Sejak DEMO-0312 token support diutamakan: saat sesi support berjalan, halaman
 * tenant memang harus berbicara sebagai sesi support - bukan sebagai session
 * PLATFORM yang membukanya, yang akan ditolak setiap route tenant. Halaman
 * PLATFORM memakai tokenPlatform() di bawah, sehingga konsol platform tetap
 * bekerja di saat yang sama.
 */
export async function tokenHalaman(): Promise<string> {
  const support = await getSupportToken();
  if (support) return support;
  const token = await getSessionToken();
  if (token) return token;
  if (await getRefreshToken()) redirect('/refresh');
  redirect('/login');
}

/** Token untuk server action tenant. Sama, tetapi tanpa perpanjangan diam-diam. */
export async function tokenAksi(): Promise<string> {
  const support = await getSupportToken();
  if (support) return support;
  const token = await getSessionToken();
  if (token) return token;
  redirect('/refresh');
}

/**
 * Token untuk halaman dan aksi PLATFORM. Sengaja TIDAK melihat cookie support:
 * route platform menolak token support (dan harus menolaknya), jadi mengutamakan
 * token support di sini akan membuat konsol platform mati justru saat sesi support
 * berjalan - padahal di situlah tombol "akhiri sesi" berada.
 */
export async function tokenPlatform(): Promise<string> {
  const token = await getSessionToken();
  if (token) return token;
  if (await getRefreshToken()) redirect('/refresh');
  redirect('/login');
}

/**
 * Terjemahan kegagalan menjadi pengalihan. Dipakai halaman DAN aksi, supaya
 * keduanya tidak pernah berbeda pendapat tentang arti sebuah kode status.
 *
 * `kembali` adalah halaman asal: kegagalan yang dapat diperbaiki pengguna
 * (versi basi, masukan tidak sah) dikembalikan ke sana dengan pesan, bukan
 * dilempar ke layar error buntu.
 */
export function pengalihanGagal(g: Gagal, kembali: string): never {
  const tanda = (k: string, extra = '') => `${kembali}${kembali.includes('?') ? '&' : '?'}gagal=${k}${extra}`;
  switch (g.reason) {
    case 'UNAUTHORIZED':
      redirect('/refresh');
    case 'FORBIDDEN':
      redirect(`/403?dari=${encodeURIComponent(kembali)}`);
    case 'NOTFOUND':
      redirect(tanda('hilang'));
    case 'CONFLICT':
      redirect(tanda('bentrok'));
    case 'INVALID':
      redirect(tanda('masukan', g.detail ? `&pesan=${encodeURIComponent(g.detail)}` : ''));
    default:
      redirect(tanda('api', g.detail ? `&pesan=${encodeURIComponent(g.detail)}` : ''));
  }
}

/**
 * Kegagalan saat MEMUAT halaman. Hanya dua yang berujung pengalihan: session
 * yang tidak berlaku (perpanjang) dan hak yang kurang (/403). Sisanya menjadi
 * pesan yang dirender halaman - mengalihkan halaman ke dirinya sendiri dengan
 * pesan di query akan berulang tanpa ujung saat API macet.
 */
export function pesanMuat(g: Gagal): string {
  if (g.reason === 'UNAUTHORIZED') redirect('/refresh');
  if (g.reason === 'FORBIDDEN') redirect('/403');
  return g.detail ?? PESAN_GAGAL[g.reason === 'CONFLICT' ? 'bentrok' : 'api'];
}

/**
 * Kegagalan sebuah AKSI (bukan pemuatan). Yang berpindah tempat tetap
 * mengalihkan: 401 ke perpanjangan, 403 ke /403, dan sasaran yang hilang ke
 * daftar induknya. Sisanya DIKEMBALIKAN ke formulir supaya dirender di tempat -
 * memantulkannya ke halaman yang sama sebagai query membuat pengiriman
 * berikutnya berhenti berpindah halaman (lihat components/FormAksi.tsx).
 */
export function gagalAksi(g: Gagal, induk: string): { gagal: string } {
  if (g.reason === 'UNAUTHORIZED') redirect('/refresh');
  if (g.reason === 'FORBIDDEN') redirect(`/403?dari=${encodeURIComponent(induk)}`);
  if (g.reason === 'NOTFOUND') redirect(`${induk}?gagal=hilang`);
  if (g.reason === 'CONFLICT') return { gagal: PESAN_GAGAL.bentrok };
  return { gagal: g.detail ?? PESAN_GAGAL.api };
}
