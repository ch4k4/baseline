import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tokenPlatform, gagalAksi, pesanMuat } from '@/lib/guard';
import { PESAN_GAGAL, PESAN_SUKSES } from '@/lib/pesan';
import { muatKerangkaPlatform } from '@/lib/shell';
import { beriAdminPlatform, daftarAdminPlatform } from '@/lib/admin-api';
import KartuGagal from '@/components/KartuGagal';
import KerangkaPlatform from '@/components/KerangkaPlatform';
import FormAksi, { HasilAksi } from '@/components/FormAksi';

export const dynamic = 'force-dynamic';

/**
 * Konsol platform: admin platform (DEMO-0311).
 *
 * KERANGKANYA BUKAN KERANGKA TENANT, dan itu disengaja. Kerangka tenant memuat
 * nama tenant aktif, pemindah tenant, dan navigasi administrasi tenant - tidak
 * satu pun berlaku di sini, karena session platform tidak membuka data tenant
 * mana pun (ADR-003 sec.2.1). Memakai kerangka yang sama akan membuat dua tempat
 * yang berbeda hak terlihat seperti satu tempat.
 *
 * Yang belum ada di sini dan memang belum dijanjikan: registry tenant dan audit
 * platform (DEMO-0409). Sesi dukungan ada di halaman tersendiri sejak DEMO-0312.
 */
export default async function PlatformAdminsPage({
  searchParams,
}: {
  searchParams: Promise<{ gagal?: string; ok?: string; pesan?: string }>;
}) {
  const token = await tokenPlatform();
  const q = await searchParams;
  const kerangka = await muatKerangkaPlatform(token);

  const hasil = await daftarAdminPlatform(token);
  // Session tenant yang membuka alamat ini mendapat 403 dari API, dan pesanMuat
  // mengalihkannya ke /403 - bukan mengeluarkannya dari aplikasi.
  const pesanError = hasil.ok ? null : pesanMuat(hasil);

  async function beri(_sebelumnya: HasilAksi | null, formData: FormData): Promise<HasilAksi> {
    'use server';
    const t = await tokenPlatform();
    const userId = String(formData.get('userId') ?? '').trim();
    const reason = String(formData.get('reason') ?? '').trim();
    const r = await beriAdminPlatform(t, userId, reason);
    if (!r.ok) return gagalAksi(r, '/platform/admins');
    redirect('/platform/admins?ok=admin-diberi');
  }

  const admins = hasil.ok ? hasil.data.admins : [];

  return (
    <KerangkaPlatform menu={kerangka.menu} aktif="/platform/admins">
        <h1>Admin platform</h1>
        <p className="sub">
          Pemegang hak platform. Hak ini tidak memberi akses ke data tenant mana pun: untuk itu
          diperlukan sesi dukungan berbatas waktu, di halaman Sesi dukungan.
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

        {pesanError && <KartuGagal judul="Tidak dapat memuat admin platform" pesan={pesanError} />}

        {!pesanError && (
          <div className="card" data-testid="beri-admin">
            <h2 className="judul-kartu">Beri hak admin platform</h2>
            <FormAksi aksi={beri}>
              <div className="filter-baris">
                <div>
                  <label htmlFor="userId">User id</label>
                  <input
                    id="userId"
                    name="userId"
                    required
                    autoComplete="off"
                    aria-describedby="userId-hint"
                  />
                </div>
                <div>
                  <label htmlFor="reason">Alasan</label>
                  <input id="reason" name="reason" maxLength={200} autoComplete="off" />
                </div>
                <div className="filter-tombol">
                  <button type="submit" data-testid="beri-admin-submit">
                    Beri hak
                  </button>
                </div>
              </div>
            </FormAksi>
            <p className="hint" id="userId-hint" data-testid="petunjuk-user-id">
              Dimasukkan sebagai user id, bukan email. Superadmin tidak membaca email maupun nama
              identitas global dalam bentuk terbuka, dan pencarian identitas lewat email akan
              menjadi jalan baru untuk menebak siapa yang terdaftar di platform. Alasan bukan
              tempat data pribadi: alamat email ditolak; nomor tiket boleh.
            </p>
          </div>
        )}

        {!pesanError && (
          <div className="card" style={{ marginTop: 20 }}>
            <div className="tabel-gulir">
              <table data-testid="admins-table">
                <thead>
                  <tr>
                    <th>User id</th>
                    <th>Role</th>
                    <th>Sejak</th>
                    <th>Alasan</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {admins.map((a) => (
                    <tr key={a.id} data-testid={`admin-${a.user_id}`}>
                      <td>
                        <code>{a.user_id}</code>
                      </td>
                      <td>
                        <code>{a.role_code}</code>
                      </td>
                      <td>{new Date(a.granted_at).toLocaleString('id-ID')}</td>
                      <td>{a.reason ?? '-'}</td>
                      <td>
                        <Link href={`/platform/admins/${a.id}/konfirmasi`} data-testid={`cabut-${a.user_id}`}>
                          Cabut
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </KerangkaPlatform>
  );
}
