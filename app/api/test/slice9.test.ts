import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { bootstrap } from '../src/main.js';
import { claims } from './token-helper.js';
import { cleanupInvitationArtifacts } from '../scripts/test-cleanup.js';

/**
 * Tes slice 9 - D-09: undangan anggota.
 *
 * Yang dibuktikan di sini adalah tiga jaminan di InvitationService:
 *   - pengundang tidak dapat membedakan email terdaftar dari email baru;
 *   - token hanya sampai ke pemilik email (outbox), sekali pakai, dan mati
 *     saat diundang ulang atau dicabut;
 *   - penerimaan membuat identitas atau memakai identitas yang ada, tidak
 *     pernah identitas orang lain.
 *
 * Semua email di sini dibuat baru per run. Akun seed TIDAK diundang ke tenant
 * lain: tes slice lain bergantung pada jumlah context akun-akun itu. Anggota
 * yang ditambahkan dibersihkan sebelum DAN sesudah suite (scripts/test-cleanup.ts),
 * karena slice 2/5/8 memeriksa daftar anggota secara persis. Berkas tes API
 * dijalankan berurutan (--test-concurrency=1) karena alasan yang sama.
 */

const PORT = Number(process.env.TEST_PORT ?? 3204);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';

const RUN = randomBytes(4).toString('hex');
const baru = (label: string) => `t9-${label}-${RUN}@test.demo`;

let app: any;
let db: Client;
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
  return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() as any };
}

const login = (email: string, password = PASSWORD) => http('POST', '/api/v1/auth/login', { email, password });

/** Access token context tenant tertentu, juga untuk akun multi-tenant. */
async function tokenFor(email: string, tenantId: string, password = PASSWORD): Promise<string> {
  const r = await login(email, password);
  assert.equal(r.status, 201, `login ${email} gagal: ${r.text}`);
  if (r.body.status === 'SESSION') {
    assert.equal(r.body.context.tenantId, tenantId);
    return r.body.accessToken;
  }
  const s = await http('POST', '/api/v1/auth/select-context', { ticket: r.body.ticket, tenantId });
  assert.equal(s.status, 201, `select-context gagal: ${s.text}`);
  return s.body.accessToken;
}

interface Mail { file: string; name: string; text: string; token: string; invitationId: string }

/** Mengundang lalu mengambil SATU berkas baru dari outbox. */
async function inviteAndRead(ownerToken: string, email: string): Promise<{ res: any; mail: Mail }> {
  const sebelum = new Set(readdirSync(outbox));
  const res = await http('POST', '/api/v1/invitations', { email }, ownerToken);
  const baruMasuk = readdirSync(outbox).filter((f) => !sebelum.has(f));
  assert.equal(baruMasuk.length, 1, `outbox harus bertambah tepat satu berkas, dapat ${baruMasuk.length}`);
  const name = baruMasuk[0];
  const text = readFileSync(join(outbox, name), 'utf8');
  const token = /\/invite\?token=([A-Za-z0-9_-]{43})\s*$/m.exec(text)?.[1];
  const invitationId = /^Invitation-Id: (\S+)$/m.exec(text)?.[1];
  assert.ok(token, 'tautan undangan tidak memuat token');
  assert.ok(invitationId, 'berkas undangan tidak memuat Invitation-Id');
  return { res, mail: { file: join(outbox, name), name, text, token, invitationId } };
}

const lookup = (token: string) => http('POST', '/api/v1/invitations/lookup', { token });
const accept = (token: string, password: string, displayName = 'Anggota Tes') =>
  http('POST', '/api/v1/invitations/accept', { token, password, displayName });

// Nilai yang tidak boleh pernah muncul di audit log.
const RAHASIA: string[] = [];

let ownerAlpha: string;
let ownerBeta: string;
let mulai: Date; // audit dibaca hanya sejak suite ini mulai, bukan sisa run lain

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
  await cleanupInvitationArtifacts(db); // sisa run yang terhenti di tengah
  mulai = (await db.query('SELECT clock_timestamp() AS t')).rows[0].t;
  ownerAlpha = await tokenFor('owner@alpha.demo', ALPHA);
  ownerBeta = await tokenFor('admin@beta.demo', BETA);
});

after(async () => {
  if (db) await cleanupInvitationArtifacts(db);
  await db?.end();
  await app?.close();
  if (outbox) rmSync(outbox, { recursive: true, force: true });
});

describe('slice 9 - undangan anggota', () => {
  const PENDATANG = baru('pendatang');       // identitas baru lewat undangan Alpha
  const PASS_PENDATANG = 'Pendatang#2026';
  let tokenPendatang = '';

  test('1. owner mengundang: 202 seragam, token hanya ke outbox', async () => {
    const { res, mail } = await inviteAndRead(ownerAlpha, `  ${PENDATANG.toUpperCase()} `);
    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { status: 'INVITED' });
    // Token TIDAK kembali ke pengundang.
    assert.ok(!res.text.includes(mail.token), 'token bocor ke respons pengundang');

    // Email dinormalisasi sebelum dikirim, nama berkas tidak memuat email/token.
    assert.match(mail.text, new RegExp(`^To: ${PENDATANG.replace(/[.]/g, '\\.')}$`, 'm'));
    assert.ok(!mail.name.includes(mail.token) && !mail.name.includes('t9-'), 'nama berkas membocorkan isi');

    // Yang tersimpan hanya hash token dan ciphertext email.
    const { rows } = await db.query('SELECT row_to_json(i)::text AS j FROM user_invitations i WHERE id = $1', [mail.invitationId]);
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].j.includes(mail.token), 'token tersimpan mentah');
    assert.ok(!rows[0].j.toLowerCase().includes(PENDATANG), 'email tersimpan mentah');

    tokenPendatang = mail.token;
    RAHASIA.push(mail.token, PENDATANG);
  });

  test('2. auditor dapat melihat undangan, tetapi tidak dapat mengundang atau mencabut', async () => {
    const multiAlpha = await tokenFor('multi@demo.local', ALPHA);
    const sebelum = readdirSync(outbox).length;
    assert.equal((await http('POST', '/api/v1/invitations', { email: baru('ditolak') }, multiAlpha)).status, 403);
    // Demo Foundation sec.11.1a: melihat status undangan cukup members.read
    // (dikoreksi slice 11; sebelumnya kasus ini menuntut 403). Email tetap ber-masker.
    const lihat = await http('GET', '/api/v1/invitations', undefined, multiAlpha);
    assert.equal(lihat.status, 200);
    assert.ok(lihat.body.invitations.length >= 1);
    assert.ok(lihat.body.invitations.every((i: any) => /^.\*\*\*@/.test(i.email_masked)), 'email undangan tidak dimasking');
    assert.equal(
      (await http('POST', `/api/v1/invitations/e1e1e1e1-0000-0000-0000-000000000001/revoke`, undefined, multiAlpha)).status,
      403,
    );
    assert.equal(readdirSync(outbox).length, sebelum, 'bukan owner tetap menulis ke outbox');

    // UI membaca canInvite dari /members; nilainya mengikuti database.
    assert.equal((await http('GET', '/api/v1/members', undefined, multiAlpha)).body.canInvite, false);
    assert.equal((await http('GET', '/api/v1/members', undefined, ownerAlpha)).body.canInvite, true);

    // Tanpa session sama sekali.
    assert.equal((await http('POST', '/api/v1/invitations', { email: baru('anon') })).status, 401);
  });

  test('3. penerimaan sebagai identitas baru, lalu login', async () => {
    const info = await lookup(tokenPendatang);
    assert.equal(info.status, 200);
    assert.equal(info.body.hasAccount, false);
    assert.equal(typeof info.body.tenantName, 'string');

    const pendek = await accept(tokenPendatang, 'pendek');
    assert.equal(pendek.status, 400, 'password pendek diterima');
    // Penolakan validasi tidak menghabiskan token.
    assert.equal((await lookup(tokenPendatang)).status, 200);

    const ok = await accept(tokenPendatang, PASS_PENDATANG, 'Pendatang Baru');
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.status, 'JOINED');

    const r = await login(PENDATANG, PASS_PENDATANG);
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'SESSION');
    assert.equal(claims(r.body.accessToken).tid, ALPHA);

    const members = await http('GET', '/api/v1/members', undefined, ownerAlpha);
    assert.ok(members.body.members.some((m: any) => m.display_name === 'Pendatang Baru'),
      'anggota baru tidak muncul di daftar anggota');
    RAHASIA.push(PASS_PENDATANG);
  });

  test('4. token sekali pakai', async () => {
    assert.equal((await accept(tokenPendatang, PASS_PENDATANG)).status, 410);
    assert.equal((await lookup(tokenPendatang)).status, 404);
  });

  test('5. email terdaftar dan email baru tidak dapat dibedakan pengundang', async () => {
    // PENDATANG sudah punya akun (kasus 3); email kedua belum pernah ada.
    const a = await inviteAndRead(ownerBeta, PENDATANG);
    const b = await inviteAndRead(ownerBeta, baru('belum-ada'));
    assert.equal(a.res.status, b.res.status);
    assert.equal(a.res.text, b.res.text, 'respons membedakan email terdaftar');

    // Daftar undangan di sisi pengundang juga tidak membawa petunjuk akun.
    const list = await http('GET', '/api/v1/invitations', undefined, ownerBeta);
    const baris = list.body.invitations.filter((i: any) => [a.mail.invitationId, b.mail.invitationId].includes(i.id));
    assert.equal(baris.length, 2);
    assert.deepEqual(Object.keys(baris[0]).sort(), Object.keys(baris[1]).sort());
    for (const i of baris) {
      assert.equal(i.status, 'PENDING');
      assert.match(i.email_masked, /^t\*\*\*@test\.demo$/, 'email tidak dimasking');
      assert.ok(!JSON.stringify(i).includes(RUN), 'bagian lokal email bocor di daftar');
    }
    RAHASIA.push(a.mail.token, b.mail.token);
  });

  test('6. identitas yang ada menerima dengan password miliknya', async () => {
    const { mail } = await inviteAndRead(ownerBeta, PENDATANG); // undang ulang: token baru
    const info = await lookup(mail.token);
    assert.equal(info.body.hasAccount, true);

    const salah = await accept(mail.token, 'bukan-password-nya');
    assert.equal(salah.status, 401, 'password salah menerima undangan');
    assert.equal((await lookup(mail.token)).status, 200, 'password salah menghabiskan token');

    const ok = await accept(mail.token, PASS_PENDATANG, 'Pendatang di Beta');
    assert.equal(ok.status, 200, ok.text);

    // Satu identitas, dua tenant - bukan identitas kedua.
    const { rows } = await db.query(
      `SELECT count(DISTINCT m.user_id)::int AS u, count(*)::int AS m
       FROM tenant_memberships m JOIN tenant_member_profiles p ON p.membership_id = m.id
       WHERE m.tenant_id IN ($1, $2) AND p.display_name_ciphertext IS NOT NULL
         AND m.user_id = (SELECT user_id FROM tenant_memberships WHERE id = (
           SELECT accepted_membership_id FROM user_invitations WHERE id = $3))`,
      [ALPHA, BETA, mail.invitationId],
    );
    assert.deepEqual(rows[0], { u: 1, m: 2 });

    const r = await login(PENDATANG, PASS_PENDATANG);
    assert.equal(r.body.status, 'CONTEXT_REQUIRED');
    assert.equal(r.body.contexts.length, 2);
    RAHASIA.push(mail.token);
  });

  test('6b. menebak password lewat undangan dikunci keranjang yang sama dengan login', async () => {
    // PENDATANG sudah punya 1 kegagalan dari kasus 6. Undangan baru (sudah
    // anggota Beta; undangan tetap dibuat - pengundang tidak boleh tahu).
    const { mail } = await inviteAndRead(ownerBeta, PENDATANG);
    for (let i = 0; i < 4; i++) assert.equal((await accept(mail.token, `tebakan-${i}`)).status, 401);

    // Batas tercapai: password yang BENAR pun ditolak, di undangan maupun login.
    assert.equal((await accept(mail.token, PASS_PENDATANG)).status, 429, 'undangan tidak dibatasi');
    assert.equal((await login(PENDATANG, PASS_PENDATANG)).status, 429, 'keranjang undangan terpisah dari login');
    assert.equal((await lookup(mail.token)).status, 200, 'penolakan rate limit menghabiskan token');
    RAHASIA.push(mail.token);
  });

  test('7. undang ulang mematikan token lama; cabut mematikan token baru', async () => {
    const email = baru('ulang');
    const pertama = await inviteAndRead(ownerAlpha, email);
    const kedua = await inviteAndRead(ownerAlpha, email);
    assert.equal(kedua.mail.invitationId, pertama.mail.invitationId, 'undang ulang membuat baris kedua');
    assert.notEqual(kedua.mail.token, pertama.mail.token);
    assert.equal((await lookup(pertama.mail.token)).status, 404, 'token lama masih hidup');
    assert.equal((await lookup(kedua.mail.token)).status, 200);

    const cabut = await http('POST', `/api/v1/invitations/${kedua.mail.invitationId}/revoke`, undefined, ownerAlpha);
    assert.equal(cabut.status, 200);
    assert.equal((await lookup(kedua.mail.token)).status, 404, 'token undangan yang dicabut masih hidup');
    assert.equal((await accept(kedua.mail.token, 'Password#Panjang')).status, 410);
    assert.equal(
      (await http('POST', `/api/v1/invitations/${kedua.mail.invitationId}/revoke`, undefined, ownerAlpha)).status,
      404,
      'undangan dicabut dua kali',
    );

    // Setelah dicabut, email yang sama dapat diundang lagi (baris baru).
    const ketiga = await inviteAndRead(ownerAlpha, email);
    assert.notEqual(ketiga.mail.invitationId, kedua.mail.invitationId);
    assert.equal((await lookup(ketiga.mail.token)).status, 200);
    RAHASIA.push(pertama.mail.token, kedua.mail.token, ketiga.mail.token, email);
  });

  test('8. Beta tidak melihat maupun mencabut undangan Alpha', async () => {
    const { mail } = await inviteAndRead(ownerAlpha, baru('isolasi'));
    const list = await http('GET', '/api/v1/invitations', undefined, ownerBeta);
    assert.equal(list.status, 200);
    assert.ok(!list.body.invitations.some((i: any) => i.id === mail.invitationId), 'undangan Alpha terlihat oleh Beta');

    const cabut = await http('POST', `/api/v1/invitations/${mail.invitationId}/revoke`, undefined, ownerBeta);
    assert.equal(cabut.status, 404);
    assert.equal((await lookup(mail.token)).status, 200, 'Beta berhasil mencabut undangan Alpha');
    RAHASIA.push(mail.token);
  });

  test('8b. undangan tenant yang ditangguhkan tidak dapat diterima', async () => {
    const { mail } = await inviteAndRead(ownerBeta, baru('tenant-tidur'));
    assert.equal((await lookup(mail.token)).status, 200);
    // Penangguhan tenant dilakukan superuser (belum ada fitur admin platform).
    // finally wajib: Beta yang tertinggal SUSPENDED merusak semua tes berikutnya.
    await db.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [BETA]);
    try {
      assert.equal((await lookup(mail.token)).status, 404, 'tenant ditangguhkan masih menerima anggota');
      assert.equal((await accept(mail.token, 'Password#Panjang')).status, 410);
    } finally {
      await db.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [BETA]);
    }
    assert.equal((await lookup(mail.token)).status, 200, 'penolakan saat ditangguhkan menghabiskan token');
    RAHASIA.push(mail.token);
  });

  test('9. token asal ditolak, bentuk rusak ditolak di tepi', async () => {
    assert.equal((await lookup(randomBytes(32).toString('base64url'))).status, 404);
    assert.equal((await accept(randomBytes(32).toString('base64url'), 'Password#Panjang')).status, 410);
    for (const t of ['', 'pendek', 'a'.repeat(44), `${'a'.repeat(42)}=`, 123]) {
      assert.equal((await http('POST', '/api/v1/invitations/lookup', { token: t })).status, 400, `token ${String(t)} lolos`);
    }
    assert.equal((await http('POST', '/api/v1/invitations', { email: 'bukan-email' }, ownerAlpha)).status, 400);
    assert.equal((await http('POST', '/api/v1/invitations/bukan-uuid/revoke', undefined, ownerAlpha)).status, 400);
  });

  test('10. audit mencatat kejadian tanpa email, token, maupun password', async () => {
    const { rows } = await db.query(
      `SELECT event_type, tenant_id, row_to_json(a)::text AS j FROM audit_logs a
       WHERE event_type IN ('invitation.created', 'invitation.accepted', 'invitation.revoked', 'identity.created', 'auth.login')
         AND occurred_at >= $1`,
      [mulai],
    );
    const jenis = new Set(rows.map((r) => r.event_type));
    for (const e of ['invitation.created', 'invitation.accepted', 'invitation.revoked', 'identity.created']) {
      assert.ok(jenis.has(e), `kejadian ${e} tidak tercatat`);
    }
    // identity.created adalah kejadian platform: tenant tidak boleh tahu.
    for (const r of rows.filter((x) => x.event_type === 'identity.created')) assert.equal(r.tenant_id, null);

    const semua = rows.map((r) => r.j).join('\n').toLowerCase();
    for (const s of RAHASIA) {
      assert.ok(!semua.includes(s.toLowerCase()), `nilai rahasia terbaca di audit log`);
    }
  });

  test('11. pembersihan tes mengembalikan daftar anggota seed, tanpa menyentuh seed', async () => {
    await cleanupInvitationArtifacts(db);
    const nama = async (token: string) =>
      (await http('GET', '/api/v1/members', undefined, token)).body.members.map((m: any) => m.display_name).sort();
    assert.deepEqual(await nama(ownerAlpha), ['Alpha Owner', 'Alpha User', 'Multi di Alpha']);
    assert.deepEqual(await nama(ownerBeta), ['Beta Admin', 'Multi di Beta']);

    // Membership juga, bukan hanya profil: membership yatim tetap memberi context login.
    const { rows: m } = await db.query(
      `SELECT tenant_id, count(*)::int AS n FROM tenant_memberships GROUP BY tenant_id ORDER BY tenant_id`);
    assert.deepEqual(m, [{ tenant_id: ALPHA, n: 3 }, { tenant_id: BETA, n: 2 }]);

    const { rows } = await db.query(`SELECT id, status FROM user_invitations`);
    assert.deepEqual(rows, [{ id: 'e1e1e1e1-0000-0000-0000-000000000001', status: 'PENDING' }]);
    // Identitas seed yang multi-tenant tetap punya dua tenant.
    assert.equal((await login('multi@demo.local')).body.contexts.length, 2);
  });
});
