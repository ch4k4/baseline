import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { tokenPlatform, gagalAksi, pesanMuat } from '@/lib/guard';
import { PESAN_GAGAL, PESAN_SUKSES } from '@/lib/pesan';
import { muatKerangkaPlatform } from '@/lib/shell';
import {
  akhiriSesiSupport,
  bukaSesiSupport,
  daftarSesiSupport,
} from '@/lib/admin-api';
import { IS_PRODUCTION, SUPPORT_COOKIE, supportCookieOptions } from '@/lib/session';
import KartuGagal from '@/components/KartuGagal';
import KerangkaPlatform from '@/components/KerangkaPlatform';
import FormAksi, { HasilAksi } from '@/components/FormAksi';

export const dynamic = 'force-dynamic';

/**
 * Konsol platform: sesi dukungan break-glass (DEMO-0312, ADR-003 sec.2.2).
 *
 * Halaman ini adalah satu-satunya tempat platform dapat membuka akses ke data
 * tenant, dan bentuknya sengaja tidak nyaman: alasan wajib, kode alasan dari daftar
 * tertutup, durasi terbatas, dan scope bawaan READ_ONLY. Kemudahan di halaman ini
 * bukan kebaikan - setiap sesi adalah data tenant yang dibuka kepada orang di luar
 * tenant itu.
 *
 * Sesudah sesi terbuka, browser mendarat di dasbor TENANT dengan banner mode
 * support. Tokennya masuk ke cookie httpOnly tersendiri (demo_support), di sebelah
 * session platform yang tetap hidup - itulah yang membuat "Akhiri sesi" dapat
 * bekerja tanpa masuk ulang.
 */
export default async function SupportSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ gagal?: string; ok?: string; pesan?: string }>;
}) {
  const token = await tokenPlatform();
  const q = await searchParams;
  const kerangka = await muatKerangkaPlatform(token);

  const hasil = await daftarSesiSupport(token);
  const pesanError = hasil.ok ? null : pesanMuat(hasil);

  async function buka(_sebelumnya: HasilAksi | null, formData: FormData): Promise<HasilAksi> {
    'use server';
    const t = await tokenPlatform();
    const r = await bukaSesiSupport(t, {
      tenantId: String(formData.get('tenantId') ?? '').trim(),
      reasonCode: String(formData.get('reasonCode') ?? ''),
      reasonText: String(formData.get('reasonText') ?? '').trim(),
      // Bawaan READ_ONLY juga di sisi web: kotak centang yang tidak ditandai
      // tidak terkirim sama sekali, dan yang tidak terkirim tidak boleh menjadi
      // hak tulis.
      scope: formData.get('readWrite') === 'on' ? 'READ_WRITE' : 'READ_ONLY',
      durationMinutes: Number(formData.get('durationMinutes') ?? 30),
      ticketReference: String(formData.get('ticketReference') ?? '').trim() || null,
    });
    if (!r.ok) return gagalAksi(r, '/platform/support-sessions');

    const store = await cookies();
    store.set(
      SUPPORT_COOKIE,
      r.data.supportToken,
      supportCookieOptions(IS_PRODUCTION, r.data.expiresIn),
    );
    // Diturunkan menjadi READ_ONLY (tenant tidak ACTIVE) dikatakan apa adanya,
    // bukan disembunyikan: orang yang mengira punya hak tulis akan menyalahkan
    // aplikasi saat perubahannya ditolak.
    redirect(r.data.forcedReadOnly ? '/dashboard?ok=support-readonly' : '/dashboard?ok=support-mulai');
  }

  async function akhiri(_sebelumnya: HasilAksi | null, formData: FormData): Promise<HasilAksi> {
    'use server';
    const t = await tokenPlatform();
    const id = String(formData.get('id') ?? '');
    const r = await akhiriSesiSupport(t, id);
    if (!r.ok) return gagalAksi(r, '/platform/support-sessions');

    // Cookie support ikut dibuang bila yang diakhiri adalah sesi yang sedang
    // dipakai browser ini. Tidak ada cara memeriksanya dari sini tanpa membaca
    // token, jadi cookie dibuang apa pun sesinya: paling buruk, superadmin yang
    // mengakhiri sesi orang lain harus membuka sesinya sendiri lagi.
    const store = await cookies();
    store.delete(SUPPORT_COOKIE);
    redirect('/platform/support-sessions?ok=sesi-diakhiri');
  }

  const sessions = hasil.ok ? hasil.data.sessions : [];

  return (
    <KerangkaPlatform menu={kerangka.menu} aktif="/platform/support-sessions">
        <h1>Sesi dukungan</h1>
        <p className="sub">
          Membuka akses ke data satu tenant untuk waktu terbatas, dengan alasan tercatat. Tenant
          melihat kejadian ini di layar Keamanan miliknya, dan audit mencatatnya di kedua sisi.
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

        {pesanError && <KartuGagal judul="Tidak dapat memuat sesi dukungan" pesan={pesanError} />}

        {!pesanError && (
          <div className="card" data-testid="buka-sesi">
            <h2 className="judul-kartu">Buka sesi dukungan</h2>
            <FormAksi aksi={buka}>
              <div className="filter-baris">
                <div>
                  <label htmlFor="tenantId">Tenant id</label>
                  <input id="tenantId" name="tenantId" required autoComplete="off" />
                </div>
                <div>
                  <label htmlFor="reasonCode">Alasan</label>
                  <select id="reasonCode" name="reasonCode" defaultValue="TENANT_REPORTED_BUG">
                    <option value="TENANT_REPORTED_BUG">Tenant melaporkan gangguan</option>
                    <option value="DATA_INVESTIGATION">Penelusuran data</option>
                    <option value="SECURITY_INCIDENT">Insiden keamanan</option>
                    <option value="DATA_CORRECTION_REQUESTED_BY_TENANT">
                      Perbaikan data atas permintaan tenant
                    </option>
                  </select>
                </div>
                <div>
                  <label htmlFor="durationMinutes">Durasi (menit)</label>
                  <input
                    id="durationMinutes"
                    name="durationMinutes"
                    type="number"
                    min={1}
                    max={60}
                    defaultValue={30}
                  />
                </div>
                <div>
                  <label htmlFor="ticketReference">Nomor tiket</label>
                  <input id="ticketReference" name="ticketReference" maxLength={64} autoComplete="off" />
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <label htmlFor="reasonText">Keterangan</label>
                <textarea
                  id="reasonText"
                  name="reasonText"
                  required
                  minLength={10}
                  maxLength={500}
                  rows={2}
                  data-testid="reason-text"
                />
              </div>

              <div style={{ marginTop: 10 }}>
                <label htmlFor="readWrite">
                  <input id="readWrite" name="readWrite" type="checkbox" data-testid="scope-read-write" />{' '}
                  Izinkan perbaikan data (READ_WRITE)
                </label>
              </div>

              <div style={{ marginTop: 10 }}>
                <button type="submit" data-testid="buka-sesi-submit">
                  Buka sesi
                </button>
              </div>
            </FormAksi>
            <p className="hint" data-testid="petunjuk-sesi">
              Keterangan wajib dan disimpan terenkripsi, karena alasan yang sungguhan sering menyebut
              orang. READ_WRITE hanya berlaku untuk alasan &quot;perbaikan data atas permintaan
              tenant&quot;, hanya untuk memperbaiki nama tampilan anggota, dan tidak pernah untuk
              mengubah role, keanggotaan, maupun undangan. Tenant yang tidak aktif selalu
              diturunkan menjadi READ_ONLY. Maksimal 60 menit, tidak dapat diperpanjang, dan satu
              sesi aktif per superadmin.
            </p>
          </div>
        )}

        {!pesanError && (
          <div className="card" style={{ marginTop: 20 }}>
            <FormAksi aksi={akhiri} className="tanpa-bingkai">
              <div className="tabel-gulir">
                <table data-testid="sesi-table">
                  <thead>
                    <tr>
                      <th>Tenant</th>
                      <th>Scope</th>
                      <th>Alasan</th>
                      <th>Mulai</th>
                      <th>Berakhir</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.id} data-testid={`sesi-${s.id}`}>
                        <td>
                          <code>{s.tenant_id}</code>
                        </td>
                        <td>{s.scope}</td>
                        <td>
                          {s.reason_code}
                          {s.ticket_reference ? ` (${s.ticket_reference})` : ''}
                        </td>
                        <td>{new Date(s.started_at).toLocaleString('id-ID')}</td>
                        <td>
                          {new Date(s.ended_at ?? s.expires_at).toLocaleString('id-ID')}
                          {s.end_reason ? ` - ${s.end_reason}` : ''}
                        </td>
                        <td>
                          <span className="chip kecil" data-testid={`status-${s.id}`}>
                            {s.status}
                          </span>
                        </td>
                        <td>
                          {s.status === 'ACTIVE' && (
                            <button
                              type="submit"
                              name="id"
                              value={s.id}
                              data-testid={`akhiri-${s.id}`}
                            >
                              Akhiri
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </FormAksi>
            {sessions.length === 0 && (
              <p className="kosong" data-testid="sesi-kosong">
                Belum ada sesi dukungan. Daftar ini memuat sesi seluruh superadmin, bukan hanya milik
                Anda: sesi break-glass hanya dapat dipertanggungjawabkan bila terlihat oleh yang lain.
              </p>
            )}
          </div>
        )}
    </KerangkaPlatform>
  );
}
