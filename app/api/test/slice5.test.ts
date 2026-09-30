import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap } from '../src/main.js';

/**
 * Tes slice 5: tiket pemilihan context dan perpindahan tenant.
 *
 * Yang diuji bukan "alurnya jalan", melainkan sifat yang membuat alur itu aman:
 * tiket sekali pakai, tiket tidak dapat menunjuk tenant orang lain, dan session
 * lama benar-benar mati setelah berpindah.
 */

const PORT = Number(process.env.TEST_PORT ?? 3198);
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

const login = (email: string) => post('/api/v1/auth/login', { email, password: PASSWORD });

before(async () => {
  process.env.PORT = String(PORT);
  app = await bootstrap(PORT);
});
after(async () => {
  await app?.close();
});

describe('slice 5 - pemilihan context dan perpindahan tenant', () => {
  test('1. login lintas tenant mengeluarkan tiket, bukan token', async () => {
    const res = await login('multi@demo.local');
    assert.equal(res.body.status, 'CONTEXT_REQUIRED');
    assert.equal(res.body.contexts.length, 2);
    assert.ok(res.body.ticket, 'tiket harus dikeluarkan');
    assert.ok(!('accessToken' in res.body), 'token tidak boleh keluar sebelum tenant dipilih');
  });

  test('2. tiket tidak dapat dipakai sebagai token session', async () => {
    const { body } = await login('multi@demo.local');
    // Kalau tiket diterima guard, seluruh pemisahan tiket vs session tidak ada artinya.
    assert.equal((await get('/api/v1/members', body.ticket)).status, 401);
  });

  test('3. menukar tiket menghasilkan session pada tenant pilihan', async () => {
    const { body } = await login('multi@demo.local');
    const res = await post('/api/v1/auth/select-context', {
      ticket: body.ticket,
      tenantId: BETA,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.context.tenantId, BETA);

    const members = await get('/api/v1/members', res.body.accessToken);
    assert.equal(members.body.tenantId, BETA);
    assert.equal(members.body.members.length, 2);
  });

  test('4. tiket hanya sekali pakai', async () => {
    const { body } = await login('multi@demo.local');
    const first = await post('/api/v1/auth/select-context', { ticket: body.ticket, tenantId: ALPHA });
    assert.equal(first.status, 201);

    const second = await post('/api/v1/auth/select-context', { ticket: body.ticket, tenantId: ALPHA });
    assert.equal(second.status, 401, 'tiket yang sudah dipakai harus ditolak');
  });

  test('5. tiket tidak dapat menunjuk tenant yang bukan haknya', async () => {
    // owner@alpha.demo hanya anggota Alpha, jadi ia tidak mendapat tiket.
    // Kita pakai tiket milik multi, lalu menunjuk tenant acak yang bukan miliknya.
    const { body } = await login('multi@demo.local');
    const asing = '33333333-3333-3333-3333-333333333333';
    const res = await post('/api/v1/auth/select-context', { ticket: body.ticket, tenantId: asing });
    assert.equal(res.status, 401);
  });

  test('6. percobaan gagal tetap membakar tiket', async () => {
    const { body } = await login('multi@demo.local');
    const asing = '33333333-3333-3333-3333-333333333333';
    await post('/api/v1/auth/select-context', { ticket: body.ticket, tenantId: asing });

    // Tiket sudah terpakai walau percobaannya gagal: tidak ada kesempatan kedua
    // untuk menebak-nebak tenant dengan satu tiket yang sama.
    const ulang = await post('/api/v1/auth/select-context', { ticket: body.ticket, tenantId: ALPHA });
    assert.equal(ulang.status, 401);
  });

  test('7. tiket palsu ditolak', async () => {
    // Tiket sah dibuka lebih dulu dan sengaja belum dipakai. Tanpa tiket terbuka,
    // fungsi yang mengabaikan hash pun lulus karena tidak ada tiket untuk "dicuri"
    // (audit tes 2026-09-21 - pola yang sama dengan slice5_test.sql kasus 5).
    const { body } = await login('multi@demo.local');

    for (const palsu of ['bukan-tiket', 'x'.repeat(43)]) {
      const res = await post('/api/v1/auth/select-context', { ticket: palsu, tenantId: ALPHA });
      assert.equal(res.status, 401, `tiket "${palsu}" menghasilkan ${res.status}`);
    }
    const kosong = await post('/api/v1/auth/select-context', { ticket: '', tenantId: ALPHA });
    assert.equal(kosong.status, 400, 'tiket kosong harus ditolak di tepi, sebelum database');

    const sah = await post('/api/v1/auth/select-context', { ticket: body.ticket, tenantId: ALPHA });
    assert.equal(sah.status, 201, 'tiket sah ikut terpakai oleh tiket palsu');
  });

  test('8. daftar context milik sendiri dapat dibaca setelah punya session', async () => {
    const { body } = await login('multi@demo.local');
    const sesi = await post('/api/v1/auth/select-context', { ticket: body.ticket, tenantId: ALPHA });

    const res = await get('/api/v1/me/contexts', sesi.body.accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.contexts.length, 2);
  });

  test('9. berpindah tenant memberi session tenant baru', async () => {
    const { body } = await login('multi@demo.local');
    const sesi = await post('/api/v1/auth/select-context', { ticket: body.ticket, tenantId: ALPHA });

    const pindah = await post('/api/v1/me/context-switch', { tenantId: BETA }, sesi.body.accessToken);
    assert.equal(pindah.status, 201);
    assert.equal(pindah.body.context.tenantId, BETA);

    const members = await get('/api/v1/members', pindah.body.accessToken);
    assert.equal(members.body.tenantId, BETA);
    const nama = members.body.members.map((m: any) => m.display_name).sort();
    assert.deepEqual(nama, ['Beta Admin', 'Multi di Beta']);
  });

  test('10. session lama mati setelah berpindah', async () => {
    const { body } = await login('multi@demo.local');
    const sesi = await post('/api/v1/auth/select-context', { ticket: body.ticket, tenantId: ALPHA });
    const lama = sesi.body.accessToken;

    assert.equal((await get('/api/v1/members', lama)).status, 200, 'session lama harus hidup dulu');
    await post('/api/v1/me/context-switch', { tenantId: BETA }, lama);

    // Inti kasus ini: token lama tidak boleh tetap membuka data tenant lama.
    assert.equal((await get('/api/v1/members', lama)).status, 401, 'session lama masih hidup');
  });

  test('11. berpindah ke tenant yang bukan anggota ditolak', async () => {
    const alpha = await login('owner@alpha.demo');
    const res = await post(
      '/api/v1/me/context-switch',
      { tenantId: BETA },
      alpha.body.accessToken,
    );
    assert.equal(res.status, 401);

    // Dan session lamanya harus tetap hidup - penolakan bukan alasan mengeluarkan orang.
    assert.equal((await get('/api/v1/members', alpha.body.accessToken)).status, 200);
  });

  test('12. logout mencabut session', async () => {
    const alpha = await login('owner@alpha.demo');
    assert.equal((await get('/api/v1/members', alpha.body.accessToken)).status, 200);

    const keluar = await post('/api/v1/auth/logout', {}, alpha.body.accessToken);
    assert.equal(keluar.status, 201);
    assert.equal((await get('/api/v1/members', alpha.body.accessToken)).status, 401);
  });
});
