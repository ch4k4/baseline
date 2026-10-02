/**
 * Menerjemahkan kegagalan koneksi PostgreSQL menjadi kalimat yang menyebut obatnya.
 *
 * Alasan berkas ini ada: stack trace pg-protocol sepanjang 20 baris untuk sesuatu
 * yang sebenarnya cuma "database-nya belum dibuat" adalah awal dari debug berputar.
 * Error yang menyebut langkah perbaikannya sendiri memutus lingkaran itu.
 */

interface PgLikeError {
  code?: string;
  message?: string;
}

const DB_NAME = process.env.DEMO_DB_NAME ?? 'saas_demo';
const DB_HOST = process.env.DEMO_DB_HOST ?? '127.0.0.1';
const DB_PORT = process.env.DEMO_DB_PORT ?? '5432';

export function explainDbError(error: unknown): string | null {
  const err = error as PgLikeError;

  switch (err?.code) {
    case '3D000':
      return [
        `Database "${DB_NAME}" belum ada.`,
        '',
        'Siapkan dulu:',
        '  cd ..\\db\\scripts',
        '  .\\db.ps1 setup',
        '',
        'Langkah itu membuat database, tiga role, skema, RLS, fungsi auth, dan seed demo,',
        'lalu menjalankan seluruh tes SQL. Tanpa itu belum ada apa pun untuk dihubungi.',
      ].join('\n');

    case 'ECONNREFUSED':
      return [
        `Tidak ada yang menjawab di ${DB_HOST}:${DB_PORT}.`,
        '',
        'Periksa service PostgreSQL:',
        '  Get-Service *postgres*',
        '  Start-Service postgresql-x64-18      # sesuaikan nama servicenya',
      ].join('\n');

    case '28P01':
      return [
        'Password ditolak PostgreSQL.',
        '',
        'Periksa nilai yang sedang dipakai sesi ini:',
        '  $env:DEMO_DB_SUPER_PASSWORD',
        '',
        'Variabel ini hilang setiap kali jendela PowerShell ditutup, jadi harus diset ulang.',
      ].join('\n');

    case '28000':
      return [
        'Role tidak dikenal atau ditolak pg_hba.conf.',
        '',
        'Kalau role app_user/app_owner memang belum ada, jalankan .\\db.ps1 setup lebih dulu.',
      ].join('\n');

    case '42P01':
      return [
        'Tabel yang dibutuhkan belum ada — migrasi belum lengkap.',
        '',
        '  cd ..\\db\\scripts',
        '  .\\db.ps1 reset',
      ].join('\n');

    default:
      return null;
  }
}

/** Mencetak penjelasan bila ada, lalu keluar. Kalau tidak dikenali, lempar apa adanya. */
export function failWithExplanation(error: unknown): never {
  // Kesalahan kunci membawa penjelasannya sendiri (lihat src/crypto). Dicetak
  // tanpa stack trace: pesannya sudah menyebut obatnya.
  const name = (error as Error)?.name;
  if (
    name === 'KekMissingError' ||
    name === 'KekMismatchError' ||
    name === 'KeyMissingError' ||
    name === 'JwtSecretMissingError'
  ) {
    console.error('\n' + (error as Error).message + '\n');
    process.exit(2);
  }
  const explanation = explainDbError(error);
  if (explanation) {
    console.error('\n' + explanation + '\n');
    process.exit(2);
  }
  throw error;
}
