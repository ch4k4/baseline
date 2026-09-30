import Link from 'next/link';
import { tokenHalaman } from '@/lib/guard';
import { muatKerangka } from '@/lib/shell';
import Kerangka from '@/components/Kerangka';

export const dynamic = 'force-dynamic';

/**
 * Halaman "tidak punya akses" (Demo Foundation sec.12).
 *
 * Pengguna TIDAK dikeluarkan. Session-nya sah; yang kurang hanyalah hak di
 * tenant ini - dan di tenant lain haknya bisa berbeda. Karena itu kerangka
 * lengkap (pemindah tenant, tombol keluar) tetap ditampilkan.
 *
 * Halaman tidak menyebut permission apa yang kurang: peta hak akses bukan
 * informasi yang perlu diberikan kepada yang ditolak (tes slice 10 #3).
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string }>;
}) {
  const token = await tokenHalaman();
  const { dari } = await searchParams;
  const k = await muatKerangka(token);

  return (
    <Kerangka
      tenantNama={k.tenantNama}
      tenantId={k.tenantId}
      contexts={k.contexts}
      permissions={k.permissions}
      belumDibaca={k.belumDibaca}
      support={k.support}
      menu={k.menu}
      aktif=""
    >
      <h1>Tidak punya akses</h1>
      <p className="sub" data-testid="forbidden">
        Akun Anda belum diberi hak untuk membuka halaman ini di tenant{' '}
        <strong>{k.tenantNama}</strong>. Minta owner atau admin tenant memberi Anda role yang
        sesuai.
      </p>
      {dari && (
        <p className="hint" style={{ marginTop: 0 }} data-testid="forbidden-dari">
          Halaman yang diminta: <code>{dari}</code>
        </p>
      )}
      <div className="card">
        <Link href="/dashboard" data-testid="ke-dashboard">
          Kembali ke dasbor
        </Link>
      </div>
    </Kerangka>
  );
}
