import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tokenPlatform, gagalAksi, pesanMuat } from '@/lib/guard';
import { cabutAdminPlatform, daftarAdminPlatform } from '@/lib/admin-api';
import KartuGagal from '@/components/KartuGagal';
import FormAksi, { HasilAksi } from '@/components/FormAksi';

export const dynamic = 'force-dynamic';

/**
 * Konfirmasi pencabutan hak admin platform.
 *
 * Halaman server, bukan confirm() di browser: keputusan seperti ini harus dapat
 * dibaca, ditinggalkan, dan dibuka ulang - dan halaman yang dirender server tetap
 * bekerja tanpa JavaScript (keputusan pemilik proyek slice 12).
 */
export default async function KonfirmasiCabutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const token = await tokenPlatform();
  const { id } = await params;

  const hasil = await daftarAdminPlatform(token);
  const pesanError = hasil.ok ? null : pesanMuat(hasil);
  const target = hasil.ok ? hasil.data.admins.find((a) => a.id === id) : undefined;

  async function cabut(_sebelumnya: HasilAksi | null): Promise<HasilAksi> {
    'use server';
    const t = await tokenPlatform();
    const r = await cabutAdminPlatform(t, id);
    if (!r.ok) return gagalAksi(r, '/platform/admins');
    redirect('/platform/admins?ok=admin-dicabut');
  }

  return (
    <main>
      <p>
        <Link href="/platform/admins" data-testid="kembali">
          Kembali ke admin platform
        </Link>
      </p>

      {pesanError && <KartuGagal judul="Tidak dapat memuat admin platform" pesan={pesanError} />}

      {!pesanError && !target && (
        <KartuGagal
          judul="Assignment tidak ditemukan"
          pesan="Hak itu mungkin sudah dicabut orang lain. Daftar terbaru ada di halaman admin platform."
        />
      )}

      {target && (
        <div className="card" data-testid="konfirmasi-cabut">
          <h1>Cabut hak admin platform?</h1>
          <p className="sub">
            Setelah dicabut, identitas ini kehilangan seluruh kewenangan platform pada saat ia
            masuk lagi. Session platform yang sedang berjalan belum ikut dicabut - itu bagian dari
            sesi dukungan (DEMO-0312) dan belum ada di baseline ini.
          </p>
          <p>
            User id: <code data-testid="konfirmasi-user-id">{target.user_id}</code>
          </p>
          <p>
            Role: <code>{target.role_code}</code>
          </p>
          <FormAksi aksi={cabut}>
            <button type="submit" data-testid="konfirmasi-cabut-submit">
              Ya, cabut hak ini
            </button>
          </FormAksi>
        </div>
      )}
    </main>
  );
}
