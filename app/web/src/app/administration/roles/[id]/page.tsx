import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tokenHalaman, tokenAksi, pengalihanGagal, gagalAksi } from '@/lib/guard';
import { PESAN_GAGAL, PESAN_SUKSES } from '@/lib/pesan';
import { muatKerangka } from '@/lib/shell';
import { gantiNamaRole, gantiPermissionRole, katalogPermission, role } from '@/lib/admin-api';
import Kerangka from '@/components/Kerangka';
import FormAksi, { HasilAksi } from '@/components/FormAksi';

export const dynamic = 'force-dynamic';

/**
 * Editor satu role (AC DEMO-0307: "role permission editor menggunakan server
 * catalog dan current state").
 *
 * Daftar permission yang dapat dicentang datang dari GET /permissions - katalog
 * server, bukan daftar yang ditulis ulang di kode web. Centang awal datang dari
 * isi role saat ini. Dengan begitu permission baru muncul otomatis, dan
 * permission yang sudah pensiun tidak pernah ditawarkan.
 */
export default async function RoleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ gagal?: string; ok?: string; pesan?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const token = await tokenHalaman();
  const k = await muatKerangka(token);
  const kembali = `/administration/roles/${id}`;

  const hasil = await role(token, id);
  if (!hasil.ok) {
    if (hasil.reason === 'NOTFOUND') redirect('/administration/roles?gagal=hilang');
    pengalihanGagal(hasil, '/administration/roles');
  }
  const r = hasil.data;

  const bolehIsi = k.permissions.includes('roles.assign_permission') && k.permissions.includes('permissions.read');
  const katalog = bolehIsi ? await katalogPermission(token) : null;
  const daftarPermission = katalog && katalog.ok ? katalog.data.permissions : [];

  async function simpanNama(_sebelumnya: HasilAksi | null, formData: FormData): Promise<HasilAksi> {
    'use server';
    const t = await tokenAksi();
    const name = String(formData.get('name') ?? '').trim();
    const versi = Number(formData.get('version'));
    const hasil = await gantiNamaRole(t, id, name, versi);
    if (!hasil.ok) {
      if (hasil.reason === 'CONFLICT') revalidatePath(kembali);
      return gagalAksi(hasil, '/administration/roles');
    }
    revalidatePath(kembali);
    return { ok: 'nama-disimpan' };
  }

  async function simpanPermission(_sebelumnya: HasilAksi | null, formData: FormData): Promise<HasilAksi> {
    'use server';
    const t = await tokenAksi();
    const permissions = formData.getAll('permissions').map(String).filter(Boolean);
    const versi = Number(formData.get('version'));
    const hasil = await gantiPermissionRole(t, id, permissions, versi);
    if (!hasil.ok) {
      if (hasil.reason === 'CONFLICT') revalidatePath(kembali);
      return gagalAksi(hasil, '/administration/roles');
    }
    revalidatePath(kembali);
    return { ok: 'permission-disimpan' };
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
      <p className="remah">
        <Link href="/administration/roles" data-testid="kembali-role">
          &larr; Role
        </Link>
      </p>
      <h1 data-testid="role-nama">{r.name}</h1>
      <p className="sub">
        <code>{r.code}</code> &middot; {r.active_members} anggota aktif &middot; versi{' '}
        <span data-testid="role-versi">{r.version}</span>
        {r.is_system && <span className="chip kecil">role sistem</span>}
        {r.archived && <span className="chip kecil">diarsipkan</span>}
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

      {r.is_system && (
        <p className="notice" data-testid="role-sistem-catatan">
          Role sistem dibuat oleh seed dan tidak dapat diubah tenant. Larangan itu ditegakkan
          database, bukan oleh halaman ini: mencoba lewat API tetap ditolak.
        </p>
      )}

      <div className="card">
        <h2 className="judul-kartu">Nama</h2>
        {k.permissions.includes('roles.update') && !r.is_system && !r.archived ? (
          <FormAksi aksi={simpanNama}>
            <label htmlFor="role-name">Nama role</label>
            <input id="role-name" name="name" defaultValue={r.name} maxLength={100} required autoComplete="off" />
            <input type="hidden" name="version" value={r.version} />
            <button type="submit" data-testid="simpan-nama-role">
              Simpan
            </button>
          </FormAksi>
        ) : (
          <p className="kosong">Nama role ini tidak dapat diubah dari sini.</p>
        )}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="judul-kartu">Permission</h2>
        {bolehIsi && !r.is_system && !r.archived ? (
          <FormAksi aksi={simpanPermission}>
            <ul className="pilihan" data-testid="editor-permission">
              {daftarPermission.map((p) => (
                <li key={p.code}>
                  <label className="baris-pilihan">
                    <input
                      type="checkbox"
                      name="permissions"
                      value={p.code}
                      defaultChecked={r.permissions.includes(p.code)}
                      data-testid={`permission-${p.code}`}
                    />
                    <span>
                      <code>{p.code}</code>
                      <br />
                      <span className="muted">{p.description}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <input type="hidden" name="version" value={r.version} />
            <button type="submit" data-testid="simpan-permission">
              Simpan permission
            </button>
            <p className="hint" style={{ marginBottom: 0 }}>
              Anda hanya dapat memasang permission yang Anda pegang sendiri, dan tenant harus tetap
              punya minimal satu anggota aktif yang dapat mengatur role. Keduanya ditegakkan API.
            </p>
          </FormAksi>
        ) : (
          <ul className="chips" data-testid="permission-role">
            {r.permissions.length === 0 ? (
              <li className="kosong">Role ini belum memuat permission apa pun.</li>
            ) : (
              r.permissions.map((p) => (
                <li key={p} className="chip">
                  <code>{p}</code>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {k.permissions.includes('roles.archive') && !r.is_system && !r.archived && (
        <div className="card" style={{ marginTop: 20 }}>
          <h2 className="judul-kartu">Arsipkan</h2>
          <p className="kosong" style={{ marginBottom: 12 }}>
            Role yang diarsipkan berhenti memberi akses, dan penugasan yang berjalan ikut diakhiri.
            Riwayatnya tetap tersimpan.
          </p>
          <Link
            className="tombol-danger"
            href={`/administration/roles/${id}/konfirmasi?versi=${r.version}`}
            data-testid="aksi-arsipkan"
          >
            Arsipkan role
          </Link>
        </div>
      )}
    </Kerangka>
  );
}
