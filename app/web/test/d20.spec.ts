import { test, expect } from '@playwright/test';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

/**
 * D-20: API yang HIDUP tapi MACET tidak boleh membuat halaman ikut menggantung.
 *
 * API yang mati mudah diuji (dan sudah teruji tanpa sengaja: run browser pertama
 * slice 8 dijalankan tanpa API). API yang macet tidak: koneksinya diterima,
 * jawabannya tidak pernah datang. Untuk itu tes ini memasang dua hal sendiri:
 *
 *   1. proxy di depan API asli, yang meneruskan semua permintaan KECUALI path
 *      yang disuruh "macet" - permintaan itu diterima lalu didiamkan;
 *   2. instance Next KEDUA dari build yang sama, dengan API_BASE_URL menunjuk ke
 *      proxy dan API_TIMEOUT_MS pendek.
 *
 * Instance di port 3000 tidak disentuh, dan API asli tetap dibutuhkan (login pada
 * bagian C memang harus berhasil).
 *
 * Satu tes, tiga bagian:
 *   A. tidak ada fetch() di src/ yang melewati apiFetch - tanpa ini, bagian B dan
 *      C hanya membuktikan DUA dari tujuh panggilan terlindungi;
 *   B. login macet -> pesan "tidak menjawab tepat waktu", dalam batas waktu;
 *   C. login lancar, daftar anggota macet -> halaman error, bukan halaman hang.
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const REAL_API = new URL(process.env.API_BASE_URL ?? 'http://127.0.0.1:3001');
const TIMEOUT_MS = 1500;
const PESAN_LAMBAT = 'API tidak menjawab tepat waktu. Coba lagi sebentar lagi.';

const WEB_DIR = path.resolve(__dirname, '..');

// ------------------------------------------------------------ proxy "macet"
const hang = new Set<string>();
const hits: string[] = [];
const sockets = new Set<net.Socket>();

const proxy = http.createServer((req, res) => {
  const p = (req.url ?? '').split('?')[0];
  if (hang.has(p)) {
    hits.push(p);
    return; // diterima, tidak pernah dijawab
  }
  const up = http.request(
    { host: REAL_API.hostname, port: REAL_API.port, path: req.url, method: req.method, headers: req.headers },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  up.on('error', () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(up);
});
proxy.on('connection', (s) => {
  sockets.add(s);
  s.on('close', () => sockets.delete(s));
});

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

// ------------------------------------------------------------ Next kedua
let next: ChildProcess | undefined;
let nextLog = '';
let base = '';

function stopNext() {
  if (!next?.pid || next.exitCode !== null) return;
  if (process.platform === 'win32') {
    // Membunuh pohon proses, bukan hanya induknya: server Next yang tertinggal
    // memegang port dan membuat run berikutnya gagal dengan alasan yang jauh.
    spawnSync('taskkill', ['/pid', String(next.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    next.kill('SIGKILL');
  }
}

test.beforeAll(async () => {
  test.setTimeout(90_000);

  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()));
  const proxyPort = (proxy.address() as net.AddressInfo).port;
  const webPort = await freePort();
  base = `http://127.0.0.1:${webPort}`;

  next = spawn(
    process.execPath,
    [require.resolve('next/dist/bin/next', { paths: [WEB_DIR] }), 'start', '-p', String(webPort)],
    {
      cwd: WEB_DIR,
      env: {
        ...process.env,
        API_BASE_URL: `http://127.0.0.1:${proxyPort}`,
        API_TIMEOUT_MS: String(TIMEOUT_MS),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  next.stdout?.on('data', (d) => (nextLog += d));
  next.stderr?.on('data', (d) => (nextLog += d));

  const batas = Date.now() + 60_000;
  for (;;) {
    if (next.exitCode !== null) throw new Error(`Next kedua berhenti saat start:\n${nextLog}`);
    try {
      const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) break;
    } catch {
      /* belum siap */
    }
    if (Date.now() > batas) throw new Error(`Next kedua tidak siap dalam 60 detik:\n${nextLog}`);
    await new Promise((r) => setTimeout(r, 300));
  }
});

test.afterAll(async () => {
  stopNext();
  for (const s of sockets) s.destroy();
  await new Promise((r) => proxy.close(() => r(undefined)));
});

// ------------------------------------------------------------ tes
function sumberWeb(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? sumberWeb(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

test('1. API yang macet menghasilkan pesan dalam batas waktu, bukan halaman yang menggantung', async ({ page }) => {
  // ---- A. semua jalan ke API lewat apiFetch
  const src = path.join(WEB_DIR, 'src');
  const pintu = path.join(src, 'lib', 'api-fetch.ts');
  const berkas = sumberWeb(src);
  expect(berkas.length, 'src/ tidak terbaca').toBeGreaterThan(5);
  const pelanggar = berkas.filter((f) => f !== pintu && /\bfetch\s*\(/.test(readFileSync(f, 'utf8')));
  expect(pelanggar.map((f) => path.relative(WEB_DIR, f)), 'fetch() langsung, tanpa batas waktu').toEqual([]);

  // ---- B. login macet
  hang.clear();
  hits.length = 0;
  hang.add('/api/v1/auth/login');

  await page.goto(`${base}/login`);
  await page.fill('#email', 'owner@alpha.demo');
  await page.fill('#password', PASSWORD);
  let mulai = Date.now();
  await page.click('button[type=submit]');
  await expect(page.locator('[data-testid=form-error]')).toHaveText(PESAN_LAMBAT, { timeout: 10_000 });
  let lama = Date.now() - mulai;

  // Permintaan benar-benar sampai dan benar-benar ditunggu. Tanpa dua pemeriksaan
  // ini, koneksi yang ditolak (bukan macet) juga bisa menghasilkan halaman error
  // yang cepat, dan tes lulus karena alasan yang salah.
  expect(hits, 'permintaan login tidak sampai ke proxy').toEqual(['/api/v1/auth/login']);
  expect(lama, 'jawaban datang sebelum batas waktu - macetnya tidak terjadi').toBeGreaterThanOrEqual(TIMEOUT_MS - 200);
  expect(lama, 'halaman menunggu jauh melewati batas waktu').toBeLessThan(TIMEOUT_MS + 5000);

  // ---- C. login lancar, daftar anggota macet
  hang.clear();
  hits.length = 0;
  hang.add('/api/v1/members');

  await page.goto(`${base}/login`);
  await page.fill('#email', 'owner@alpha.demo');
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });

  // Daftar anggota ada di halamannya sendiri sejak slice 12; yang macet hanya
  // endpoint itu, jadi dasbor tetap terbuka dan halaman anggota yang bertahan
  // sampai batas waktu lalu menampilkan pesan - bukan menggantung.
  mulai = Date.now();
  await page.goto(`${base}/administration/members`);
  await expect(page.locator('[data-testid=form-error]')).toHaveText(PESAN_LAMBAT, { timeout: 10_000 });
  lama = Date.now() - mulai;

  expect(hits, 'permintaan anggota tidak sampai ke proxy').toEqual(['/api/v1/members']);
  expect(lama).toBeGreaterThanOrEqual(TIMEOUT_MS - 200);
  expect(lama).toBeLessThan(TIMEOUT_MS + 5000);
});
