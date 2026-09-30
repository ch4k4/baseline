import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Penanda "permintaan ini berjalan di dalam support session" (DEMO-0312).
 *
 * MASALAHNYA: sesi support memakai route tenant BIASA (ADR-003 sec.2.2), jadi
 * service yang sama - members, roles, notifications - melayani anggota tenant dan
 * superadmin yang sedang menyokong. Padahal transaksinya harus berbeda: context
 * 'support', app.support_session_id terisi, dan READ_ONLY dipaksa di database.
 *
 * PILIHAN YANG TIDAK DIAMBIL: menambah parameter context ke setiap service dan
 * setiap pemanggilnya. Itu menyentuh belasan tanda tangan dan menaruh keputusan
 * keamanan di setiap pemanggil - satu pemanggil yang lupa meneruskannya akan
 * membuka transaksi tenant biasa dari dalam sesi support, tanpa gejala apa pun.
 *
 * YANG DIAMBIL: satu penyimpanan per permintaan (AsyncLocalStorage). Middleware
 * membuka wadah kosong di awal setiap permintaan, guard mengisinya setelah token
 * support terbukti sah, dan UnitOfWork - satu-satunya tempat yang boleh menulis
 * GUC - membacanya. Keputusannya tetap di satu tempat, dan service tidak berubah.
 *
 * Harganya: keterikatan implisit. Karena itu dua sifat di bawah dijaga keras,
 * bukan diserahkan pada kebiasaan:
 *
 *   1. mengisi wadah yang tidak ada adalah ERROR, bukan diam-diam dilewati. Kalau
 *      middleware hilang, permintaan support GAGAL - tidak berjalan sebagai
 *      transaksi tenant biasa.
 *   2. UnitOfWork.withTenant MENOLAK tenant yang bukan tenant sesi support. Kode
 *      di dalam sesi support karena itu tidak dapat membuka context tenant lain
 *      walau keliru - dan itu lebih dari sekadar kerapian, karena RLS hanya
 *      menjaga apa yang ada di GUC.
 */

export interface SupportRequest {
  /**
   * Sisa umur sesi dalam detik MENURUT DATABASE (F-18), dibawa apa adanya ke
   * layar. Banner tidak menghitung sendiri dari `expiresAt`: pengurangan dua
   * tanggal adalah tempat cacat zona waktu bersembunyi, dan bannernya justru yang
   * paling perlu benar - orang memutuskan kapan berhenti dari angka itu.
   */
  remainingSeconds?: number;
  supportSessionId: string;
  tenantId: string;
  scope: 'READ_ONLY' | 'READ_WRITE';
  superadminUserId: string;
  platformSessionId: string;
}

interface Store {
  support?: SupportRequest;
}

const storage = new AsyncLocalStorage<Store>();

/**
 * Middleware: satu wadah per permintaan. Dipasang di main.ts sebelum Nest
 * memproses route, sehingga guard dan handler berjalan di dalam wadah yang sama.
 */
export function supportContextMiddleware(_req: unknown, _res: unknown, next: () => void): void {
  storage.run({}, next);
}

/** Dipanggil guard setelah sesi support terbukti ACTIVE dan belum kedaluwarsa. */
export function markSupportRequest(support: SupportRequest): void {
  const store = storage.getStore();
  if (!store) {
    // Fail-closed. Tanpa wadah, UnitOfWork tidak akan pernah tahu bahwa
    // permintaan ini sesi support, dan transaksinya akan berjalan sebagai tenant
    // biasa tanpa READ ONLY. Lebih baik 500 yang terlihat daripada sesi support
    // yang berjalan dengan sifat yang salah.
    throw new Error('support context store tidak tersedia: middleware belum terpasang');
  }
  store.support = support;
}

/** Null berarti permintaan tenant biasa (atau bukan permintaan HTTP sama sekali). */
export function supportContext(): SupportRequest | null {
  return storage.getStore()?.support ?? null;
}

/** Hanya untuk tes: menjalankan fn di dalam wadah sesi support. */
export function runAsSupportForTest<T>(support: SupportRequest, fn: () => T): T {
  return storage.run({ support }, fn);
}
