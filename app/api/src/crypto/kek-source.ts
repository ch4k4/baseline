import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Sumber KEK untuk DEMO LOKAL. Bukan KMS.
 *
 * KEPUTUSAN (2026-09-21): KEK adalah 32 byte acak dalam berkas di LUAR folder
 * repo, tanpa pembungkus passphrase - opsi C2 Data Protection SSOT sec.9.2
 * (edisi 2.1, amandemen atas keputusan pemilik proyek; semula deviasi D-13).
 *
 * Kenapa tanpa passphrase: di mesin pengembang, passphrase lewat $env: tetap
 * tersimpan di riwayat PowerShell (PSReadLine) di disk yang sama dengan berkas
 * ini, jadi perlindungan tambahannya kecil sementara biayanya satu variabel
 * lagi di setiap jendela. Keputusan ini HANYA berlaku untuk data sintetis.
 *
 * Yang tetap dijaga:
 *   - berkas di luar repo, jadi tidak ikut ter-commit atau tersalin bersama kode;
 *   - dibuat HANYA oleh seed (ensureKek), tidak pernah oleh API. API yang membuat
 *     KEK baru sendiri akan menolak semua DEK yang sudah ada dengan pesan yang
 *     menyesatkan - lebih baik berhenti dan menyebut obatnya.
 */

export const KEK_LENGTH = 32;

export function kekPath(): string {
  return process.env.DEMO_KEK_FILE ?? join(homedir(), '.saas-demo', 'kek-dev.key');
}

export class KekMissingError extends Error {
  constructor(path: string) {
    super(
      [
        `KEK demo tidak ditemukan di ${path}.`,
        '',
        'KEK dibuat oleh seed, bukan oleh API. Jalankan:',
        '  cd ..\\db\\scripts',
        '  .\\db.ps1 reset',
      ].join('\n'),
    );
    this.name = 'KekMissingError';
  }
}

export function loadKek(): Buffer {
  const path = kekPath();
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (error: any) {
    if (error?.code === 'ENOENT') throw new KekMissingError(path);
    throw error;
  }
  if (raw.length !== KEK_LENGTH) {
    throw new Error(`KEK di ${path} berukuran ${raw.length} byte, harus ${KEK_LENGTH}. Berkas rusak.`);
  }
  return raw;
}

/** Dipakai seed saja. Mengembalikan true bila KEK baru dibuat. */
export function ensureKek(): { kek: Buffer; created: boolean } {
  const path = kekPath();
  try {
    return { kek: loadKek(), created: false };
  } catch (error) {
    if (!(error instanceof KekMissingError)) throw error;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // 'wx': gagal bila berkas sudah ada. Dua proses seed yang berjalan bersamaan
  // tidak boleh saling menimpa KEK - yang kalah membaca milik yang menang.
  try {
    writeFileSync(path, randomBytes(KEK_LENGTH), { flag: 'wx', mode: 0o600 });
    return { kek: loadKek(), created: true };
  } catch (error: any) {
    if (error?.code === 'EEXIST') return { kek: loadKek(), created: false };
    throw error;
  }
}
