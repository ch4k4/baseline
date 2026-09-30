import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sid } from './token-helper.js';
import { Client } from 'pg';
import { bootstrap } from '../src/main.js';
import { AuditService } from '../src/auth/audit.service.js';
import { AUDIT_EVENTS } from '../src/auth/audit-events.js';

/**
 * Tes slice 6: audit event dan rate limiting.
 *
 * Audit diperiksa langsung di database, bukan lewat API, karena yang penting
 * bukan "endpoint mengembalikan 200" melainkan "barisnya benar-benar ada dan
 * tidak memuat data pribadi".
 */

const PORT = Number(process.env.TEST_PORT ?? 3197);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const ALPHA = '11111111-1111-1111-1111-111111111111';

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

const login = (email: string, password = PASSWORD) =>
  post('/api/v1/auth/login', { email, password });

/**
 * Pseudonim identifier dihitung oleh layanan yang SAMA dengan aplikasi. Sejak
 * D-01 pseudonim itu HMAC berkunci; tes yang menghitung sha256 sendiri di SQL
 * akan mencari nilai yang tidak pernah ditulis siapa pun.
 */
const idHash = (email: string): Promise<Buffer> => app.get(AuditService).hashIdentifier(email);

/** Email unik per kasus supaya penghitung rate limit satu kasus tidak mengunci kasus lain. */
const emailAcak = () => `tidak-ada-${Math.random().toString(36).slice(2, 10)}@nowhere.test`;

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

describe('slice 6 - audit dan rate limiting', () => {
  test('1. login berhasil tercatat sebagai SUCCESS dengan tenant dan session', async () => {
    const res = await login('owner@alpha.demo');
    const { rows } = await db.query(
      `SELECT tenant_id, outcome, actor_session_id FROM audit_logs
       WHERE event_type = 'auth.login' AND actor_session_id = $1`,
      [sid(res.body.accessToken)],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'SUCCESS');
    assert.equal(rows[0].tenant_id, ALPHA);
  });

  test('2. login gagal tercatat, dengan alasan tapi tanpa email', async () => {
    const email = emailAcak();
    await login(email, 'salah');

    const { rows } = await db.query(
      `SELECT detail, actor_identifier_hash, actor_user_id FROM audit_logs
       WHERE event_type = 'auth.login' AND outcome = 'FAILURE'
         AND actor_identifier_hash = $1`,
      [await idHash(email)],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detail.reason, 'IDENTITY_NOT_FOUND');
    assert.equal(rows[0].actor_user_id, null);
    assert.ok(rows[0].actor_identifier_hash, 'hash identifier harus tersimpan');
  });

  test('3. tidak ada email atau token di seluruh isi audit', async () => {
    await login('owner@alpha.demo');
    await login('owner@alpha.demo', 'salah-sekali');

    // Pemeriksaan menyeluruh, bukan per-kolom: kalau suatu saat ada kode yang
    // menaruh email ke detail, kasus ini yang menangkapnya.
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE detail::text ILIKE '%@%' OR detail::text ILIKE '%demo#%'`,
    );
    assert.equal(rows[0].n, 0, 'ada jejak email atau password di detail audit');
  });

  test('4. password salah dicatat dengan alasan BAD_PASSWORD', async () => {
    // Versi sebelumnya lulus dari data sisa: ia mencari BAD_PASSWORD di seluruh
    // tabel, dan akun yang dipakainya (user@alpha.demo) sudah dikunci kasus 8
    // run sebelumnya - sehingga login-nya tertahan 429 tanpa pernah sampai ke
    // verifikasi password. Tiga perbaikan, masing-masing menutup satu jalan lolos:
    //   1. akun yang tidak dikunci tes mana pun (admin@beta.demo login berhasil
    //      di kasus 5, jadi hitungannya kembali nol setiap run);
    //   2. status 401 diperiksa - 429 berarti password tidak pernah diverifikasi;
    //   3. hanya baris milik identitas ini yang terjadi SETELAH kasus dimulai.
    const email = 'admin@beta.demo';
    const { rows: mulai } = await db.query('SELECT clock_timestamp() AS t');

    const res = await login(email, 'jelas-salah');
    assert.equal(res.status, 401, 'login tertahan sebelum password diverifikasi');

    const { rows } = await db.query(
      `SELECT detail FROM audit_logs
       WHERE event_type = 'auth.login' AND outcome = 'FAILURE'
         AND detail->>'reason' = 'BAD_PASSWORD'
         AND actor_identifier_hash = $1
         AND occurred_at >= $2`,
      [await idHash(email), mulai[0].t],
    );
    assert.equal(rows.length, 1, 'kegagalan ini tidak tercatat sebagai BAD_PASSWORD');
  });

  test('5. logout tercatat', async () => {
    const res = await login('admin@beta.demo');
    await post('/api/v1/auth/logout', {}, res.body.accessToken);

    const { rows } = await db.query(
      `SELECT outcome FROM audit_logs
       WHERE event_type = 'auth.logout' AND actor_session_id = $1`,
      [sid(res.body.accessToken)],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'SUCCESS');
  });

  test('6. perpindahan tenant tercatat beserta pencabutan session lama', async () => {
    const masuk = await login('multi@demo.local');
    const sesi = await post('/api/v1/auth/select-context', {
      ticket: masuk.body.ticket,
      tenantId: ALPHA,
    });
    const pindah = await post(
      '/api/v1/me/context-switch',
      { tenantId: '22222222-2222-2222-2222-222222222222' },
      sesi.body.accessToken,
    );

    const { rows } = await db.query(
      `SELECT detail FROM audit_logs
       WHERE event_type = 'auth.context_switch' AND actor_session_id = $1`,
      [sid(pindah.body.accessToken)],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detail.previousSessionRevoked, true);
  });

  test('7. percobaan gagal berulang akhirnya ditolak 429', async () => {
    const email = emailAcak();
    const kode: number[] = [];
    for (let i = 0; i < 7; i++) {
      kode.push((await login(email, 'salah')).status);
    }

    assert.ok(kode.slice(0, 5).every((k) => k === 401), `lima pertama harus 401: ${kode}`);
    assert.ok(kode.includes(429), `harus ada 429 setelah lima kegagalan: ${kode}`);
  });

  test('8. pesan 429 tidak membocorkan keberadaan akun', async () => {
    const adaEmail = emailAcak();
    const tidakAda = emailAcak();

    for (let i = 0; i < 6; i++) await login('user@alpha.demo', `salah-${adaEmail}`);
    for (let i = 0; i < 6; i++) await login(tidakAda, 'salah');

    const akunAda = await login('user@alpha.demo', 'salah-lagi');
    const akunTidakAda = await login(tidakAda, 'salah-lagi');

    assert.equal(akunAda.status, 429);
    assert.equal(akunTidakAda.status, 429);
    assert.equal(akunAda.body.message, akunTidakAda.body.message);
  });

  test('9. throttling ikut tercatat di audit', async () => {
    // Kasus ini memicu throttle-nya SENDIRI dan hanya menghitung baris milik
    // identitas acaknya. Versi sebelumnya menghitung seluruh tabel: ia lulus
    // dari sisa run sebelumnya walau pencatatan throttle sudah dihapus
    // (dibuktikan mutation test 2026-09-21, 45/45 tetap hijau).
    const email = emailAcak();
    for (let i = 0; i < 6; i++) await login(email, 'salah');
    assert.equal((await login(email, 'salah')).status, 429, 'throttle tidak terpicu');

    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE event_type = 'auth.login.throttled'
         AND actor_identifier_hash = $1`,
      [await idHash(email)],
    );
    assert.ok(rows[0].n > 0, 'kejadian throttle harus tercatat untuk identitas ini');
  });

  test('10. akun yang tidak diserang tetap dapat masuk', async () => {
    // Rate limit terikat identifier, bukan global. Kalau sifat ini hilang, satu
    // penyerang dapat mengunci seluruh pengguna.
    //
    // Versi sebelumnya hanya login dengan akun yang baru saja sukses - hitungan
    // gagalnya selalu nol, jadi penghitungan global pun lolos (audit tes
    // 2026-09-21). Sekarang: serang satu identitas sampai terkunci, lalu pastikan
    // identitas BARU tanpa riwayat apa pun belum ikut terkunci.
    const diserang = emailAcak();
    const kode: number[] = [];
    for (let i = 0; i < 6; i++) kode.push((await login(diserang, 'salah')).status);
    assert.equal(kode[kode.length - 1], 429, `serangan harus berakhir 429: ${kode}`);

    const tetangga = await login(emailAcak(), 'salah');
    assert.equal(tetangga.status, 401, 'kegagalan identitas lain ikut mengunci identitas ini');

    assert.equal((await login('owner@alpha.demo')).status, 201);
  });

  test('11. setiap nama event yang dipakai kode ada di katalog database (D-30)', async () => {
    const { rows } = await db.query<{ code: string }>('SELECT code FROM audit_event_types ORDER BY code');
    const katalog = rows.map((r) => r.code);

    // Nama yang tidak ada di katalog ditolak foreign key, dan AuditService
    // menelan kegagalan itu: barisnya hanya tidak pernah ada. Yang menangkapnya
    // adalah pemeriksaan ini, bukan pengguna yang mencari jejak audit.
    const asing = AUDIT_EVENTS.filter((e) => !katalog.includes(e));
    assert.deepEqual(asing, [], 'nama event di kode tidak ada di katalog');
    assert.equal(new Set(katalog).size, katalog.length, 'katalog memuat nama ganda');
    // Katalog juga memuat nama untuk fitur yang belum dibuat (Demo Foundation sec.15).
    // Angka ini dipatok dengan sengaja: nama event yang ditambahkan tanpa mencatatnya
    // di sec.15 akan menggagalkan kasus ini, dan itu memang tujuannya. 37 sejak
    // `tenant.owner_provisioned` (provisioning tenant, slice 16).
    assert.equal(katalog.length, 37);
    // Contohnya diganti sejak slice 14: support.session.* kini DIPAKAI kode
    // (DEMO-0312), jadi ia tidak lagi membuktikan bahwa katalog lebih luas
    // daripada daftar di kode. Yang masih benar-benar hanya di katalog adalah
    // membuka masker DP-1 - fitur yang belum dibuat (D-37).
    assert.ok(katalog.includes('support.data_revealed') && !AUDIT_EVENTS.includes('support.data_revealed' as any));

    // Semua yang benar-benar tertulis selama seluruh suite ini juga harus terdaftar;
    // ini menangkap nama yang lolos tipe lewat jalur lain (SQL mentah, tes).
    const { rows: dipakai } = await db.query<{ event_type: string }>(
      'SELECT DISTINCT event_type FROM audit_logs');
    assert.deepEqual(dipakai.map((r) => r.event_type).filter((e) => !katalog.includes(e)), []);
  });
});
