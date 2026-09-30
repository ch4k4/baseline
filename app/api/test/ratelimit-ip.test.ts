import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { bootstrap } from '../src/main.js';
import { AuditService } from '../src/auth/audit.service.js';
import { CLIENT_IP_HEADER } from '../src/auth/client-ip.js';

/**
 * Pembatasan percobaan login per IP klien (lapis kedua rate limit).
 *
 * Lapis per email (slice 6) tidak memperlambat password spraying: satu password
 * dicoba ke banyak email, dan tiap email hanya mendapat satu kegagalan. Tes ini
 * membuktikan lapis per IP menghentikannya, tidak menular ke IP lain, tidak
 * menyimpan IP, dan tidak dapat diputari dengan memalsukan header dari luar
 * proxy tepercaya.
 *
 * Batasnya diturunkan ke 3 supaya tes singkat; nilainya dibaca per panggilan.
 * Setiap kasus memakai IP dokumentasi (RFC 5737) dan email sendiri, supaya
 * penghitung satu kasus tidak mengunci kasus lain.
 */

const PORT = Number(process.env.TEST_PORT ?? 3217);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const BATAS = 3;

let app: any;
let db: Client;

async function login(email: string, password: string, ip?: string) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { [CLIENT_IP_HEADER]: ip } : {}) },
    body: JSON.stringify({ email, password }),
  });
  return res.status;
}

const emailAcak = () => `semprot-${Math.random().toString(36).slice(2, 10)}@nowhere.test`;

/** Menyemprot `n` email berbeda dari satu IP; setiap email gagal SATU kali. */
async function semprot(ip: string, n: number): Promise<number[]> {
  const hasil: number[] = [];
  for (let i = 0; i < n; i++) hasil.push(await login(emailAcak(), 'salah-sekali', ip));
  return hasil;
}

before(async () => {
  process.env.DEMO_LOGIN_IP_MAX_FAILURES = String(BATAS);
  delete process.env.DEMO_TRUSTED_PROXIES;
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
  delete process.env.DEMO_LOGIN_IP_MAX_FAILURES;
  delete process.env.DEMO_TRUSTED_PROXIES;
  await db?.end();
  await app?.close();
});

describe('rate limit per IP klien', () => {
  test('1. password spraying dari satu IP berhenti setelah batas, walau tiap email baru', async () => {
    const hasil = await semprot('192.0.2.10', BATAS);
    assert.deepEqual(hasil, [401, 401, 401], 'di bawah batas: gagal biasa');
    assert.equal(await login(emailAcak(), 'salah-sekali', '192.0.2.10'), 429, 'email baru pun ditolak');
  });

  test('2. IP lain tidak ikut terkunci', async () => {
    await semprot('192.0.2.20', BATAS);
    assert.equal(await login(emailAcak(), 'salah-sekali', '192.0.2.20'), 429);
    assert.equal(await login(emailAcak(), 'salah-sekali', '192.0.2.21'), 401);
  });

  test('3. password BENAR dari IP yang dibatasi juga ditolak, sebelum password diperiksa', async () => {
    await semprot('192.0.2.30', BATAS);
    assert.equal(await login('owner@alpha.demo', PASSWORD, '192.0.2.30'), 429);
    assert.equal(await login('owner@alpha.demo', PASSWORD, '192.0.2.31'), 201);
  });

  test('4. penolakan diaudit dengan scope CLIENT_IP, tanpa menyimpan IP', async () => {
    const ip = '192.0.2.40';
    const email = emailAcak();
    await semprot(ip, BATAS);
    assert.equal(await login(email, 'salah-sekali', ip), 429);

    const hash: Buffer = await app.get(AuditService).hashIdentifier(email);
    const { rows } = await db.query(
      `SELECT detail FROM audit_logs
        WHERE event_type = 'auth.login.throttled' AND actor_identifier_hash = $1`,
      [hash],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detail.scope, 'CLIENT_IP');
    assert.equal(rows[0].detail.failures, BATAS);

    const { rows: bocor } = await db.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE detail::text LIKE '%' || $1 || '%'`,
      [ip],
    );
    assert.equal(bocor[0].n, 0, 'IP tidak boleh masuk audit');
  });

  test('5. header dari lawan bicara yang TIDAK tepercaya diabaikan: memutar IP palsu tidak menolong', async () => {
    // Loopback tidak lagi tepercaya: tes ini kini "pemanggil yang menembus BFF".
    // Setiap percobaan mengaku IP berbeda, tetapi semuanya dihitung pada alamat
    // socket yang sama - sehingga batasnya tetap tercapai.
    process.env.DEMO_TRUSTED_PROXIES = '203.0.113.99';
    try {
      const hasil: number[] = [];
      for (let i = 0; i < BATAS; i++) {
        hasil.push(await login(emailAcak(), 'salah-sekali', `198.51.100.${i + 1}`));
      }
      assert.deepEqual(hasil, [401, 401, 401]);
      assert.equal(await login(emailAcak(), 'salah-sekali', '198.51.100.200'), 429);
    } finally {
      delete process.env.DEMO_TRUSTED_PROXIES;
    }
  });
});
