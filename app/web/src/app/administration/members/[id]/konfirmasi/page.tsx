import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tokenHalaman, tokenAksi, pengalihanGagal } from '@/lib/guard';
import { muatKerangka } from '@/lib/shell';
import { aktifkanKembali, anggota, tangguhkan } from '@/lib/admin-api';
import Kerangka from '@/components/Kerangka';

export const dynamic = 'force-dynamic';

/**
 * Konfirmasi aksi berdampak besar pada anggota (AC DEMO-0307).
 *
 * Konfirmasinya halaman server, bukan dialog `confirm()` di browser. Tiga
 * alasannya: bekerja tanpa JavaScript, dapat dibaca pembaca layar dan keyboard,
 * dan - yang paling penting di aplikasi multi-tenant - ia dapat menyebutkan
 * TENANT AKTIF dan sasaran secara jelas sebelum tindakan dijalankan.
 */
export default async function KonfirmasiAnggotaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aksi?: string; versi?: string }>;
}) {
  const { id } = await params;
  const { aksi, versi } = await searchParams;
  const token = await tokenHalaman();
  const k = await muatKerangka(token);
  const kembali = `/administration/members/${id}`;

  if (aksi !== 'tangguhkan' && aksi !== 'aktifkan') redirect(kembali);

  const hasil = await anggota(token, id);
  if (!hasil.ok) {
    if (hasil.reason === 'NOTFOUND') redirect('/administration/members?gagal=hilang');
    pengalihanGagal(hasil, '/administration/members');
  }
  const m = hasil.data;

  // Versi dibawa dari halaman sebelumnya. Kalau anggota berubah di antara dua
  // langkah ini, konfirmasi dihentikan: yang dikonfirmasi bukan lagi keadaan
  // yang dilihat pengguna.
  const versiDilihat = Number(versi);
  if (!Number.isInteger(versiDilihat) || versiDilihat !== m.version) {
    redirect(`${kembali}?gagal=bentrok`);
  }

  async function jalankan() {
    'use server';
    const t = await tokenAksi();
    const hasil =
      aksi === 'tangguhkan'
        ? await tangguhkan(t, id, versiDilihat)
        : await aktifkanKembali(t, id, versiDilihat);
    if (!hasil.ok) pengalihanGagal(hasil, kembali);
    redirect(`${kembali}?ok=${aksi === 'tangguhkan' ? 'ditangguhkan' : 'diaktifkan'}`);
  }

  const judul = aksi === 'tangguhkan' ? 'Tangguhkan anggota?' : 'Aktifkan kembali anggota?';

  return (
    <Kerangka
      tenantNama={k.tenantNama}
      tenantId={k.tenantId}
      contexts={k.contexts}
      permissions={k.permissions}
      belumDibaca={k.belumDibaca}
      support={k.support}
      menu={k.menu}
      aktif="/administration/members"
    >
      <h1>{judul}</h1>
      <div className="card">
        <p data-testid="konfirmasi-ringkas">
          Anggota <strong>{m.display_name}</strong> ({m.contact_email_masked}) di tenant{' '}
          <strong data-testid="konfirmasi-tenant">{k.tenantNama}</strong>.
        </p>
        <p className="kosong">
          {aksi === 'tangguhkan'
            ? 'Seluruh session anggota ini di tenant ini akan dicabut. Ia tidak dapat masuk kembali ke tenant ini sampai diaktifkan lagi. Role yang dipegangnya tidak dihapus.'
            : 'Anggota dapat masuk kembali dengan role yang masih dipegangnya. Session lama tetap mati, jadi ia harus masuk ulang.'}
        </p>
        <div className="aksi-baris">
          <form action={jalankan}>
            <button
              type="submit"
              className={aksi === 'tangguhkan' ? 'danger' : undefined}
              data-testid="konfirmasi-ya"
            >
              {aksi === 'tangguhkan' ? 'Ya, tangguhkan' : 'Ya, aktifkan kembali'}
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
