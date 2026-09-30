import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tokenHalaman, tokenAksi, gagalAksi, pesanMuat } from '@/lib/guard';
import { PESAN_GAGAL, PESAN_SUKSES } from '@/lib/pesan';
import { muatKerangka } from '@/lib/shell';
import { buatRole, daftarRole } from '@/lib/admin-api';
import Kerangka from '@/components/Kerangka';
import KartuGagal from '@/components/KartuGagal';
import FormAksi, { HasilAksi } from '@/components/FormAksi';

export const dynamic = 'force-dynamic';

/**
 * Daftar role tenant (DEMO-0306, layar DEMO-0307).
 *
 * Role sistem (dari seed) ditampilkan tetapi tidak dapat diubah tenant: itu
 * ditegakkan policy database, bukan oleh halaman ini.
 */
export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ gagal?: string; ok?: string; pesan?: string }>;
}) {
  const token = await tokenHalaman();
  const q = await searchParams;
  const k = await muatKerangka(token);

  const hasil = await daftarRole(token);
  const pesanError = hasil.ok ? null : pesanMuat(hasil);

  async function buat(_sebelumnya: HasilAksi | null, formData: FormData): Promise<HasilAksi> {
    'use server';
    const t = await tokenAksi();
    const code = String(formData.get('code') ?? '').trim();
    const name = String(formData.get('name') ?? '').trim();
    const hasil = await buatRole(t, code, name);
    // Kegagalan yang dapat diperbaiki pengguna dikembalikan ke formulir; sukses
    // memang berpindah tempat, jadi ia mengalihkan ke role yang baru dibuat.
    if (!hasil.ok) return gagalAksi(hasil, '/administration/roles');
    redirect(`/administration/roles/${hasil.data.id}?ok=role-dibuat`);
  }

  const roles = hasil.ok ? hasil.data.roles : [];

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
      <h1>Role</h1>
      <p className="sub">
        Role adalah bundel permission. Keputusan akses selalu atas kode permission, tidak pernah
        atas nama role.
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

      {pesanError && <KartuGagal judul="Tidak dapat memuat role" pesan={pesanError} />}

      {!pesanError && k.permissions.includes('roles.create') && (
        <div className="card" data-testid="buat-role">
          <h2 className="judul-kartu">Buat role</h2>
          <FormAksi aksi={buat}>
            <div className="filter-baris">
              <div>
                <label htmlFor="role-code">Kode</label>
                <input
                  id="role-code"
                  name="code"
                  required
                  pattern="[a-z][a-z0-9_]{1,63}"
                  title="huruf kecil, angka, dan garis bawah; diawali huruf"
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="role-name">Nama</label>
                <input
                  id="role-name"
                  name="name"
                  required
                  maxLength={100}
                  autoComplete="off"
                  aria-describedby="role-name-peringatan"
                />
              </div>
              <div className="filter-tombol">
                <button type="submit" data-testid="buat-role-submit">
                  Buat
                </button>
              </div>
            </div>
          </FormAksi>
          <p className="hint" id="role-name-peringatan" data-testid="peringatan-nama-role">
            Nama role adalah label jabatan atau fungsi, bukan tempat data orang. Alamat email dan
            deretan 8 angka atau lebih (NIK, telepon, NPWP) ditolak: kolom ini tidak dienkripsi dan
            tampil di daftar anggota.
          </p>
        </div>
      )}

      {!pesanError && (
      <div className="card" style={{ marginTop: 20 }}>
        {roles.length === 0 ? (
          <p className="kosong" data-testid="role-kosong">
            Belum ada role di tenant ini.
          </p>
        ) : (
          <div className="tabel-gulir">
            <table data-testid="roles-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Kode</th>
                  <th>Permission</th>
                  <th>Anggota</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id} data-testid={`role-baris-${r.code}`}>
                    <td>
                      {r.name}
                      {r.is_system && <span className="chip kecil">sistem</span>}
                      {r.archived && <span className="chip kecil">diarsipkan</span>}
                    </td>
                    <td>
                      <code>{r.code}</code>
                    </td>
                    <td data-testid="role-jumlah-permission">{r.permissions.length}</td>
                    <td>{r.active_members}</td>
                    <td>
                      <Link href={`/administration/roles/${r.id}`} data-testid={`role-buka-${r.code}`}>
                        Buka
                      </Link>
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
