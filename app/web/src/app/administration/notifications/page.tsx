import { revalidatePath } from 'next/cache';
import { tokenHalaman, tokenAksi, gagalAksi, pesanMuat } from '@/lib/guard';
import { PESAN_GAGAL, PESAN_SUKSES } from '@/lib/pesan';
import { muatKerangka } from '@/lib/shell';
import { daftarNotifikasi, sesiSupportTenant, tandaiNotifikasiTerbaca } from '@/lib/admin-api';
import Kerangka from '@/components/Kerangka';
import KartuGagal from '@/components/KartuGagal';
import FormAksi, { HasilAksi } from '@/components/FormAksi';

export const dynamic = 'force-dynamic';

const JUDUL: Record<string, string> = {
  SUPPORT_SESSION_STARTED: 'Sesi dukungan platform dibuka ke tenant ini',
  SUPPORT_SESSION_ENDED: 'Sesi dukungan platform berakhir',
};

/**
 * Notifikasi keamanan tenant (DEMO-0313).
 *
 * Isi halaman ini adalah kesaksian tentang PLATFORM, bukan tentang tenant: kapan
 * orang dari platform membuka akses ke data tenant ini, dan kapan berhenti.
 * Tenant tidak dapat membuat maupun menghapusnya - hanya menandainya terbaca.
 *
 * Sampai DEMO-0312 selesai, daftar ini kosong dalam pemakaian normal. Halaman
 * yang kosong itu disengaja dan dikatakan apa adanya di layar, supaya tidak ada
 * yang menyimpulkan fiturnya rusak.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ gagal?: string; ok?: string; pesan?: string }>;
}) {
  const token = await tokenHalaman();
  const q = await searchParams;
  const k = await muatKerangka(token);

  const hasil = await daftarNotifikasi(token);
  const pesanError = hasil.ok ? null : pesanMuat(hasil);

  // Sesi dukungan atas tenant ini (DEMO-0312). Notifikasi memberi tahu bahwa
  // sesuatu terjadi; daftar ini memberi tahu APA: scope, alasan, dan kapan
  // berakhir. Gagal diam-diam - daftar ini pelengkap, dan halaman yang gagal total
  // karena pelengkapnya justru menyembunyikan notifikasinya.
  const sesi = await sesiSupportTenant(token);
  const daftarSesi = sesi.ok ? sesi.data.sessions : [];

  async function tandai(_sebelumnya: HasilAksi | null, formData: FormData): Promise<HasilAksi> {
    'use server';
    const t = await tokenAksi();
    const id = String(formData.get('id') ?? '');
    const r = await tandaiNotifikasiTerbaca(t, id);
    if (!r.ok) return gagalAksi(r, '/administration/notifications');
    // Hitungan di lonceng ikut berubah, jadi halaman dimuat ulang di server.
    revalidatePath('/administration/notifications');
    return { ok: 'notifikasi-dibaca' };
  }

  const daftar = hasil.ok ? hasil.data.notifications : [];

  return (
    <Kerangka
      tenantNama={k.tenantNama}
      tenantId={k.tenantId}
      contexts={k.contexts}
      permissions={k.permissions}
      belumDibaca={k.belumDibaca}
      support={k.support}
      menu={k.menu}
      aktif="/administration/notifications"
    >
      <h1>Keamanan</h1>
      <p className="sub">
        Kejadian keamanan yang menyangkut tenant ini. Dicatat platform, tidak dapat diubah maupun
        dihapus tenant.
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

      {pesanError && <KartuGagal judul="Tidak dapat memuat notifikasi" pesan={pesanError} />}

      {!pesanError && (
        <div className="card" data-testid="sesi-support-tenant" style={{ marginBottom: 20 }}>
          <h2 className="judul-kartu">Sesi dukungan platform</h2>
          {daftarSesi.length === 0 ? (
            <p className="kosong" data-testid="sesi-support-kosong">
              Belum ada sesi dukungan platform atas tenant ini.
            </p>
          ) : (
            <div className="tabel-gulir">
              <table data-testid="sesi-support-table">
                <thead>
                  <tr>
                    <th>Mulai</th>
                    <th>Scope</th>
                    <th>Alasan</th>
                    <th>Berakhir</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {daftarSesi.map((s) => (
                    <tr key={s.id} data-testid={`sesi-tenant-${s.id}`}>
                      <td>{new Date(s.started_at).toLocaleString('id-ID')}</td>
                      <td>{s.scope}</td>
                      <td>
                        {s.reason_code}
                        {s.ticket_reference ? ` (${s.ticket_reference})` : ''}
                      </td>
                      <td>
                        {new Date(s.ended_at ?? s.expires_at).toLocaleString('id-ID')}
                        {s.end_reason ? ` - ${s.end_reason}` : ''}
                      </td>
                      <td>
                        <span className="chip kecil">{s.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">
            Dicatat platform. Keterangan bebas yang ditulis petugas tidak ditampilkan di sini:
            kuncinya dipegang platform, bukan tenant. Yang terlihat adalah kode alasan, nomor tiket,
            scope, dan waktunya.
          </p>
        </div>
      )}

      {!pesanError && (
        <div className="card">
          {daftar.length === 0 ? (
            <p className="kosong" data-testid="notifikasi-kosong">
              Belum ada kejadian keamanan. Sesi dukungan platform (break-glass) belum tersedia di
              baseline ini, jadi daftar ini memang masih kosong.
            </p>
          ) : (
            // SATU formulir untuk seluruh tabel, dan tombol per baris membawa
            // id-nya lewat name/value. Bukan satu formulir per baris: baris yang
            // baru ditandai terbaca tidak lagi merender tombolnya, jadi pesan
            // hasil yang hidup di dalam formulir baris akan hilang bersama
            // barisnya - pesan sukses yang tidak pernah terbaca sama saja dengan
            // tidak ada. Memantulkannya ke alamat halaman bukan pilihan: itu pola
            // yang menyebabkan cacat D-26.
            <FormAksi aksi={tandai} className="tanpa-bingkai">
            <div className="tabel-gulir">
              <table data-testid="notifikasi-table">
                <thead>
                  <tr>
                    <th>Kejadian</th>
                    <th>Waktu</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {daftar.map((n) => (
                    <tr key={n.id} data-testid={`notifikasi-${n.id}`}>
                      <td>{JUDUL[n.type] ?? n.type}</td>
                      <td>{new Date(n.created_at).toLocaleString('id-ID')}</td>
                      <td>
                        {n.read_at ? (
                          <span className="chip kecil">sudah dibaca</span>
                        ) : (
                          <span className="chip kecil" data-testid="notifikasi-baru">
                            baru
                          </span>
                        )}
                      </td>
                      <td>
                        {!n.read_at && (
                          <button
                            type="submit"
                            name="id"
                            value={n.id}
                            data-testid={`tandai-${n.id}`}
                          >
                            Tandai terbaca
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </FormAksi>
          )}
        </div>
      )}
    </Kerangka>
  );
}
