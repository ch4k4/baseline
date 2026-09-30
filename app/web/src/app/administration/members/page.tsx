import Link from 'next/link';
import { tokenHalaman, pesanMuat } from '@/lib/guard';
import { PESAN_GAGAL, PESAN_SUKSES } from '@/lib/pesan';
import { muatKerangka } from '@/lib/shell';
import { daftarAnggota, daftarRole } from '@/lib/admin-api';
import Kerangka from '@/components/Kerangka';
import KartuGagal from '@/components/KartuGagal';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { ACTIVE: 'Aktif', SUSPENDED: 'Ditangguhkan', ENDED: 'Berakhir' };
const BATAS = 10;

function angka(raw: string | undefined, bawaan: number, min = 0, max = 100_000): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : bawaan;
}

/**
 * Daftar anggota tenant (DEMO-0305, layar DEMO-0307).
 *
 * Filter dan paginasi dikerjakan API, bukan di sini: menyaring di browser berarti
 * halaman pernah memegang baris yang tidak diminta. Halaman hanya meneruskan
 * parameter dan menampilkan hasilnya.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string; roleId?: string; email?: string; offset?: string; limit?: string;
    gagal?: string; ok?: string; pesan?: string;
  }>;
}) {
  const token = await tokenHalaman();
  const q = await searchParams;
  const k = await muatKerangka(token);

  const offset = angka(q.offset, 0);
  // Ukuran halaman boleh diminta lewat URL (1..100, sama dengan batas API).
  // Ini bukan kenyamanan: tanpa itu, paginasi hanya dapat diuji dengan membuat
  // puluhan anggota palsu, dan yang diuji menjadi seed, bukan paginasinya.
  const batas = angka(q.limit, BATAS, 1, 100);
  const hasil = await daftarAnggota(token, {
    status: q.status || undefined,
    roleId: q.roleId || undefined,
    email: q.email || undefined,
    limit: batas,
    offset,
  });
  // Kegagalan memuat dirender di tempat, bukan dipantulkan ke halaman ini lagi.
  const pesanError = hasil.ok ? null : pesanMuat(hasil);

  // Daftar role hanya untuk isian filter. Kegagalannya tidak menggagalkan halaman.
  const roles = !pesanError && k.permissions.includes('roles.read') ? await daftarRole(token) : null;
  const daftarRoleFilter = roles && roles.ok ? roles.data.roles.filter((r) => !r.archived) : [];

  const { members, page } = hasil.ok
    ? hasil.data
    : { members: [], page: { limit: batas, offset, total: 0 } };
  const sampai = Math.min(page.offset + page.limit, page.total);
  const dasar = (o: number) => {
    const p = new URLSearchParams();
    if (q.status) p.set('status', q.status);
    if (q.roleId) p.set('roleId', q.roleId);
    if (q.email) p.set('email', q.email);
    if (q.limit) p.set('limit', q.limit);
    if (o > 0) p.set('offset', String(o));
    const s = p.toString();
    return s ? `/administration/members?${s}` : '/administration/members';
  };

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
      <h1>Anggota</h1>
      {!pesanError && (
        <p className="sub">
          {page.total} anggota di tenant ini. Daftar tidak difilter oleh kode halaman: yang
          menyaringnya Row Level Security di PostgreSQL, berdasarkan tenant pada session Anda.
        </p>
      )}

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

      {pesanError && <KartuGagal judul="Tidak dapat memuat anggota" pesan={pesanError} />}

      {!pesanError && (
      <>
      <form className="card filter" method="get" data-testid="filter">
        <div className="filter-baris">
          <div>
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={q.status ?? ''}>
              <option value="">Semua</option>
              <option value="ACTIVE">Aktif</option>
              <option value="SUSPENDED">Ditangguhkan</option>
              <option value="ENDED">Berakhir</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-role">Role</label>
            <select id="f-role" name="roleId" defaultValue={q.roleId ?? ''}>
              <option value="">Semua</option>
              {daftarRoleFilter.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-email">Email (persis)</label>
            <input id="f-email" name="email" type="email" defaultValue={q.email ?? ''} autoComplete="off" />
          </div>
          <div className="filter-tombol">
            <button type="submit" data-testid="filter-terapkan">
              Terapkan
            </button>
            {q.limit && <input type="hidden" name="limit" value={q.limit} />}
            <Link className="ghost-link" href="/administration/members" data-testid="filter-bersihkan">
              Bersihkan
            </Link>
          </div>
        </div>
      </form>

      <div className="card">
        {members.length === 0 ? (
          <p className="kosong" data-testid="anggota-kosong">
            Tidak ada anggota yang cocok dengan filter ini.
          </p>
        ) : (
          <div className="tabel-gulir">
            <table data-testid="members-table">
              <thead>
                <tr>
                  <th>Nama tampilan</th>
                  <th>Email kontak</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.membership_id} data-testid={`anggota-${m.membership_id}`}>
                    <td>{m.display_name}</td>
                    <td>{m.contact_email_masked}</td>
                    <td>
                      {m.roles.length === 0 ? (
                        <span className="muted">tanpa role</span>
                      ) : (
                        m.roles.map((r) => (
                          <span key={r.id} className="chip kecil">
                            {r.name}
                          </span>
                        ))
                      )}
                    </td>
                    <td data-testid="anggota-status">{STATUS[m.status] ?? m.status}</td>
                    <td>
                      <Link href={`/administration/members/${m.membership_id}`} data-testid="anggota-detail">
                        Kelola
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {page.total > page.limit && (
        <div className="paginasi" data-testid="paginasi">
          <span>
            {page.total === 0 ? 0 : page.offset + 1}-{sampai} dari {page.total}
          </span>
          <span className="paginasi-aksi">
            {page.offset > 0 && (
              <Link href={dasar(Math.max(0, page.offset - page.limit))} data-testid="paginasi-sebelumnya">
                Sebelumnya
              </Link>
            )}
            {sampai < page.total && (
              <Link href={dasar(page.offset + page.limit)} data-testid="paginasi-berikutnya">
                Berikutnya
              </Link>
            )}
          </span>
        </div>
      )}
      </>
      )}
    </Kerangka>
  );
}
