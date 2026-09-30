import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sid } from './token-helper.js';
import { bootstrap } from '../src/main.js';
import { Client, Pool } from 'pg';
import { PG_POOL } from '../src/database/pool.js';

/**
 * Tes slice 2. Setiap kasus memeriksa NILAI, bukan sekadar "tidak error".
 * Kasus 8 adalah yang paling penting dan paling sering dilewatkan orang:
 * kebocoran context lintas koneksi pool di bawah beban bergantian.
 */

const PORT = Number(process.env.TEST_PORT ?? 3199);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';

let app: any;

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function get(path: string, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function login(email: string, password = PASSWORD) {
  return post('/api/v1/auth/login', { email, password });
}

before(async () => {
  process.env.PORT = String(PORT);
  app = await bootstrap(PORT);
});

after(async () => {
  await app?.close();
});

describe('slice 2 - login, session, isolasi endpoint', () => {
  test('1. password salah ditolak generik', async () => {
    const res = await login('owner@alpha.demo', 'password-salah');
    assert.equal(res.status, 401);
    assert.equal(res.body.message, 'Email atau password salah.');
  });

  test('2. email tak dikenal ditolak dengan respons identik', async () => {
    // Email acak per run, bukan nilai tetap. Email yang tidak ada tidak pernah
    // login berhasil, jadi hitungan kegagalannya tidak pernah kembali nol: dengan
    // nilai tetap, lima run dalam lima menit membuat kasus ini gagal 429 - hasil
    // yang bergantung pada seberapa cepat tes diulang, bukan pada kodenya.
    const unknown = await login(
      `tidak-ada-${Math.random().toString(36).slice(2, 10)}@nowhere.test`,
      'password-salah',
    );
    const wrongPw = await login('owner@alpha.demo', 'password-salah');
    assert.equal(unknown.status, wrongPw.status);
    assert.equal(unknown.body.message, wrongPw.body.message);
    assert.deepEqual(Object.keys(unknown.body).sort(), Object.keys(wrongPw.body).sort());
  });

  test('3. login benar menghasilkan session pada tenant yang tepat', async () => {
    const res = await login('owner@alpha.demo');
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'SESSION');
    assert.equal(res.body.context.tenantId, ALPHA);
    // Bentuk token berubah di slice 7: JWT tiga bagian, bukan lagi session id
    // mentah. Yang menunjuk session sekarang ada DI DALAM token, bukan token itu.
    assert.match(res.body.accessToken, /^[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.match(sid(res.body.accessToken), /^[0-9a-f-]{36}$/);
    assert.ok(res.body.refreshToken, 'refresh token harus ikut terbit');
    assert.ok(!res.body.refreshToken.includes('.'), 'refresh token bukan JWT; ia nilai acak buram');
    assert.equal(typeof res.body.expiresIn, 'number');
  });

  test('4. anggota tenant Alpha hanya berisi anggota Alpha', async () => {
    const { body } = await login('owner@alpha.demo');
    const res = await get('/api/v1/members', body.accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.tenantId, ALPHA);
    assert.equal(res.body.members.length, 3);
    const names = res.body.members.map((m: any) => m.display_name).sort();
    assert.deepEqual(names, ['Alpha Owner', 'Alpha User', 'Multi di Alpha']);
  });

  test('5. anggota tenant Beta tidak memuat satu pun nama Alpha', async () => {
    const { body } = await login('admin@beta.demo');
    const res = await get('/api/v1/members', body.accessToken);
    assert.equal(res.body.tenantId, BETA);
    assert.equal(res.body.members.length, 2);
    const blob = JSON.stringify(res.body);
    assert.ok(!blob.includes('Alpha'), 'nama Alpha bocor ke respons Beta');
    assert.ok(!blob.includes(ALPHA), 'tenant id Alpha bocor ke respons Beta');
  });

  test('6. tanpa token ditolak', async () => {
    assert.equal((await get('/api/v1/members')).status, 401);
  });

  test('7. token sampah ditolak 401, bukan 500', async () => {
    // Sampah yang BERBENTUK JWT ikut diuji. Tanpa itu, pengaman parsing di
    // jwt.service.ts dapat dihapus tanpa satu tes pun gagal - token seperti
    // "a.b.c" atau header sah tanpa badan lalu menjadi 500 (audit tes 2026-09-21).
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const sampah = [
      'bukan-uuid',
      '00000000-0000-0000-0000-000000000000',
      "' OR 1=1 --",
      'a.b.c',
      '..',
      header,
      `${header}.`,
      `${header}..`,
      `${header}.bm90LWpzb24.tanda-tangan`,
    ];
    for (const bad of sampah) {
      const res = await get('/api/v1/members', bad);
      assert.equal(res.status, 401, `token "${bad}" seharusnya 401, dapat ${res.status}`);
    }
  });

  test('8. beban bergantian dua tenant pada pool kecil tidak membocorkan context', async () => {
    const alpha = (await login('owner@alpha.demo')).body.accessToken;
    const beta = (await login('admin@beta.demo')).body.accessToken;

    // 200 request bolak-balik, pool max 5 -> koneksi pasti dipakai ulang lintas tenant.
    const jobs = Array.from({ length: 200 }, (_, i) =>
      i % 2 === 0
        ? get('/api/v1/members', alpha).then((r) => ({ want: ALPHA, got: r }))
        : get('/api/v1/members', beta).then((r) => ({ want: BETA, got: r })),
    );

    const results = await Promise.all(jobs);
    for (const { want, got } of results) {
      assert.equal(got.status, 200);
      assert.equal(got.body.tenantId, want);
      assert.equal(got.body.members.length, want === ALPHA ? 3 : 2);
      for (const m of got.body.members) {
        const isAlphaName = m.display_name.includes('Alpha');
        assert.equal(isAlphaName, want === ALPHA, `baris "${m.display_name}" muncul di tenant salah`);
      }
    }
  });

  test('9. identitas lintas tenant wajib memilih context', async () => {
    const res = await login('multi@demo.local');
    assert.equal(res.body.status, 'CONTEXT_REQUIRED');
    assert.equal(res.body.contexts.length, 2);
    assert.ok(!('accessToken' in res.body), 'tidak boleh mengeluarkan token sebelum context dipilih');
    assert.ok(!('refreshToken' in res.body), 'refresh token pun tidak boleh keluar sebelum itu');
  });

  test('11. query di luar unit-of-work tidak mewarisi context tenant mana pun', async () => {
    // Kasus ini ada karena M1 (set_config session-local) lolos dari kasus 8:
    // selama setiap transaksi memasang context di awal, nilai basi selalu tertimpa.
    // Yang benar-benar membedakan transaction-local dari session-local adalah query
    // yang berjalan DI LUAR transaksi pada koneksi bekas pakai - persis yang terjadi
    // kalau ada kode memakai pool.query() langsung.
    await get('/api/v1/members', (await login('owner@alpha.demo')).body.accessToken);

    const pool = app.get(PG_POOL) as Pool;
    for (let i = 0; i < 10; i++) {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM tenant_memberships');
      assert.equal(
        rows[0].n,
        0,
        'koneksi pool masih membawa tenant context dari request sebelumnya',
      );
    }
  });

  test('10. session tercatat di database dengan membership tenant yang benar', async () => {
    const { body } = await login('owner@alpha.demo');
    const client = new Client({
      host: process.env.DEMO_DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DEMO_DB_PORT ?? 5432),
      database: process.env.DEMO_DB_NAME ?? 'saas_demo',
      user: process.env.DEMO_DB_SUPER ?? 'postgres',
      password: process.env.DEMO_DB_SUPER_PASSWORD,
    });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT s.context_kind, s.tenant_id, m.tenant_id AS membership_tenant
         FROM sessions s JOIN tenant_memberships m ON m.id = s.membership_id
         WHERE s.id = $1`,
        [sid(body.accessToken)],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].context_kind, 'TENANT');
      assert.equal(rows[0].tenant_id, ALPHA);
      assert.equal(rows[0].membership_tenant, ALPHA, 'membership berasal dari tenant lain');
    } finally {
      await client.end();
    }
  });

  test('12. email tak dikenal dijawab selama password salah, tanpa kanal waktu', async () => {
    // Pesan yang identik tidak cukup kalau waktunya berbeda. Tanpa kerja setara
    // (burnEquivalentWork), email tak dikenal dijawab tanpa scrypt dan jauh lebih
    // cepat, sehingga keberadaan akun dapat ditebak dengan stopwatch. Menghapus
    // kerja setara itu tidak membuat satu tes pun gagal (audit tes 2026-09-21).
    //
    // Ambangnya sengaja longgar (0,5): yang dicari selisih kelas besar - scrypt
    // lawan tanpa scrypt, sekitar sepuluh kali - bukan milidetik yang rentan derau.
    const ukur = async (fn: () => Promise<{ status: number }>) => {
      const mulai = performance.now();
      const res = await fn();
      return { ms: performance.now() - mulai, status: res.status };
    };
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

    const dikenal: number[] = [];
    const takDikenal: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = await ukur(() => login('admin@beta.demo', 'salah-uji-waktu'));
      assert.equal(a.status, 401, 'pengukuran tidak sah: login tertahan sebelum verifikasi');
      dikenal.push(a.ms);
      // Login benar menihilkan hitungan gagal, supaya pengukuran berikutnya tidak 429.
      assert.equal((await login('admin@beta.demo')).status, 201);

      const email = `waktu-${i}-${Math.random().toString(36).slice(2, 8)}@nowhere.test`;
      const b = await ukur(() => login(email, 'salah'));
      assert.equal(b.status, 401);
      takDikenal.push(b.ms);
    }

    const rasio = median(takDikenal) / median(dikenal);
    assert.ok(
      rasio > 0.5,
      `email tak dikenal dijawab dalam ${rasio.toFixed(2)}x waktu password salah - keberadaan akun dapat ditebak`,
    );
  });
});
