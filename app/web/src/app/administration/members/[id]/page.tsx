import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tokenHalaman, tokenAksi, pengalihanGagal, gagalAksi } from '@/lib/guard';
import { PESAN_GAGAL, PESAN_SUKSES } from '@/lib/pesan';
import { muatKerangka } from '@/lib/shell';
import { anggota, daftarRole, gantiRoleAnggota, ubahProfil } from '@/lib/admin-api';
import Kerangka from '@/components/Kerangka';
import FormAksi, { HasilAksi } from '@/components/FormAksi';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { ACTIVE: 'Aktif', SUSPENDED: 'Ditangguhkan', ENDED: 'Berakhir' };

/**
 * Kelola satu anggota (DEMO-0305/0307).
 *
 * Setiap perubahan membawa `version` yang dibaca bersama halaman ini. Kalau
 * orang lain mengubah anggota yang sama lebih dulu, API menjawab 409 dan
 * halaman menampilkan keadaan terbaru - bukan menimpa perubahan orang itu.
 */
export default async function MemberDetailPage({
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
  const kembali = `/administration/members/${id}`;

  const hasil = await anggota(token, id);
  if (!hasil.ok) {
    // Anggota tenant lain tidak "ditolak", melainkan tidak ada (404 dari API).
    if (hasil.reason === 'NOTFOUND') redirect('/administration/members?gagal=hilang');
    pengalihanGagal(hasil, '/administration/members');
  }
  const m = hasil.data;

  const bolehRole = k.permissions.includes('members.assign_role') && k.permissions.includes('roles.read');
  const daftar = bolehRole ? await daftarRole(token) : null;
  const rolePilihan = daftar && daftar.ok ? daftar.data.roles.filter((r) => !r.archived || m.roles.some((x) => x.id === r.id)) : [];

  // Hasil aksi dikembalikan ke formulir, bukan dipantulkan ke alamat halaman
  // (lihat components/FormAksi.tsx). revalidatePath membuat versi dan daftar
  // role di layar ikut segar, sehingga percobaan berikutnya memakai versi baru.
  async function simpanNama(_sebelumnya: HasilAksi | null, formData: FormData): Promise<HasilAksi> {
    'use server';
    const t = await tokenAksi();
    const nama = String(formData.get('displayName') ?? '').trim();
    const versi = Number(formData.get('version'));
    const hasil = await ubahProfil(t, id, nama, versi);
    if (!hasil.ok) {
      // Versi basi: halaman disegarkan supaya yang terlihat adalah keadaan
      // terbaru, bukan angka yang sudah gagal dipakai.
      if (hasil.reason === 'CONFLICT') revalidatePath(kembali);
      return gagalAksi(hasil, '/administration/members');
    }
    revalidatePath(kembali);
    return { ok: 'profil-disimpan' };
  }

  async function simpanRole(_sebelumnya: HasilAksi | null, formData: FormData): Promise<HasilAksi> {
    'use server';
    const t = await tokenAksi();
    const roleIds = formData.getAll('roleIds').map(String).filter(Boolean);
    const versi = Number(formData.get('version'));
    const hasil = await gantiRoleAnggota(t, id, roleIds, versi);
    if (!hasil.ok) {
      // Versi basi: halaman disegarkan supaya yang terlihat adalah keadaan
      // terbaru, bukan angka yang sudah gagal dipakai.
      if (hasil.reason === 'CONFLICT') revalidatePath(kembali);
      return gagalAksi(hasil, '/administration/members');
    }
    revalidatePath(kembali);
    return { ok: 'role-disimpan' };
  }

  const aksiStatus = m.status === 'ACTIVE' ? 'tangguhkan' : m.status === 'SUSPENDED' ? 'aktifkan' : null;

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
      <p className="remah">
        <Link href="/administration/members" data-testid="kembali-anggota">
          &larr; Anggota
        </Link>
      </p>
      <h1 data-testid="anggota-nama">{m.display_name}</h1>
      <p className="sub">
        {m.contact_email_masked} &middot;{' '}
        <span data-testid="anggota-status">{STATUS[m.status] ?? m.status}</span> &middot; versi{' '}
        <span data-testid="anggota-versi">{m.version}</span>
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

      <div className="card">
        <h2 className="judul-kartu">Nama tampilan</h2>
        {k.permissions.includes('members.update_profile') ? (
          <FormAksi aksi={simpanNama}>
            <label htmlFor="displayName">Nama tampilan di tenant ini</label>
            <input
              id="displayName"
              name="displayName"
              defaultValue={m.display_name}
              maxLength={100}
              required
              autoComplete="off"
            />
            <input type="hidden" name="version" value={m.version} />
            <button type="submit" data-testid="simpan-nama">
              Simpan
            </button>
          </FormAksi>
        ) : (
          <p className="kosong">Anda tidak punya hak mengubah profil anggota.</p>
        )}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="judul-kartu">Role</h2>
        {bolehRole ? (
          <FormAksi aksi={simpanRole}>
            <ul className="pilihan" data-testid="pilihan-role">
              {rolePilihan.map((r) => (
                <li key={r.id}>
                  <label className="baris-pilihan">
                    <input
                      type="checkbox"
                      name="roleIds"
                      value={r.id}
                      defaultChecked={m.roles.some((x) => x.id === r.id)}
                      data-testid={`role-${r.code}`}
                    />
                    <span>
                      {r.name} <code>{r.code}</code>
                      {r.archived && <span className="chip kecil">diarsipkan</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <input type="hidden" name="version" value={m.version} />
            <button type="submit" data-testid="simpan-role">
              Simpan role
            </button>
            <p className="hint" style={{ marginBottom: 0 }}>
              Anda hanya dapat memberi atau mencabut role yang seluruh permission-nya Anda pegang
              sendiri, dan tidak dapat mengubah role Anda sendiri. Penolakan datang dari API, bukan
              dari halaman ini.
            </p>
          </FormAksi>
        ) : (
          <>
            <ul className="chips" data-testid="role-anggota">
              {m.roles.length === 0 ? (
                <li className="kosong">Tanpa role.</li>
              ) : (
                m.roles.map((r) => (
                  <li key={r.id} className="chip">
                    {r.name}
                  </li>
                ))
              )}
            </ul>
            <p className="kosong">Anda tidak punya hak mengubah role anggota.</p>
          </>
        )}
      </div>

      {k.permissions.includes('members.suspend') && aksiStatus && (
        <div className="card" style={{ marginTop: 20 }}>
          <h2 className="judul-kartu">Status keanggotaan</h2>
          <p className="kosong" style={{ marginBottom: 12 }}>
            {m.status === 'ACTIVE'
              ? 'Menangguhkan anggota mencabut seluruh session-nya di tenant ini.'
              : 'Mengaktifkan kembali tidak menghidupkan session lama: anggota perlu masuk lagi.'}
          </p>
          <Link
            className="tombol-danger"
            href={`/administration/members/${id}/konfirmasi?aksi=${aksiStatus}&versi=${m.version}`}
            data-testid={aksiStatus === 'tangguhkan' ? 'aksi-tangguhkan' : 'aksi-aktifkan'}
          >
            {aksiStatus === 'tangguhkan' ? 'Tangguhkan anggota' : 'Aktifkan kembali'}
          </Link>
        </div>
      )}
    </Kerangka>
  );
}
