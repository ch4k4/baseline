import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { bootstrap } from '../src/main.js';
import { cleanupInvitationArtifacts } from '../scripts/test-cleanup.js';
import { claims } from './token-helper.js';

/**
 * Tes slice 13 - DEMO-0311 (guard platform + admin platform) dan DEMO-0313
 * (notifikasi keamanan tenant).
 *
 * Yang dibuktikan di sini adalah baris-baris daftar tes wajib ADR-003 sec.5 yang
 * memang sudah punya objek pada slice ini:
 *
 *   * superadmin tanpa membership dapat login dan memperoleh session PLATFORM;
 *   * token PLATFORM ditolak di route tenant dan sebaliknya;
 *   * superadmin TANPA support session tidak dapat membaca data tenant;
 *   * role tenant tidak dapat memperoleh permission platform;
 *   * superadmin tidak dapat mengubah assignment dirinya sendiri;
 *   * bootstrap idempoten dan teraudit;
 *   * tenant_notifications hanya via F-15, hanya dibaca pemegang audit.read,
 *     dan tidak menyeberang tenant.
 *
 * Yang TIDAK diuji di sini, dan alasannya: support session, READ_ONLY, masking,
 * dan reveal adalah DEMO-0312. Notifikasi karena itu dibuat lewat F-15 langsung
 * dari koneksi superuser tes - dalam pemakaian normal belum ada yang memanggilnya.
 */

const PORT = Number(process.env.TEST_PORT ?? 3208);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';
const SUPERADMIN_EMAIL = 'superadmin@demo.platform';
const SUPERADMIN_ID = 'dddddddd-0000-0000-0000-000000000001';

/**
 * Identitas yang dipakai sebagai CALON admin platform: admin Beta.
 *
 * BUKAN `user@alpha.demo`, dan itu bukan selera: akun itu sengaja dikunci tes
 * slice 6 selama 5 menit, sehingga setiap tes yang memakainya lulus atau gagal
 * tergantung urutan suite. Pelajaran yang sudah tercatat di slice 12 dan saya
 * ulangi di sini - versi pertama berkas ini memakainya, lulus di lingkungan
 * pengembangan, dan gagal di mesin target karena di sana tes API berjalan tepat
 * sebelum tes browser.
 */
const BETA_ADMIN_EMAIL = 'admin@beta.demo';
const BETA_ADMIN_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const R_ALPHA_USER = '9a9a9a9a-0000-0000-0000-000000000003';
const RUN = randomBytes(4).toString('hex');

let app: any;
let db: Client;
let mulai: Date;
let platform: string;
let ownerAlpha: string;
let adminBeta: string;
let tanpaAudit: string;
let outbox: string;

async function http(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    body: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })() as any,
  };
}

async function tenantToken(email: string, tenantId: string): Promise<string> {
  const r = await http('POST', '/api/v1/auth/login', { email, password: PASSWORD });
  assert.equal(r.status, 201, `login ${email} gagal: ${r.text}`);
  if (r.body.status === 'SESSION') return r.body.accessToken;
  const s = await http('POST', '/api/v1/auth/select-context', {
    ticket: r.body.ticket,
    tenantId,
  });
  assert.equal(s.status, 201, s.text);
  return s.body.accessToken;
}

/**
 * Sesi support sungguhan, dibuat lewat koneksi superuser.
 *
 * Sejak migrasi 0020, `tenant_notifications.ref_id` adalah FOREIGN KEY ke
 * support_sessions - janji yang ditulis 0019 dan dibayar di 0312. Notifikasi
 * karena itu tidak dapat lagi menunjuk id karangan, dan tes ini mengikuti
 * databasenya: ia membuat sesi yang benar-benar ada. Jalur produknya (endpoint
 * platform) diuji di slice 14; di sini sesi hanya perlu ADA.
 */
async function sesiSupport(tenantId: string): Promise<string> {
  const { rows: sesi } = await db.query<{ id: string }>(
    `INSERT INTO sessions (context_kind, tenant_id, user_id, membership_id, expires_at)
     VALUES ('PLATFORM', NULL, $1, NULL, now() + interval '1 hour') RETURNING id`,
    [SUPERADMIN_ID],
  );
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO support_sessions
       (tenant_id, superadmin_user_id, platform_session_id, scope, reason_code,
        reason_text_ciphertext, reason_text_key_version, expires_at)
     VALUES ($1, $2, $3, 'READ_ONLY', 'DATA_INVESTIGATION', '\\x00'::bytea, 1,
             now() + interval '30 minutes')
     RETURNING id`,
    [tenantId, SUPERADMIN_ID, sesi[0].id],
  );
  return rows[0].id;
}

/** Notifikasi keamanan hanya dapat dibuat lewat F-15 (migrasi 0019). */
async function notify(tenantId: string, type = 'SUPPORT_SESSION_STARTED'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT auth.notify_tenant_security_event($1, $2, $3) AS id',
    [tenantId, type, await sesiSupport(tenantId)],
  );
  return rows[0].id;
}

/**
 * Anggota Alpha baru dengan role seed `tenant_user` (tanpa `audit.read`).
 *
 * Dibuat per run lewat undangan owner, karena satu-satunya akun seed tanpa
 * `audit.read` adalah `user@alpha.demo` - akun yang dikunci tes lain.
 */
async function anggotaTanpaAudit(): Promise<string> {
  const email = `t13-${RUN}@test.demo`;
  const sebelum = new Set(readdirSync(outbox));
  const inv = await http(
    'POST',
    '/api/v1/invitations',
    { email, roleIds: [R_ALPHA_USER] },
    ownerAlpha,
  );
  if (inv.status !== 202) throw new Error(`undangan gagal: ${inv.text}`);

  const berkas = readdirSync(outbox).find((f) => !sebelum.has(f));
  if (!berkas) throw new Error('undangan tidak muncul di outbox');
  const isi = readFileSync(join(outbox, berkas), 'utf8');
  const token = /\/invite\?token=([A-Za-z0-9_-]{43})/.exec(isi)![1];

  const pass = `Anggota#${RUN}x`;
  const acc = await http('POST', '/api/v1/invitations/accept', {
    token,
    password: pass,
    displayName: `T13 ${RUN}`,
  });
  if (acc.status !== 200) throw new Error(`penerimaan gagal: ${acc.text}`);

  const r = await http('POST', '/api/v1/auth/login', { email, password: pass });
  if (r.status !== 201) throw new Error(`login anggota baru gagal: ${r.text}`);
  return r.body.accessToken;
}

before(async () => {
  outbox = mkdtempSync(join(tmpdir(), 'saas-outbox-'));
  process.env.DEMO_OUTBOX_DIR = outbox;
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
  mulai = (await db.query('SELECT clock_timestamp() AS t')).rows[0].t;

  await cleanupInvitationArtifacts(db);
  ownerAlpha = await tenantToken('owner@alpha.demo', ALPHA);
  adminBeta = await tenantToken(BETA_ADMIN_EMAIL, BETA);
  tanpaAudit = await anggotaTanpaAudit();
});

after(async () => {
  // Assignment yang dibuat tes dibersihkan: daftar admin platform adalah keadaan
  // bersama, dan tes yang meninggalkan jejak di keadaan bersama akan membuat tes
  // lain lulus atau gagal karena sebab yang tidak ada di dalamnya.
  if (db) {
    await db.query('DELETE FROM platform_role_assignments WHERE user_id <> $1', [SUPERADMIN_ID]);
    await db.query('DELETE FROM tenant_notifications WHERE created_at >= $1', [mulai]);
    // Urutannya wajib: notifikasi menunjuk sesi support, sesi support menunjuk
    // session platform. Membersihkan dari ujung yang salah menghasilkan
    // pelanggaran foreign key, bukan database yang bersih.
    await db.query('DELETE FROM support_sessions WHERE started_at >= $1', [mulai]);
    await cleanupInvitationArtifacts(db);
  }
  await db?.end();
  await app?.close();
  if (outbox) rmSync(outbox, { recursive: true, force: true });
});

describe('slice 13 - guard platform (DEMO-0311) dan notifikasi keamanan (DEMO-0313)', () => {
  test('1. superadmin tanpa membership login dan memperoleh session PLATFORM', async () => {
    const r = await http('POST', '/api/v1/auth/login', {
      email: SUPERADMIN_EMAIL,
      password: PASSWORD,
    });
    assert.equal(r.status, 201, r.text);
    // Satu context: langsung session, tanpa tiket pemilihan.
    assert.equal(r.body.status, 'SESSION');
    assert.equal(r.body.context.kind, 'PLATFORM');
    assert.equal(r.body.context.tenantId, null);
    assert.equal(r.body.context.membershipId, null);

    const c = claims(r.body.accessToken);
    assert.equal(c.ctx, 'PLATFORM');
    assert.equal(c.tid, null);
    assert.equal(c.mid, null);

    // Baris session-nya memang PLATFORM dan tanpa tenant.
    const { rows } = await db.query(
      'SELECT context_kind, tenant_id, membership_id FROM sessions WHERE id = $1',
      [c.sid],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].context_kind, 'PLATFORM');
    assert.equal(rows[0].tenant_id, null);
    assert.equal(rows[0].membership_id, null);

    platform = r.body.accessToken;
  });

  test('2. token PLATFORM ditolak di route tenant, token TENANT ditolak di route platform', async () => {
    // Inti ADR-003 sec.2.6 butir 2, dan sekaligus baris pertama daftar tes wajib
    // sec.5: superadmin TANPA support session tidak membaca data tenant. Yang
    // menolak bukan "permission kurang" melainkan context yang salah.
    for (const path of [
      '/api/v1/members',
      '/api/v1/roles',
      '/api/v1/invitations',
      '/api/v1/notifications/security',
    ]) {
      const r = await http('GET', path, undefined, platform);
      assert.equal(r.status, 403, `${path} seharusnya 403 untuk token platform: ${r.text}`);
    }

    for (const token of [ownerAlpha, adminBeta]) {
      const r = await http('GET', '/api/v1/platform/admins', undefined, token);
      assert.equal(r.status, 403, `route platform seharusnya 403 untuk token tenant: ${r.text}`);
    }

    // Tanpa token pun tetap 401, bukan 403: bedanya penting bagi web.
    assert.equal((await http('GET', '/api/v1/platform/admins')).status, 401);
  });

  test('3. role tenant tidak dapat memperoleh permission platform', async () => {
    const c = await http('POST', '/api/v1/roles', { code: `r13_${Date.now()}`, name: 'Uji 13' }, ownerAlpha);
    assert.equal(c.status, 201, c.text);

    const p = await http(
      'PUT',
      `/api/v1/roles/${c.body.id}/permissions`,
      { permissions: ['platform.admins.manage'], version: c.body.version },
      ownerAlpha,
    );
    // 400, dan itu memang keputusan slice 11: permission platform, permission
    // yang pensiun, dan salah ketik mendapat SATU pesan yang sama, karena
    // membedakannya akan memberi tahu tenant apa saja yang ada di luar
    // katalognya. Lapisan database (foreign key (code, scope)) dibuktikan
    // terpisah oleh kasus SQL slice 13 #4.
    assert.equal(p.status, 400, p.text);
    assert.match(p.body.message, /platform\.admins\.manage/);

    // Katalog tenant tidak pernah memuat permission platform.
    const kat = await http('GET', '/api/v1/permissions', undefined, ownerAlpha);
    assert.equal(kat.status, 200, kat.text);
    const kode = kat.body.permissions.map((x: any) => x.code);
    assert.equal(kode.some((k: string) => k.startsWith('platform.')), false);

    await http('DELETE', `/api/v1/roles/${c.body.id}?version=${c.body.version}`, undefined, ownerAlpha);
  });

  test('4. daftar, beri, dan cabut admin platform; keduanya tercatat di audit', async () => {
    const awal = await http('GET', '/api/v1/platform/admins', undefined, platform);
    assert.equal(awal.status, 200, awal.text);
    // Hanya superadmin hasil bootstrap.
    assert.equal(awal.body.admins.length, 1);
    assert.equal(awal.body.admins[0].user_id, SUPERADMIN_ID);
    // Daftar TIDAK memuat email atau nama: superadmin tidak membaca identitas
    // global dalam bentuk terbuka (ADR-003 sec.2.1).
    assert.equal(JSON.stringify(awal.body).includes('@'), false);

    const beri = await http(
      'POST',
      '/api/v1/platform/admins',
      { userId: BETA_ADMIN_ID, reason: 'Tiket 12345678: penugasan operator kedua' },
      platform,
    );
    assert.equal(beri.status, 201, beri.text);

    const sesudah = await http('GET', '/api/v1/platform/admins', undefined, platform);
    assert.equal(sesudah.body.admins.length, 2);

    // Yang baru diberi hak benar-benar dapat memakai route platform, setelah
    // login ulang: hak platform tidak menempel pada session tenant lamanya.
    const barusan = await http('POST', '/api/v1/auth/login', {
      email: BETA_ADMIN_EMAIL,
      password: PASSWORD,
    });
    assert.equal(barusan.status, 201, barusan.text);
    // Kini ia punya dua context (Alpha + PLATFORM), jadi wajib memilih.
    assert.equal(barusan.body.status, 'CONTEXT_REQUIRED', barusan.text);
    const kinds = barusan.body.contexts.map((c: any) => c.kind).sort();
    assert.deepEqual(kinds, ['PLATFORM', 'TENANT']);

    const pilih = await http('POST', '/api/v1/auth/select-context', {
      ticket: barusan.body.ticket,
      kind: 'PLATFORM',
    });
    assert.equal(pilih.status, 201, pilih.text);
    assert.equal(claims(pilih.body.accessToken).ctx, 'PLATFORM');
    assert.equal((await http('GET', '/api/v1/platform/admins', undefined, pilih.body.accessToken)).status, 200);

    // Dan session TENANT milik orang yang SAMA - yang memang admin platform -
    // tetap ditolak di route platform. Tanpa kasus ini, menghapus pemeriksaan
    // context di guard tidak akan menggagalkan tes apa pun: pemegang token
    // tenant yang bukan admin platform tetap ditolak karena haknya kosong,
    // sehingga penolakannya terjadi karena alasan yang salah.
    const tenantMilikAdmin = await http('POST', '/api/v1/auth/login', {
      email: BETA_ADMIN_EMAIL,
      password: PASSWORD,
    });
    const pilihTenant = await http('POST', '/api/v1/auth/select-context', {
      ticket: tenantMilikAdmin.body.ticket,
      tenantId: BETA,
    });
    assert.equal(pilihTenant.status, 201, pilihTenant.text);
    assert.equal(claims(pilihTenant.body.accessToken).ctx, 'TENANT');
    assert.equal(
      (await http('GET', '/api/v1/platform/admins', undefined, pilihTenant.body.accessToken)).status,
      403,
      'token TENANT milik admin platform tetap ditolak di route platform',
    );

    const cabut = await http('POST', `/api/v1/platform/admins/${beri.body.id}/revoke`, {}, platform);
    assert.equal(cabut.status, 200, cabut.text);
    assert.equal((await http('GET', '/api/v1/platform/admins', undefined, platform)).body.admins.length, 1);

    // Session platform miliknya mati bukan karena pencabutan (itu DEMO-0312:
    // pencabutan belum mencabut session), tetapi hak platformnya sudah hilang
    // untuk login berikutnya. Yang diperiksa di sini hanya yang memang berlaku.
    const lagi = await http('POST', '/api/v1/auth/login', {
      email: BETA_ADMIN_EMAIL,
      password: PASSWORD,
    });
    assert.equal(lagi.body.status, 'SESSION', lagi.text);
    assert.equal(lagi.body.context.kind, 'TENANT');

    const { rows } = await db.query(
      `SELECT event_type, outcome, tenant_id, actor_user_id, subject_id, detail
       FROM audit_logs
       WHERE occurred_at >= $1 AND event_type IN ('platform.admin_granted','platform.admin_revoked')
       ORDER BY occurred_at`,
      [mulai],
    );
    assert.equal(rows.length, 2, 'satu pemberian dan satu pencabutan');
    assert.equal(rows[0].event_type, 'platform.admin_granted');
    assert.equal(rows[1].event_type, 'platform.admin_revoked');
    for (const r of rows) {
      assert.equal(r.outcome, 'SUCCESS');
      // Event platform tidak melekat pada tenant mana pun.
      assert.equal(r.tenant_id, null);
      assert.equal(r.actor_user_id, SUPERADMIN_ID);
      assert.equal(r.subject_id, beri.body.id);
      // Tidak ada data pribadi di detail.
      assert.equal(JSON.stringify(r.detail).includes('@'), false);
    }
  });

  test('5. tidak dapat mengubah assignment diri sendiri; identitas tak dikenal dan alasan salah ditolak', async () => {
    const diri = await http(
      'POST',
      '/api/v1/platform/admins',
      { userId: SUPERADMIN_ID },
      platform,
    );
    assert.equal(diri.status, 403, diri.text);

    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM platform_role_assignments WHERE user_id = $1 AND revoked_at IS NULL`,
      [SUPERADMIN_ID],
    );
    const cabutDiri = await http(
      'POST',
      `/api/v1/platform/admins/${rows[0].id}/revoke`,
      {},
      platform,
    );
    assert.equal(cabutDiri.status, 403, cabutDiri.text);
    // Dan ia benar-benar masih menjadi admin sesudahnya.
    assert.equal((await http('GET', '/api/v1/platform/admins', undefined, platform)).body.admins.length, 1);

    // Identitas yang tidak ada: 400, bukan 500 dari foreign key.
    const hantu = await http(
      'POST',
      '/api/v1/platform/admins',
      { userId: '00000000-0000-0000-0000-0000000000ff' },
      platform,
    );
    assert.equal(hantu.status, 400, hantu.text);

    // Alasan bukan tempat data pribadi (pelajaran D-26).
    const email = await http(
      'POST',
      '/api/v1/platform/admins',
      { userId: BETA_ADMIN_ID, reason: 'diminta budi@contoh.co.id' },
      platform,
    );
    assert.equal(email.status, 400, email.text);
    assert.match(email.body.message, /email/i);

    // Dua kali memberi hak yang sama: 409, bukan baris kedua.
    const satu = await http('POST', '/api/v1/platform/admins', { userId: BETA_ADMIN_ID }, platform);
    assert.equal(satu.status, 201, satu.text);
    const dua = await http('POST', '/api/v1/platform/admins', { userId: BETA_ADMIN_ID }, platform);
    assert.equal(dua.status, 409, dua.text);
    await http('POST', `/api/v1/platform/admins/${satu.body.id}/revoke`, {}, platform);
  });

  test('6. bootstrap idempoten dan teraudit', async () => {
    // Bootstrap dijalankan skrip, bukan API. Yang diperiksa di sini adalah
    // keadaan yang ditinggalkannya: tepat satu assignment aktif untuk superadmin,
    // dan tepat satu baris audit pemberian yang berasal dari BOOTSTRAP - sekalipun
    // perintahnya dijalankan berulang oleh db.ps1/db.sh setiap reset.
    const aktif = await db.query(
      `SELECT count(*)::int AS n FROM platform_role_assignments
       WHERE user_id = $1 AND role_code = 'platform_superadmin' AND revoked_at IS NULL`,
      [SUPERADMIN_ID],
    );
    assert.equal(aktif.rows[0].n, 1);

    const audit = await db.query(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE event_type = 'platform.admin_granted' AND detail->>'via' = 'BOOTSTRAP'`,
    );
    assert.equal(audit.rows[0].n, 1);

    // granted_by kosong: pemberian pertama tidak punya pelaku di dalam aplikasi.
    const baris = await db.query(
      `SELECT granted_by, reason FROM platform_role_assignments
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [SUPERADMIN_ID],
    );
    assert.equal(baris.rows[0].granted_by, null);
    assert.match(baris.rows[0].reason, /Bootstrap/);
  });

  test('7. notifikasi keamanan: hanya via F-15, hanya audit.read, tidak menyeberang tenant', async () => {
    const id = await notify(ALPHA);

    // Owner Alpha memegang audit.read (role tenant_owner).
    const lihat = await http('GET', '/api/v1/notifications/security', undefined, ownerAlpha);
    assert.equal(lihat.status, 200, lihat.text);
    assert.equal(lihat.body.notifications.some((n: any) => n.id === id), true);
    assert.ok(lihat.body.unread >= 1);

    // Anggota tanpa audit.read: 403, bukan daftar kosong. Daftar kosong akan
    // membuat "tidak punya hak" dan "tidak ada kejadian" terlihat sama.
    const tolak = await http('GET', '/api/v1/notifications/security', undefined, tanpaAudit);
    assert.equal(tolak.status, 403, tolak.text);

    // Tenant lain tidak melihatnya, dan tidak dapat menandainya terbaca.
    const beta = await http('GET', '/api/v1/notifications/security', undefined, adminBeta);
    assert.equal(beta.status, 200, beta.text);
    assert.equal(beta.body.notifications.some((n: any) => n.id === id), false);
    assert.equal((await http('POST', `/api/v1/notifications/security/${id}/read`, {}, adminBeta)).status, 404);

    // Menandai terbaca: sekali jalan, dan diklik dua kali bukan kesalahan.
    const baca = await http('POST', `/api/v1/notifications/security/${id}/read`, {}, ownerAlpha);
    assert.equal(baca.status, 200, baca.text);
    assert.equal(baca.body.status, 'READ');
    const lagi = await http('POST', `/api/v1/notifications/security/${id}/read`, {}, ownerAlpha);
    assert.equal(lagi.body.status, 'ALREADY_READ');

    // Pembacanya tercatat, dan tidak dapat dikembalikan menjadi belum dibaca.
    const { rows } = await db.query(
      'SELECT read_at, read_by_membership_id FROM tenant_notifications WHERE id = $1',
      [id],
    );
    assert.notEqual(rows[0].read_at, null);
    assert.notEqual(rows[0].read_by_membership_id, null);

    // Tipe di luar allowlist ditolak fungsinya, bukan diterima lalu disaring.
    await assert.rejects(() => notify(ALPHA, 'APA_SAJA'));
  });
});
