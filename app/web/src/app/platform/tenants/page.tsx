import Link from 'next/link';
import { tokenPlatform, pesanMuat } from '@/lib/guard';
import { PESAN_GAGAL, PESAN_SUKSES } from '@/lib/pesan';
import { muatKerangkaPlatform } from '@/lib/shell';
import { daftarTenantPlatform } from '@/lib/admin-api';
import KartuGagal from '@/components/KartuGagal';
import KerangkaPlatform from '@/components/KerangkaPlatform';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = {
  PROVISIONING: 'Disiapkan',
  ACTIVE: 'Aktif',
  SUSPENDED: 'Disuspend',
  ARCHIVED: 'Diarsipkan',
};

/** Status yang dapat diubah dari layar ini, dan ke mana (D-47). */
const AKSI: Record<string, { ke: 'ACTIVE' | 'SUSPENDED'; label: string }> = {
  ACTIVE: { ke: 'SUSPENDED', label: 'Suspend' },
  SUSPENDED: { ke: 'ACTIVE', label: 'Aktifkan' },
};

/**
 * Konsol platform: registry tenant (D-56).
 *
 * Yang ditampilkan hanya data control-plane - slug, nama, status, tanggal dibuat -
 * karena itu saja yang dikembalikan `GET /platform/tenants`. Isi tenant (anggota,
 * role, data) tidak terbuka dari session platform; untuk itu ada sesi dukungan.
 *
 * Tombol suspend/aktifkan tidak disembunyikan berdasarkan permission: yang menolak
 * tetap API (`platform.tenants.update_status`), dan penolakannya diarahkan ke /403.
 * Tenant PROVISIONING atau ARCHIVED tidak mendapat tombol karena tidak ada transisi
 * yang sah untuknya dari sini - bukan karena hak.
 *
 * Membuat tenant belum ada di layar ini; `POST /platform/tenants` tersedia di API.
 */
export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ gagal?: string; ok?: string; pesan?: string }>;
}) {
  const token = await tokenPlatform();
  const q = await searchParams;
  const kerangka = await muatKerangkaPlatform(token);

  const hasil = await daftarTenantPlatform(token);
  const pesanError = hasil.ok ? null : pesanMuat(hasil);
  const tenants = hasil.ok ? hasil.data.tenants : [];

  return (
    <KerangkaPlatform menu={kerangka.menu} aktif="/platform/tenants">
      <h1>Tenant</h1>
      <p className="sub">
        Registry tenant di platform ini. Mensuspend tenant memutus akses semua anggotanya pada
        permintaan berikutnya; datanya tidak disentuh.
      </p>

      {q.ok && (
        <p className="notice" role="status" data-testid="pesan-halaman">
          {PESAN_SUKSES[q.ok] ?? 'Perubahan disimpan.'}
        </p>
      )}
      {q.gagal && (
        <p className="error" role="alert" data-testid="pesan-halaman-gagal">
          {q.pesan ?? PESAN_GAGAL[q.gagal] ?? 'Permintaan gagal.'}
        </p>
      )}

      {pesanError && <KartuGagal judul="Tidak dapat memuat registry tenant" pesan={pesanError} />}

      {!pesanError && (
        <div className="card">
          <div className="tabel-gulir">
            <table data-testid="tenants-table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Slug</th>
                  <th>Status</th>
                  <th>Dibuat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => {
                  const aksi = AKSI[t.status];
                  return (
                    <tr key={t.id} data-testid={`tenant-${t.slug}`}>
                      <td>{t.name}</td>
                      <td>
                        <code>{t.slug}</code>
                      </td>
                      <td>
                        <span
                          className={t.status === 'ACTIVE' ? undefined : 'muted'}
                          data-testid={`status-${t.slug}`}
                        >
                          {STATUS[t.status] ?? t.status}
                        </span>
                      </td>
                      <td>{new Date(t.created_at).toLocaleString('id-ID')}</td>
                      <td>
                        {aksi && (
                          <Link
                            href={`/platform/tenants/${t.id}/konfirmasi?status=${aksi.ke}`}
                            data-testid={`ubah-${t.slug}`}
                          >
                            {aksi.label}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </KerangkaPlatform>
  );
}
