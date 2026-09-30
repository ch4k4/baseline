import { redirect } from 'next/navigation';
import { fetchContexts, ContextItem } from './api';
import { ButirMenu, daftarNotifikasi, menuSaya, permissionsSaya, SupportAktif } from './admin-api';

/**
 * Bahan kerangka halaman: permission efektif, daftar context, dan nama tenant
 * aktif. Satu tempat supaya setiap halaman administrasi memuat hal yang sama.
 *
 * Permission diambil dari API setiap render, tidak di-cache: role yang baru
 * dicabut harus langsung hilang pengaruhnya (skenario demo 2).
 */
export interface Kerangka {
  token: string;
  tenantId: string;
  tenantNama: string;
  contexts: ContextItem[];
  permissions: string[];
  /** Notifikasi keamanan yang belum dibaca; 0 bila tidak berhak membacanya. */
  belumDibaca: number;
  /** Terisi hanya bila halaman ini sedang dibuka DI DALAM sesi support (DEMO-0312). */
  support?: SupportAktif;
  /**
   * Navigasi, seluruhnya dari `GET /me/menu` (DEMO-0405). Tidak ada daftar menu di
   * kode web sejak slice 15: kalau backend tidak menyebut sebuah menu, layar tidak
   * punya cara menampilkannya.
   */
  menu: ButirMenu[];
}

export async function muatKerangka(token: string): Promise<Kerangka> {
  const [hak, contexts, menu] = await Promise.all([
    permissionsSaya(token),
    fetchContexts(token),
    menuSaya(token),
  ]);

  // Route identitas ini terbuka untuk setiap session yang sah. Ditolak = session
  // yang tidak berlaku, bukan soal hak; jalannya perpanjangan, bukan /403.
  if (!hak.ok) redirect(hak.reason === 'UNAUTHORIZED' ? '/refresh' : '/logout?reason=kredensial');

  // Session PLATFORM tidak punya tenant, jadi kerangka tenant bukan tempatnya.
  // Tanpa pengalihan ini ia merender topbar tanpa nama tenant dan navigasi
  // kosong - terlihat seperti akun tanpa hak, padahal ini superadmin di tempat
  // yang salah.
  if (hak.data.kind === 'PLATFORM') redirect('/platform/admins');

  const tenantId = hak.data.tenantId ?? '';
  const context = contexts.find((c) => c.tenantId === tenantId);

  // Mode support (DEMO-0312): nama tenant datang dari API, bukan dari daftar
  // context - sesi support tidak punya daftar context sama sekali (route identitas
  // itu ditolak untuknya), dan fetchContexts di atas karena itu mengembalikan
  // daftar kosong. Tanpa cabang ini banner akan menyebut UUID, dan orang yang
  // salah membaca UUID akan menyokong tenant yang salah tanpa sadar.
  const support = hak.data.kind === 'SUPPORT' ? hak.data.support : undefined;

  // Hitungan hanya diminta bila sessionnya memang berhak membacanya: memanggil
  // endpoint yang pasti 403 di setiap render halaman akan mengisi audit dengan
  // authz.denied yang tidak menandakan apa pun.
  let belumDibaca = 0;
  if (hak.data.permissions.includes('audit.read')) {
    const notif = await daftarNotifikasi(token);
    // Gagal diam-diam: lonceng adalah pelengkap, bukan alasan halaman gagal.
    if (notif.ok) belumDibaca = notif.data.unread;
  }

  return {
    token,
    // Menu yang gagal dimuat menghasilkan navigasi KOSONG, bukan navigasi tebakan:
    // daftar cadangan di web akan menawarkan halaman yang mungkin sudah tidak boleh
    // dibuka, dan itu lebih buruk daripada navigasi yang hilang sesaat.
    menu: menu.ok ? menu.data.menu : [],
    tenantId,
    tenantNama: context?.tenantName ?? support?.tenantName ?? tenantId,
    contexts,
    permissions: hak.data.permissions,
    belumDibaca,
    support,
  };
}

/**
 * Bahan kerangka konsol platform (DEMO-0409): navigasi dari `GET /me/menu` pada
 * context platform.
 *
 * Session TENANT yang membuka alamat platform TIDAK dialihkan dari sini: ia harus
 * mendapat 403 dari API halaman itu, lalu /403 - pengalihan diam-diam akan membuat
 * anggota tenant tidak pernah tahu bahwa ia mencoba masuk tempat yang bukan
 * haknya (pelajaran slice 10: 403 bukan alasan mengeluarkan orang).
 */
export async function muatKerangkaPlatform(token: string): Promise<{ menu: ButirMenu[] }> {
  const menu = await menuSaya(token);
  return { menu: menu.ok ? menu.data.menu : [] };
}
