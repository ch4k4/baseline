import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import { mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Sejak api/ berjalan sebagai ESM (Infrastructure SSOT sec.4), `require.main ===
 * module` tidak ada lagi. Penggantinya (dijalankanLangsung di src/main.ts)
 * membandingkan path berkas. Kalau perbandingan itu salah - misalnya huruf drive
 * atau pemisah path Windows - API tidak start sama sekali dan TIDAK mencetak
 * apa pun: `npm run dev` selesai diam-diam. Tes lain tidak menangkapnya karena
 * mereka memanggil bootstrap() langsung.
 *
 * Dua arah diuji:
 *   1. dijalankan langsung -> server benar-benar mendengarkan;
 *   2. diimpor           -> TIDAK ada server yang ikut start.
 */

const MAIN = path.resolve(import.meta.dirname, '..', 'src', 'main.js');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

function run(args: string[], port: number) {
  const child = spawn(process.execPath, args, {
    // cwd = folder api/, seperti `npm run dev` dan db.ps1 menjalankannya.
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  return { child, log: () => out };
}

async function listening(port: number, ms: number): Promise<boolean> {
  const batas = Date.now() + ms;
  while (Date.now() < batas) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/v1/members`, { signal: AbortSignal.timeout(500) });
      return true; // jawaban apa pun (termasuk 401) berarti server hidup
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

async function stop(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) return;
  child.kill();
  await once(child, 'exit');
}

describe('ESM - titik masuk API', () => {
  test('1. dijalankan langsung dengan path relatif (seperti npm run dev), server benar-benar mendengarkan', async () => {
    const port = await freePort();
    // Path RELATIF, sama dengan skrip `start` / `dev` di package.json.
    const { child, log } = run([path.join('dist', 'src', 'main.js')], port);
    try {
      assert.ok(await listening(port, 15_000), `API tidak start. Keluaran:\n${log()}`);
      assert.match(log(), /API siap/);
    } finally {
      await stop(child);
    }
  });

  test('1b. dijalankan lewat path lain ke berkas yang sama (junction/symlink), server tetap start', async () => {
    // Node menyimpan process.argv[1] apa adanya (absolut), sedangkan
    // import.meta.url menunjuk berkas aslinya. Perbandingan string mentah lolos
    // di Linux tetapi gagal di Windows (D:\\... vs file:///D:/...) - dan uji
    // mutasi di Linux membuktikan tes 1 saja tidak menangkapnya. Junction
    // membuat kedua bentuk itu berbeda di sistem operasi mana pun.
    const port = await freePort();
    const dist = path.resolve(import.meta.dirname, '..');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'esm-main-'));
    const link = path.join(tmp, 'dist');
    symlinkSync(dist, link, 'junction'); // 'junction' tidak butuh hak admin di Windows
    const { child, log } = run([path.join(link, 'src', 'main.js')], port);
    try {
      assert.ok(await listening(port, 15_000), `API tidak start lewat junction. Keluaran:\n${log()}`);
    } finally {
      await stop(child);
      // TIDAK PERNAH rm rekursif di sini: di Windows, penghapusan rekursif yang
      // menembus junction dapat menghapus isi dist/ yang asli. Link dilepas
      // sendiri (unlink; rmdir non-rekursif untuk junction), lalu folder
      // sementara yang sudah kosong.
      try {
        unlinkSync(link);
      } catch {
        rmdirSync(link);
      }
      rmdirSync(tmp);
    }
  });

  test('2. diimpor modul lain, tidak ada server yang ikut start', async () => {
    const port = await freePort();
    const kode = `await import(${JSON.stringify(pathToFileURL(MAIN).href)}); setTimeout(() => process.exit(0), 3000);`;
    const { child, log } = run(['--input-type=module', '-e', kode], port);
    try {
      assert.equal(await listening(port, 2500), false, `server ikut start saat main.js diimpor:\n${log()}`);
    } finally {
      await stop(child);
    }
  });
});
