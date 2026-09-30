import Link from 'next/link';
import { tokenHalaman } from '@/lib/guard';
import { PESAN_GAGAL } from '@/lib/pesan';
import { muatKerangka } from '@/lib/shell';
import Kerangka, { daftarRata } from '@/components/Kerangka';

export const dynamic = 'force-dynamic';

/**
 * Beranda setelah masuk (Demo Foundation sec.12).
 *
 * Halaman ini sengaja dapat dibuka oleh session mana pun, termasuk yang tidak
 * punya satu pun permission: orang yang belum diberi role tetap harus melihat
 * tenant aktifnya, dapat pindah tenant, dan dapat keluar. Itulah skenario demo 2
 * sebelum owner memberinya hak.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ gagal?: string; diperbarui?: string }>;
}) {
  const token = await tokenHalaman();
  const { gagal } = await searchParams;
  const k = await muatKerangka(token);

  // Kartu ini menawarkan hal yang sama dengan navigasi, jadi ia membaca sumber yang
  // sama: menu efektif dari API. Dasbor sendiri dibuang dari daftar - menawarkan
  // tautan ke halaman yang sedang dibuka tidak menolong siapa pun.
  const tersedia = daftarRata(k.menu).filter((n) => n.path !== null && n.path !== '/dashboard');

  return (
    <Kerangka
      tenantNama={k.tenantNama}
      tenantId={k.tenantId}
      contexts={k.contexts}
      permissions={k.permissions}
      belumDibaca={k.belumDibaca}
      support={k.support}
      menu={k.menu}
      aktif="/dashboard"
    >
      <h1>Dasbor</h1>
      <p className="sub">Demo baseline SaaS multi-tenant</p>

      {gagal === 'pindah' ? (
        <p className="error" role="alert" data-testid="form-error">
          Perpindahan tenant ditolak. Anda tetap berada di tenant sebelumnya.
        </p>
      ) : gagal ? (
        <p className="error" role="alert" data-testid="form-error">
          {PESAN_GAGAL[gagal] ?? 'Terjadi kesalahan.'}
        </p>
      ) : null}

      <div className="card">
        <h2 className="judul-kartu">Administrasi</h2>
        {tersedia.length === 0 ? (
          <p className="kosong" data-testid="tanpa-akses">
            Akun Anda belum diberi hak apa pun di tenant ini. Minta owner atau admin tenant
            memberi Anda role yang sesuai; setelah itu halaman administrasi muncul di sini.
          </p>
        ) : (
          <ul className="daftar-tautan">
            {tersedia.map((n) => (
              <li key={n.code}>
                <Link href={n.path as string} data-testid={`kartu-nav-${n.code}`}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="judul-kartu">Hak Anda di tenant ini</h2>
        {k.permissions.length === 0 ? (
          <p className="kosong">Belum ada permission.</p>
        ) : (
          <ul className="chips" data-testid="daftar-permission">
            {k.permissions.map((p) => (
              <li key={p} className="chip">
                <code>{p}</code>
              </li>
            ))}
          </ul>
        )}
        <p className="hint" style={{ marginBottom: 0 }}>
          Daftar ini dihitung server dari role yang Anda pegang, bukan dari nama role di kode.
          Menyembunyikan tautan bukan kontrol akses: membuka URL-nya langsung tetap ditolak API.
        </p>
      </div>
    </Kerangka>
  );
}
