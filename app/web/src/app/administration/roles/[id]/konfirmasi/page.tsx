import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tokenHalaman, tokenAksi, pengalihanGagal } from '@/lib/guard';
import { muatKerangka } from '@/lib/shell';
import { arsipkanRole, role } from '@/lib/admin-api';
import Kerangka from '@/components/Kerangka';

export const dynamic = 'force-dynamic';

/** Konfirmasi pengarsipan role (AC DEMO-0307). */
export default async function KonfirmasiRolePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ versi?: string }>;
}) {
  const { id } = await params;
  const { versi } = await searchParams;
  const token = await tokenHalaman();
  const k = await muatKerangka(token);
  const kembali = `/administration/roles/${id}`;

  const hasil = await role(token, id);
  if (!hasil.ok) {
    if (hasil.reason === 'NOTFOUND') redirect('/administration/roles?gagal=hilang');
    pengalihanGagal(hasil, '/administration/roles');
  }
  const r = hasil.data;

  const versiDilihat = Number(versi);
  if (!Number.isInteger(versiDilihat) || versiDilihat !== r.version) redirect(`${kembali}?gagal=bentrok`);
  if (r.is_system || r.archived) redirect(kembali);

  async function jalankan() {
    'use server';
    const t = await tokenAksi();
    const hasil = await arsipkanRole(t, id, versiDilihat);
    if (!hasil.ok) pengalihanGagal(hasil, kembali);
    redirect('/administration/roles?ok=diarsipkan');
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
      aktif="/administration/roles"
    >
      <h1>Arsipkan role?</h1>
      <div className="card">
        <p data-testid="konfirmasi-ringkas">
          Role <strong>{r.name}</strong> (<code>{r.code}</code>) di tenant{' '}
          <strong data-testid="konfirmasi-tenant">{k.tenantNama}</strong>, dipegang{' '}
          <strong>{r.active_members}</strong> anggota aktif.
        </p>
        <p className="kosong">
          Seluruh penugasan yang berjalan diakhiri, dan anggota yang hanya memegang role ini
          kehilangan aksesnya pada permintaan berikutnya. Role tidak dihapus: riwayatnya tetap ada.
        </p>
        <div className="aksi-baris">
          <form action={jalankan}>
            <button type="submit" className="danger" data-testid="konfirmasi-ya">
              Ya, arsipkan
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
