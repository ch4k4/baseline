import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../src/main.js';
import {
  ensureJwtSecret,
  JwtSecretMissingError,
  JWT_SECRET_MIN_LENGTH,
  loadJwtSecret,
} from '../src/auth/jwt-secret-source.js';

/**
 * Kunci penanda tangan access token: tidak ada kunci bawaan, di lingkungan mana pun.
 *
 * Sebelumnya API tanpa DEMO_JWT_SECRET menandatangani token dengan kunci yang
 * tertulis di repo, dan hanya menolak start bila NODE_ENV=production. Tes ini
 * menjaga keempat jalannya: variabel, berkas, penolakan, dan kematian kunci lama.
 *
 * Variabel lingkungan diubah per kasus dan SELALU dipulihkan; berkas uji ada di
 * folder sementara, tidak pernah di ~/.saas-demo milik server yang sedang berjalan.
 */

const PORT = Number(process.env.TEST_PORT ?? 3218);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const KUNCI_LAMA = 'kunci-pengembangan-lokal-jangan-dipakai-di-produksi';

let dir: string;
const envAsli = { secret: process.env.DEMO_JWT_SECRET, file: process.env.DEMO_JWT_SECRET_FILE };

function pulihkanEnv() {
  if (envAsli.secret === undefined) delete process.env.DEMO_JWT_SECRET;
  else process.env.DEMO_JWT_SECRET = envAsli.secret;
  if (envAsli.file === undefined) delete process.env.DEMO_JWT_SECRET_FILE;
  else process.env.DEMO_JWT_SECRET_FILE = envAsli.file;
}

function dengan(env: { secret?: string; file?: string }, fn: () => void | Promise<void>) {
  return async () => {
    if (env.secret === undefined) delete process.env.DEMO_JWT_SECRET;
    else process.env.DEMO_JWT_SECRET = env.secret;
    if (env.file === undefined) delete process.env.DEMO_JWT_SECRET_FILE;
    else process.env.DEMO_JWT_SECRET_FILE = env.file;
    try {
      await fn();
    } finally {
      pulihkanEnv();
    }
  };
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'jwt-secret-'));
});

after(() => {
  pulihkanEnv();
  rmSync(dir, { recursive: true, force: true });
});

describe('kunci penanda tangan token', () => {
  test(
    '1. tanpa variabel dan tanpa berkas: gagal, tidak jatuh ke kunci bawaan',
    dengan({ file: '' }, () => {
      process.env.DEMO_JWT_SECRET_FILE = join(dir, 'tidak-ada.key');
      assert.throws(() => loadJwtSecret(), JwtSecretMissingError);
    }),
  );

  test(
    '2. DEMO_JWT_SECRET yang terlalu pendek ditolak',
    dengan({ secret: 'x'.repeat(JWT_SECRET_MIN_LENGTH - 1) }, () => {
      assert.throws(() => loadJwtSecret(), JwtSecretMissingError);
    }),
  );

  test(
    '3. DEMO_JWT_SECRET yang cukup panjang dipakai apa adanya, berkas diabaikan',
    dengan({ secret: 's'.repeat(JWT_SECRET_MIN_LENGTH) }, () => {
      process.env.DEMO_JWT_SECRET_FILE = join(dir, 'tidak-ada.key');
      assert.deepEqual(loadJwtSecret(), Buffer.from('s'.repeat(JWT_SECRET_MIN_LENGTH)));
    }),
  );

  test(
    '4. seed membuat berkas 32 byte privat, dan TIDAK PERNAH menimpa yang sudah ada',
    dengan({}, () => {
      const path = join(dir, 'seed.key');
      process.env.DEMO_JWT_SECRET_FILE = path;
      assert.equal(ensureJwtSecret(), path);
      const pertama = readFileSync(path);
      assert.equal(pertama.length, JWT_SECRET_MIN_LENGTH);
      if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);

      assert.equal(ensureJwtSecret(), null, 'pemanggilan kedua tidak membuat apa pun');
      assert.deepEqual(readFileSync(path), pertama, 'kunci yang ada tidak ditimpa');
      assert.deepEqual(loadJwtSecret(), pertama);

      writeFileSync(path, Buffer.alloc(7));
      assert.throws(() => loadJwtSecret(), JwtSecretMissingError, 'berkas rusak ditolak');
    }),
  );

  test(
    '5. API menolak start tanpa kunci',
    dengan({}, async () => {
      process.env.DEMO_JWT_SECRET_FILE = join(dir, 'tidak-ada.key');
      // Bila API ternyata hidup, ia ditutup dulu lalu tesnya GAGAL - bukan dibiarkan
      // mendengarkan port dan menggantung seluruh proses tes.
      let app: any;
      try {
        app = await bootstrap(PORT);
      } catch (error) {
        assert.ok(error instanceof JwtSecretMissingError, `kesalahan yang salah: ${error}`);
        return;
      }
      await app.close();
      assert.fail('API hidup tanpa kunci penanda tangan token');
    }),
  );

  test('6. token bertanda tangan kunci bawaan LAMA ditolak, walau session-nya hidup', async () => {
    // Server dijalankan dengan kunci yang sama seperti server lain di mesin ini
    // (variabel atau berkas buatan seed) - bukan kunci lama.
    const app = await bootstrap(PORT);
    try {
      const res = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@alpha.demo', password: PASSWORD }),
      });
      const { accessToken } = (await res.json()) as { accessToken: string };
      const [head, body] = accessToken.split('.');

      const sah = await fetch(`${BASE}/api/v1/members`, { headers: { authorization: `Bearer ${accessToken}` } });
      assert.equal(sah.status, 200, 'token asli diterima');

      // Klaim yang SAMA persis (session hidup), hanya tanda tangannya dari kunci lama.
      const sigLama = createHmac('sha256', KUNCI_LAMA).update(`${head}.${body}`).digest('base64url');
      const palsu = await fetch(`${BASE}/api/v1/members`, {
        headers: { authorization: `Bearer ${head}.${body}.${sigLama}` },
      });
      assert.equal(palsu.status, 401);
    } finally {
      await app.close();
    }
  });
});
