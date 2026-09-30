import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { tokenHalaman, tokenAksi, gagalAksi, pesanMuat } from '@/lib/guard';
import { PESAN_GAGAL, PESAN_SUKSES } from '@/lib/pesan';
import { muatKerangka } from '@/lib/shell';
import { daftarRole, daftarUndangan, undang } from '@/lib/admin-api';
import Kerangka from '@/components/Kerangka';
import FormAksi, { HasilAksi } from '@/components/FormAksi';
import KartuGagal from '@/components/KartuGagal';

export const dynamic = 'force-dynamic';

const LABEL: Record<string, string> = {
  PENDING: 'Menunggu',
  ACCEPTED: 'Diterima',
  EXPIRED: 'Kedaluwarsa',
  REVOKED: 'Dicabut',
};

/**
 * Undangan anggota (DEMO-0304/0309, layar DEMO-0307).
 *
 * Halaman ini tidak pernah memberi tahu apakah sebuah email sudah punya akun:
 * API menjawab 202 yang sama untuk keduanya, dan pesan sukses di sini pun satu
 * (AC DEMO-0307). Tautan penerimaan tidak pernah ditampilkan - hanya ditulis ke
 * outbox di komputer yang menjalankan API.
 */
export default async function InvitationsPage({
  searchParams,
}: {
  searchParams: Promise<{ gagal?: string; ok?: string; pesan?: string }>;
}) {
  const token = await tokenHalaman();
  const q = await searchParams;
  const k = await muatKerangka(token);

  const hasil = await daftarUndangan(token);
  const pesanError = hasil.ok ? null : pesanMuat(hasil);

  const bolehUndang = k.permissions.includes('members.invite');
  const roles = !pesanError && k.permissions.includes('roles.read') ? await daftarRole(token) : null;
  const rolePilihan = roles && roles.ok ? roles.data.roles.filter((r) => !r.archived) : [];

  async function kirim(_sebelumnya: HasilAksi | null, formData: FormData): Promise<HasilAksi> {
    'use server';
    const t = await tokenAksi();
    const email = String(formData.get('email') ?? '').trim();
    const roleIds = formData.getAll('roleIds').map(String).filter(Boolean);
    if (!email) return { gagal: 'Email wajib diisi.' };
    const hasil = await undang(t, email, roleIds);
    if (!hasil.ok) return gagalAksi(hasil, '/administration/invitations');
    revalidatePath('/administration/invitations');
    return { ok: 'terkirim' };
  }

  const undangan = hasil.ok ? hasil.data.invitations : [];

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
      <h1>Undangan</h1>
      <p className="sub">Undangan berlaku sekali pakai dan punya batas waktu.</p>

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

      {pesanError && <KartuGagal judul="Tidak dapat memuat undangan" pesan={pesanError} />}

      {!pesanError && bolehUndang && (
        <div className="card" data-testid="invite-section">
          <h2 className="judul-kartu">Undang anggota</h2>
          <FormAksi aksi={kirim}>
            <label htmlFor="invite-email">Email</label>
            <input id="invite-email" name="email" type="email" required autoComplete="off" />

            {rolePilihan.length > 0 && (
              <>
                <span className="label-blok">Role saat undangan diterima (opsional)</span>
                <ul className="pilihan" data-testid="pilihan-role-undangan">
                  {rolePilihan.map((r) => (
                    <li key={r.id}>
                      <label className="baris-pilihan">
                        <input type="checkbox" name="roleIds" value={r.id} data-testid={`undangan-role-${r.code}`} />
                        <span>
                          {r.name} <code>{r.code}</code>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <button type="submit" data-testid="invite-submit">
              Kirim undangan
            </button>
          </FormAksi>
          <p className="hint" style={{ marginBottom: 0 }}>
            Demo: undangan tidak dikirim lewat email, melainkan ditulis sebagai berkas ke folder
            outbox di komputer yang menjalankan API (<code>~/.saas-demo/outbox</code>).
          </p>
        </div>
      )}

      {!pesanError && (
      <div className="card" style={{ marginTop: bolehUndang ? 20 : 0 }}>
        <h2 className="judul-kartu">Daftar undangan</h2>
        {undangan.length === 0 ? (
          <p className="kosong" data-testid="undangan-kosong">
            Belum ada undangan di tenant ini.
          </p>
        ) : (
          <div className="tabel-gulir">
            <table data-testid="invitations-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Berlaku sampai</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {undangan.map((i) => (
                  <tr key={i.id} data-testid={`invitation-${i.id}`}>
                    <td>{i.email_masked}</td>
                    <td data-testid="invitation-status">{LABEL[i.status] ?? i.status}</td>
                    <td>{new Date(i.expires_at).toLocaleString('id-ID')}</td>
                    <td>
                      {i.status === 'PENDING' && bolehUndang && (
                        <Link
                          href={`/administration/invitations/${i.id}/konfirmasi`}
                          data-testid="invitation-revoke"
                        >
                          Cabut
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </Kerangka>
  );
}
