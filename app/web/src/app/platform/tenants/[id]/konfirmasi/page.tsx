import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tokenPlatform, gagalAksi, pesanMuat } from '@/lib/guard';
import { daftarTenantPlatform, ubahStatusTenant } from '@/lib/admin-api';
import KartuGagal from '@/components/KartuGagal';
import FormAksi, { HasilAksi } from '@/components/FormAksi';

export const dynamic = 'force-dynamic';

/**
 * Konfirmasi suspend / aktifkan tenant (D-56).
 *
 * Halaman server, bukan confirm() di browser, seperti pencabutan admin platform:
 * keputusan yang memutus akses seluruh anggota sebuah tenant harus dapat dibaca,
 * ditinggalkan, dan dibuka ulang, dan tetap bekerja tanpa JavaScript.
 *
 * Arah perubahan diambil dari `?status=`, tetapi tombol hanya muncul bila arah itu
 * memang transisi sah dari status tenant SAAT INI. Tautan basi (tenant sudah
 * disuspend orang lain) tidak menawarkan apa pun; dan bila status berubah di antara
 * halaman ini dimuat dan tombol ditekan, API menjawab 409.
 */
export default async function KonfirmasiStatusTenantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const token = await tokenPlatform();
  const { id } = await params;
  const { status } = await searchParams;
  const ke = status === 'SUSPENDED' || status === 'ACTIVE' ? status : null;

  const hasil = await daftarTenantPlatform(token);
  const pesanError = hasil.ok ? null : pesanMuat(hasil);
  const target = hasil.ok ? hasil.data.tenants.find((t) => t.id === id) : undefined;
  const sah =
    target !== undefined &&
    ((ke === 'SUSPENDED' && target.status === 'ACTIVE') || (ke === 'ACTIVE' && target.status === 'SUSPENDED'));

  async function ubah(_sebelumnya: HasilAksi | null): Promise<HasilAksi> {
    'use server';
    if (!ke) return { gagal: 'Arah perubahan tidak dikenal.' };
    const t = await tokenPlatform();
    const r = await ubahStatusTenant(t, id, ke);
    if (!r.ok) return gagalAksi(r, '/platform/tenants');
    redirect(`/platform/tenants?ok=${ke === 'SUSPENDED' ? 'tenant-disuspend' : 'tenant-diaktifkan'}`);
  }

  return (
    <main>
      <p>
        <Link href="/platform/tenants" data-testid="kembali">
          Kembali ke registry tenant
        </Link>
      </p>

      {pesanError && <KartuGagal judul="Tidak dapat memuat registry tenant" pesan={pesanError} />}

      {!pesanError && !target && (
        <KartuGagal
          judul="Tenant tidak ditemukan"
          pesan="Daftar terbaru ada di halaman registry tenant."
        />
      )}

      {target && !sah && (
        <KartuGagal
          judul="Tidak ada perubahan yang dapat dilakukan"
          pesan={`Tenant ini berstatus ${target.status}. Statusnya mungkin sudah diubah orang lain; periksa registry tenant.`}
        />
      )}

      {target && sah && ke === 'SUSPENDED' && (
        <div className="card" data-testid="konfirmasi-status">
          <h1>Suspend tenant ini?</h1>
          <p>
            Tenant: <strong data-testid="konfirmasi-nama">{target.name}</strong> (
            <code>{target.slug}</code>)
          </p>
          <ul>
            <li>Setiap anggota yang sedang masuk kehilangan akses pada permintaan berikutnya.</li>
            <li>Tenant ini tidak lagi ditawarkan saat masuk maupun saat berpindah tenant.</li>
            <li>Data tenant tidak diubah. Sesi dukungan tetap dapat dibuka, hanya baca.</li>
          </ul>
          <p className="hint" data-testid="peringatan-sesi">
            Session anggota tidak dicabut, hanya ditolak selama tenant disuspend. Bila tenant
            diaktifkan lagi dalam satu jam, session yang belum kedaluwarsa berlaku kembali tanpa
            masuk ulang. Untuk insiden keamanan, itu belum cukup (D-55).
          </p>
          <FormAksi aksi={ubah}>
            <button type="submit" data-testid="konfirmasi-status-submit">
              Ya, suspend tenant ini
            </button>
          </FormAksi>
        </div>
      )}

      {target && sah && ke === 'ACTIVE' && (
        <div className="card" data-testid="konfirmasi-status">
          <h1>Aktifkan kembali tenant ini?</h1>
          <p>
            Tenant: <strong data-testid="konfirmasi-nama">{target.name}</strong> (
            <code>{target.slug}</code>)
          </p>
          <p className="sub">
            Anggotanya dapat masuk dan memilih tenant ini lagi. Session yang belum kedaluwarsa
            sejak sebelum suspend berlaku kembali.
          </p>
          <FormAksi aksi={ubah}>
            <button type="submit" data-testid="konfirmasi-status-submit">
              Ya, aktifkan
            </button>
          </FormAksi>
        </div>
      )}
    </main>
  );
}
