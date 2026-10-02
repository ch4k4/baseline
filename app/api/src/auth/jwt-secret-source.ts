import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Sumber kunci penanda tangan access token (HS256).
 *
 * Sebelumnya: bila DEMO_JWT_SECRET kosong, API memakai kunci bawaan yang
 * TERTULIS DI KODE - dan hanya menolak start bila NODE_ENV=production. `npm start`
 * tidak menyetel NODE_ENV, jadi API yang dijalankan tanpa variabel itu menandatangani
 * token dengan kunci yang dapat dibaca siapa pun dari repo ini. Yang membatasi
 * dampaknya hanya pemeriksaan session di database (session.guard.ts).
 *
 * Sekarang tidak ada kunci bawaan di mana pun, dan aturannya tidak bergantung pada
 * NODE_ENV:
 *   1. DEMO_JWT_SECRET, bila diisi - minimal 32 byte;
 *   2. bila tidak, 32 byte acak dari berkas di LUAR repo, di sebelah KEK
 *      (~/.saas-demo/jwt-dev.key, atau DEMO_JWT_SECRET_FILE). Dibuat HANYA oleh
 *      seed (ensureJwtSecret), seperti KEK - lihat kek-source.ts;
 *   3. bila keduanya tidak ada, API menolak start dan menyebut obatnya.
 *
 * Kunci yang dibuat sendiri oleh API saat start sengaja TIDAK dipakai: setiap
 * restart akan mencabut semua sesi, dan setiap instance menolak token instance lain.
 */

export const JWT_SECRET_MIN_LENGTH = 32;

export function jwtSecretPath(): string {
  return process.env.DEMO_JWT_SECRET_FILE ?? join(homedir(), '.saas-demo', 'jwt-dev.key');
}

export class JwtSecretMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwtSecretMissingError';
  }
}

export function loadJwtSecret(): Buffer {
  const fromEnv = process.env.DEMO_JWT_SECRET;
  if (fromEnv) {
    const secret = Buffer.from(fromEnv, 'utf8');
    if (secret.length < JWT_SECRET_MIN_LENGTH) {
      throw new JwtSecretMissingError(
        `DEMO_JWT_SECRET hanya ${secret.length} byte; minimal ${JWT_SECRET_MIN_LENGTH}. ` +
          'Buat yang acak, mis.: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }
    return secret;
  }

  const path = jwtSecretPath();
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    throw new JwtSecretMissingError(
      [
        `Kunci penanda tangan token tidak ada: DEMO_JWT_SECRET kosong dan ${path} tidak ditemukan.`,
        '',
        'Di lokal, berkas itu dibuat oleh seed. Jalankan:',
        '  cd ..\\db\\scripts',
        '  .\\db.ps1 reset',
        '',
        'Di luar lokal, isi DEMO_JWT_SECRET dengan minimal 32 byte acak.',
      ].join('\n'),
    );
  }
  if (raw.length !== JWT_SECRET_MIN_LENGTH) {
    throw new JwtSecretMissingError(
      `Kunci token di ${path} berukuran ${raw.length} byte, harus ${JWT_SECRET_MIN_LENGTH}. Berkas rusak.`,
    );
  }
  return raw;
}

/**
 * Dipakai seed saja. Tidak menyentuh apa pun bila DEMO_JWT_SECRET diisi.
 * Mengembalikan jalur berkas yang dibuat, atau null bila tidak ada yang dibuat.
 */
export function ensureJwtSecret(): string | null {
  if (process.env.DEMO_JWT_SECRET) return null;
  const path = jwtSecretPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // 'wx': gagal bila sudah ada - kunci yang ada tidak pernah ditimpa, karena
  // menimpanya mencabut setiap sesi yang sedang berjalan.
  try {
    writeFileSync(path, randomBytes(JWT_SECRET_MIN_LENGTH), { flag: 'wx', mode: 0o600 });
    return path;
  } catch (error: any) {
    if (error?.code === 'EEXIST') return null;
    throw error;
  }
}
