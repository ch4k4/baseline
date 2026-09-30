import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tokenHalaman, tokenAksi, pengalihanGagal } from '@/lib/guard';
import { muatKerangka } from '@/lib/shell';
import { cabutUndangan, daftarUndangan } from '@/lib/admin-api';
import Kerangka from '@/components/Kerangka';

export const dynamic = 'force-dynamic';

/** Konfirmasi pencabutan undangan (AC DEMO-0307): tenant aktif dan sasaran disebut. */
export default async function KonfirmasiUndanganPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const token = await tokenHalaman();
  const k = await muatKerangka(token);
  const kembali = '/administration/invitations';

  const hasil = await daftarUndangan(token);
  if (!hasil.ok) pengalihanGagal(hasil, kembali);

  const undangan = hasil.data.invitations.find((i) => i.id === id);
  // Undangan tenant lain tidak ada di daftar ini sama sekali: yang menyaring RLS.
  if (!undangan || undangan.status !== 'PENDING') redirect(`${kembali}?gagal=hilang`);

  async function jalankan() {
    'use server';
    const t = await tokenAksi();
    const hasil = await cabutUndangan(t, id);
    if (!hasil.ok) pengalihanGagal(hasil, kembali);
    redirect(`${kembali}?ok=dicabut`);
  }

  return (
    <Kerangka
      tenantNama={k.tenantNama}
      tenantId={k.tenantId}
      contexts={k.contexts}
      permissions={k.permissions}
      belumDibaca={k.belumDibaca}
      support={k.support}
      menu={k.menu}
      aktif="/administration/invitations"
    >
      <h1>Cabut undangan?</h1>
      <div className="card">
        <p data-testid="konfirmasi-ringkas">
          Undangan untuk <strong>{undangan.email_masked}</strong> di tenant{' '}
          <strong data-testid="konfirmasi-tenant">{k.tenantNama}</strong>.
        </p>
        <p className="kosong">
          Tautan yang sudah dikirim langsung berhenti berlaku, termasuk bila penerimanya sedang
          membuka halaman penerimaan. Undangan baru dapat dibuat kapan saja.
        </p>
        <div className="aksi-baris">
          <form action={jalankan}>
            <button type="submit" className="danger" data-testid="konfirmasi-ya">
              Ya, cabut undangan
            </button>
          </form>
          <Link className="ghost-link" href={kembali} data-testid="konfirmasi-batal">
            Batal
          </Link>
        </div>
      </div>
    </Kerangka>
  );
}
