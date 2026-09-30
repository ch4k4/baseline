import Link from 'next/link';
import { ContextItem } from '@/lib/api';
import { ButirMenu, SupportAktif } from '@/lib/admin-api';
import { akhiriSesiSupportAksi, keluar, pindahTenant } from '@/app/administration/actions';

/**
 * Kerangka halaman setelah masuk: indikator tenant aktif, navigasi, pemindah
 * tenant, dan tombol keluar (Demo Foundation sec.12.1).
 *
 * NAVIGASI SELURUHNYA DARI `GET /me/menu` (DEMO-0405). Sampai slice 14 daftarnya
 * ada di berkas ini dan disaring permission di browser - bekerja, tetapi berarti
 * "menu" bukan data: tidak ada satu tempat pun yang dapat menjawab "menu apa saja
 * yang boleh dilihat orang ini" selain kode React. Sejak slice 15 daftar itu
 * DIHAPUS, bukan disimpan sebagai cadangan: cadangan akan menawarkan halaman yang
 * mungkin sudah tidak boleh dibuka, dan cadangan yang tidak pernah dipakai tidak
 * pernah ikut diuji.
 *
 * Yang TIDAK berubah: menyembunyikan tautan bukan kontrol akses. Yang menolak
 * tetap API, dan halaman yang dibuka langsung lewat URL berakhir di /403.
 */

/** Satu butir navigasi dirender rata; grup tanpa route menjadi label. */
function Tautan({ butir, aktif }: { butir: ButirMenu; aktif: string }) {
  if (butir.path === null) {
    return (
      <span className="nav-grup" data-testid={`nav-grup-${butir.code}`}>
        {butir.label}
      </span>
    );
  }
  return (
    <Link
      href={butir.path}
      data-testid={`nav-${butir.code}`}
      aria-current={aktif === butir.path ? 'page' : undefined}
      className={aktif === butir.path ? 'nav-item aktif' : 'nav-item'}
    >
      {butir.label}
    </Link>
  );
}

/** Dua tingkat: grup dan anaknya dirender berurutan di satu baris navigasi. */
export function daftarRata(menu: ButirMenu[]): ButirMenu[] {
  const hasil: ButirMenu[] = [];
  for (const m of menu) {
    hasil.push(m);
    for (const anak of m.children) hasil.push(anak);
  }
  return hasil;
}

export default function Kerangka({
  tenantNama,
  tenantId,
  contexts,
  permissions,
  aktif,
  belumDibaca = 0,
  support,
  menu,
  children,
}: {
  tenantNama: string;
  tenantId: string;
  contexts: ContextItem[];
  permissions: string[];
  menu: ButirMenu[];
  aktif: string;
  belumDibaca?: number;
  support?: SupportAktif;
  children: React.ReactNode;
}) {
  const tautan = daftarRata(menu);
  // Hanya tenant LAIN. Baris context PLATFORM (ada sejak DEMO-0311) disaring di
  // sini: berpindah ke platform dari session tenant belum ada, dan tanpa saringan
  // ini tombolnya akan terbit dengan tenantId kosong.
  const lain = contexts.filter((c) => c.kind !== 'PLATFORM' && c.tenantId && c.tenantId !== tenantId);

  // Sisa waktu dihitung di server, sekali, saat halaman dirender. Tidak ada
  // hitungan yang berjalan sendiri di browser: angka yang bergerak akan terlihat
  // seperti jaminan bahwa sesinya masih hidup, padahal yang menentukan adalah
  // baris di database - diperiksa setiap permintaan. Banner ini penanda, bukan
  // pengukur.
  //
  // Angkanya datang dari DATABASE (detik), bukan dari pengurangan dua tanggal di
  // sini. Versi pertama menghitungnya sendiri dari `expiresAt`, dan di mesin target
  // hasilnya 450 menit untuk sesi 30 menit - Prisma membaca timestamptz sebagai jam
  // dinding sesi database lalu melabelinya UTC. Unit of work kini memaksa TimeZone
  // UTC, tetapi banner tetap memakai angka dari database: satu sumber, bukan dua
  // yang bisa berbeda pendapat.
  const sisaMenit = support?.remainingSeconds != null
    ? Math.max(0, Math.ceil(support.remainingSeconds / 60))
    : support
      ? Math.max(0, Math.ceil((new Date(support.expiresAt).getTime() - Date.now()) / 60000))
      : 0;

  return (
    <>
      {/*
        Banner mode support (ADR-003 sec.2.2 butir 8) - PERMANEN selama sesi
        berjalan, di atas segalanya, dan menyebut tenant, scope, sisa waktu, serta
        jalan keluarnya. Orang yang tidak tahu bahwa ia sedang berada di dalam data
        tenant orang lain adalah risiko yang paling sulit diperbaiki kemudian.
      */}
      {support && (
        <div className="banner-support" role="status" data-testid="banner-support">
          <span data-testid="banner-support-teks">
            Mode support - Tenant {support.tenantName ?? tenantNama} - {support.scope} - sisa{' '}
            <span data-testid="banner-support-sisa">{sisaMenit}</span> menit
          </span>
          <form action={akhiriSesiSupportAksi}>
            <input type="hidden" name="sessionId" value={support.sessionId} />
            <button className="ghost" type="submit" data-testid="akhiri-sesi-support">
              Akhiri sesi
            </button>
          </form>
        </div>
      )}
      <header className="topbar">
        <div className="topbar-inner">
          <div>
            <span className="label-tenant">Tenant aktif</span>
            <div className="tenant" data-testid="tenant-aktif">
              {tenantNama}
            </div>
            <span className="tenant-id" data-testid="tenant-id">
              {tenantId}
            </span>
          </div>
          <div className="topbar-aksi">
            {/*
              Lonceng keamanan (DEMO-0313). Hanya untuk pemegang audit.read, dan
              jumlahnya ikut ditampilkan: notifikasi sesi support yang tidak
              terlihat sama saja dengan tidak ada.
            */}
            {permissions.includes('audit.read') && (
              <Link
                className="ghost"
                href="/administration/notifications"
                data-testid="lonceng-keamanan"
              >
                Keamanan{belumDibaca > 0 ? ` (${belumDibaca})` : ''}
              </Link>
            )}
            {/*
              Pemindah tenant dan tombol Keluar TIDAK muncul di mode support:
              keduanya route identitas, yang ditolak API untuk sesi support (403).
              Tombol yang pasti gagal lebih buruk daripada tombol yang tidak ada -
              jalan keluar sesi support adalah "Akhiri sesi" di banner.
            */}
            {!support && lain.map((c) => (
              <form action={pindahTenant} key={c.tenantId}>
                <input type="hidden" name="tenantId" value={c.tenantId ?? ''} />
                <button className="ghost" type="submit" data-testid={`pindah-${c.tenantSlug}`}>
                  Pindah ke {c.tenantName}
                </button>
              </form>
            ))}
            {!support && (
              <form action={keluar}>
                <button className="ghost" type="submit" data-testid="logout">
                  Keluar
                </button>
              </form>
            )}
          </div>
        </div>
        <nav className="nav" aria-label="Navigasi utama" data-testid="nav-utama">
          {tautan.map((n) => (
            <Tautan key={n.code} butir={n} aktif={aktif} />
          ))}
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
