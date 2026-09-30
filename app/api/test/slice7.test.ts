import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { bootstrap } from '../src/main.js';
import { JwtService } from '../src/auth/jwt.service.js';
import { claims, sid, tamper } from './token-helper.js';

/**
 * Tes slice 7 - access token bertanda tangan dan rotasi refresh token.
 *
 * Sebagian kasus di sini MEMALSUKAN token dengan kunci yang sama seperti server,
 * bukan mengirim sampah. Itu disengaja: yang perlu dibuktikan bukan "tanda tangan
 * diperiksa" (itu mudah dan sering satu-satunya yang diuji), melainkan bahwa
 * tanda tangan yang sah pun tidak cukup untuk masuk kalau keadaannya sudah
 * berubah di database.
 */

const PORT = Number(process.env.TEST_PORT ?? 3202);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';

let app: any;
let db: Client;

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
  db = new Client({
    host: process.env.DEMO_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DEMO_DB_PORT ?? 5432),
    database: process.env.DEMO_DB_NAME ?? 'saas_demo',
    user: process.env.DEMO_DB_SUPER ?? 'postgres',
    password: process.env.DEMO_DB_SUPER_PASSWORD,
  });
  await db.connect();
});

after(async () => {
  await db?.end();
  await app?.close();
});

describe('slice 7 - JWT dan rotasi refresh token', () => {
  test('1. login menerbitkan JWT bertanda tangan plus refresh token buram', async () => {
    const { body } = await login('owner@alpha.demo');

    assert.equal(body.accessToken.split('.').length, 3);
    const c = claims(body.accessToken);
    assert.equal(c.tid, ALPHA);
    assert.equal(c.ctx, 'TENANT');
    assert.ok(c.exp > c.iat, 'token harus punya batas umur');
    assert.ok(c.jti, 'jti harus ada supaya token dapat dirujuk tanpa menyalin isinya');

    // Refresh token TIDAK boleh membawa isi apa pun: ia hanya pointer acak.
    assert.equal(body.refreshToken.split('.').length, 1);
    assert.notEqual(body.refreshToken, body.accessToken);
  });

  test('2. tanda tangan yang diubah ditolak', async () => {
    const { body } = await login('owner@alpha.demo');
    assert.equal((await get('/api/v1/members', body.accessToken)).status, 200);
    assert.equal((await get('/api/v1/members', tamper(body.accessToken))).status, 401);
  });

  test('3. token "alg: none" ditolak', async () => {
    // Serangan klasik: ganti algoritma menjadi none dan kosongkan tanda tangan.
    // Ini lolos pada pustaka yang membaca algoritma DARI token.
    const { body } = await login('owner@alpha.demo');
    const payload = body.accessToken.split('.')[1];
    const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');

    assert.equal((await get('/api/v1/members', `${head}.${payload}.`)).status, 401);
    assert.equal((await get('/api/v1/members', `${head}.${payload}.apa-saja`)).status, 401);
  });

  test('4. session id mentah tidak lagi diterima sebagai token', async () => {
    // Bentuk token sebelum slice 7. Kalau ini masih diterima, penggantian
    // kontraknya tidak benar-benar terjadi - hanya bertambah.
    const { body } = await login('owner@alpha.demo');
    assert.equal((await get('/api/v1/members', sid(body.accessToken))).status, 401);
  });

  test('5. tanda tangan sah dengan tenant yang dipalsukan tetap ditolak', async () => {
    // Token ditandatangani dengan kunci yang SAMA seperti server, lalu klaim
    // tenantnya diganti. Inilah alasan guard mencocokkan klaim dengan baris
    // session alih-alih memercayai klaim begitu saja.
    const { body } = await login('owner@alpha.demo');
    const asli = claims(body.accessToken);
    const palsu = new JwtService().sign({
      sub: asli.sub,
      sid: asli.sid,
      tid: BETA,
      ctx: 'TENANT',
      mid: asli.mid,
    });

    const res = await get('/api/v1/members', palsu);
    assert.equal(res.status, 401, 'klaim tenant yang tidak cocok dengan session harus ditolak');
  });

  test('6. refresh menghasilkan pasangan baru yang benar-benar berlaku', async () => {
    const { body } = await login('owner@alpha.demo');
    const res = await post('/api/v1/auth/refresh', { refreshToken: body.refreshToken });

    assert.equal(res.status, 201);
    assert.notEqual(res.body.accessToken, body.accessToken);
    assert.notEqual(res.body.refreshToken, body.refreshToken);
    // Session yang ditunjuk tetap sama: refresh memperpanjang, bukan membuat sesi baru.
    assert.equal(sid(res.body.accessToken), sid(body.accessToken));

    const members = await get('/api/v1/members', res.body.accessToken);
    assert.equal(members.status, 200);
    assert.equal(members.body.tenantId, ALPHA);
  });

  test('7. refresh token hanya sekali pakai', async () => {
    const { body } = await login('owner@alpha.demo');
    assert.equal((await post('/api/v1/auth/refresh', { refreshToken: body.refreshToken })).status, 201);

    const ulang = await post('/api/v1/auth/refresh', { refreshToken: body.refreshToken });
    assert.equal(ulang.status, 401);
  });

  test('8. pemakaian ulang mencabut seluruh rantai, bukan hanya token yang diulang', async () => {
    const { body } = await login('owner@alpha.demo');
    const r1 = await post('/api/v1/auth/refresh', { refreshToken: body.refreshToken });

    // Skenario pencurian: penyerang memakai salinan lama.
    assert.equal((await post('/api/v1/auth/refresh', { refreshToken: body.refreshToken })).status, 401);

    // Akibatnya pemilik sah ikut kehilangan aksesnya - dan itu memang yang diinginkan.
    // Kehilangan akses lebih murah daripada berbagi akses dengan pencuri.
    assert.equal(
      (await post('/api/v1/auth/refresh', { refreshToken: r1.body.refreshToken })).status,
      401,
      'token terbaru dalam family yang tercabut masih diterima',
    );
    assert.equal(
      (await get('/api/v1/members', r1.body.accessToken)).status,
      401,
      'access token yang sudah terbit masih membuka data setelah family dicabut',
    );
  });

  test('9. refresh setelah keluar ditolak', async () => {
    const { body } = await login('admin@beta.demo');
    await post('/api/v1/auth/logout', {}, body.accessToken);

    const res = await post('/api/v1/auth/refresh', { refreshToken: body.refreshToken });
    assert.equal(res.status, 401, 'keluar harus mematikan jalur perpanjangan, bukan hanya cookie');
  });

  test('10. semua kegagalan refresh menjawab sama persis', async () => {
    const { body } = await login('owner@alpha.demo');
    await post('/api/v1/auth/refresh', { refreshToken: body.refreshToken });

    const dipakaiUlang = await post('/api/v1/auth/refresh', { refreshToken: body.refreshToken });
    const tidakDikenal = await post('/api/v1/auth/refresh', { refreshToken: 'nilai-yang-tidak-pernah-ada' });

    assert.equal(dipakaiUlang.status, tidakDikenal.status);
    assert.equal(dipakaiUlang.body.message, tidakDikenal.body.message);
    assert.deepEqual(
      Object.keys(dipakaiUlang.body).sort(),
      Object.keys(tidakDikenal.body).sort(),
      'bentuk respons membedakan token yang pernah sah dari yang tidak pernah ada',
    );
  });

  test('11. audit membedakan alasan kegagalan yang tidak dibedakan oleh respons', async () => {
    const { body } = await login('owner@alpha.demo');
    const sesi = sid(body.accessToken);
    await post('/api/v1/auth/refresh', { refreshToken: body.refreshToken });
    await post('/api/v1/auth/refresh', { refreshToken: body.refreshToken });

    const { rows } = await db.query(
      `SELECT event_type, outcome, detail FROM audit_logs
       WHERE event_type LIKE 'auth.refresh%' AND actor_session_id = $1
       ORDER BY occurred_at`,
      [sesi],
    );

    assert.equal(rows.length, 2);
    assert.deepEqual([rows[0].event_type, rows[0].outcome], ['auth.refresh', 'SUCCESS']);
    // Pemakaian ulang punya nama event sendiri (Demo Foundation sec.15), untuk alarm.
    assert.deepEqual([rows[1].event_type, rows[1].outcome, rows[1].detail.reason],
      ['auth.refresh.reuse_detected', 'FAILURE', 'REUSE']);

    // Kegagalan biasa (session sudah keluar) tetap auth.refresh, bukan alarm.
    const kedua = await login('owner@alpha.demo');
    const sesi2 = sid(kedua.body.accessToken);
    await post('/api/v1/auth/logout', {}, kedua.body.accessToken);
    await post('/api/v1/auth/refresh', { refreshToken: kedua.body.refreshToken });
    const { rows: r2 } = await db.query(
      `SELECT event_type, outcome, detail FROM audit_logs
       WHERE event_type LIKE 'auth.refresh%' AND actor_session_id = $1`, [sesi2]);
    assert.equal(r2.length, 1, JSON.stringify(r2));
    assert.deepEqual([r2[0].event_type, r2[0].outcome], ['auth.refresh', 'FAILURE']);
    assert.notEqual(r2[0].detail.reason, 'REUSE');
  });

  test('12. nilai refresh token tidak pernah tersimpan apa adanya', async () => {
    const { body } = await login('owner@alpha.demo');
    await post('/api/v1/auth/refresh', { refreshToken: body.refreshToken });

    // Yang disimpan hanyalah hash. Tabel yang bocor tidak dapat dipakai masuk.
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM refresh_tokens WHERE encode(token_hash, 'escape') LIKE $1`,
      [`%${body.refreshToken}%`],
    );
    assert.equal(rows[0].n, 0);

    const audit = await db.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE detail::text LIKE $1`,
      [`%${body.refreshToken}%`],
    );
    assert.equal(audit.rows[0].n, 0, 'nilai token bocor ke audit');
  });
});
