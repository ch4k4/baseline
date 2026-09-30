import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { bootstrap } from '../src/main.js';
import { cleanupInvitationArtifacts } from '../scripts/test-cleanup.js';

/**
 * Tes slice 11b - dua keputusan pemilik proyek 2026-09-22:
 *
 *   D-27  POST /members/:id/reactivate (members.suspend). Aturannya cermin
 *         penangguhan: tidak untuk diri sendiri, anti-eskalasi atas hak yang
 *         DIPEGANG anggota (bukan hak efektifnya, yang kosong selama ditangguhkan),
 *         versi, dan audit. Session lama tidak hidup kembali.
 *   D-28  owners.manage: penanda owner, hanya di role tenant_owner. Anti-eskalasi
 *         yang sudah ada membuat tenant_admin tidak dapat memberi, mencabut,
 *         menangguhkan, atau mengaktifkan kembali pemegang role owner.
 *
 * Anggota yang diuji dibuat per run lewat undangan owner Alpha. Akun seed tidak diubah.
 */

const PORT = Number(process.env.TEST_PORT ?? 3207);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';
const M_OWNER_A = 'a1a1a1a1-0000-0000-0000-000000000001';
const R = {
  owner: '9a9a9a9a-0000-0000-0000-000000000001',
  admin: '9a9a9a9a-0000-0000-0000-000000000002',
  user: '9a9a9a9a-0000-0000-0000-000000000003',
  auditor: '9a9a9a9a-0000-0000-0000-000000000004',
};
const RUN = randomBytes(4).toString('hex');

let app: any;
let db: Client;
let outbox: string;
let mulai: Date;
let owner: string;
let auditor: string;

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

async function tokenFor(email: string, tenantId: string, password = PASSWORD): Promise<string> {
  const r = await http('POST', '/api/v1/auth/login', { email, password });
  assert.equal(r.status, 201, `login ${email} gagal: ${r.text}`);
  if (r.body.status === 'SESSION') return r.body.accessToken;
  const s = await http('POST', '/api/v1/auth/select-context', { ticket: r.body.ticket, tenantId });
  assert.equal(s.status, 201, s.text);
  return s.body.accessToken;
}

interface Member { token: string; membershipId: string; email: string; name: string }

/** Anggota Alpha baru lewat undangan owner, opsional dengan role undangan. */
async function newMember(label: string, roleIds?: string[]): Promise<Member> {
  const email = `t11b-${label}-${RUN}@test.demo`;
  const before = new Set(readdirSync(outbox));
  const inv = await http('POST', '/api/v1/invitations', roleIds ? { email, roleIds } : { email }, owner);
  assert.equal(inv.status, 202, inv.text);
  const file = readdirSync(outbox).find((f) => !before.has(f));
  const text = readFileSync(join(outbox, file!), 'utf8');
  const invToken = /\/invite\?token=([A-Za-z0-9_-]{43})/.exec(text)![1];
  const invitationId = /^Invitation-Id: (\S+)$/m.exec(text)![1];
  const pass = `Anggota#${RUN}x`;
  const name = `T11b ${label} ${RUN}`;
  const acc = await http('POST', '/api/v1/invitations/accept', { token: invToken, password: pass, displayName: name });
  assert.equal(acc.status, 200, acc.text);
  const { rows } = await db.query('SELECT accepted_membership_id AS m FROM user_invitations WHERE id = $1', [invitationId]);
  return { token: await tokenFor(email, ALPHA, pass), membershipId: rows[0].m, email, name };
}

const member = async (id: string, token = owner) => (await http('GET', `/api/v1/members/${id}`, undefined, token)).body;
const setRoles = async (id: string, roleIds: string[], token = owner, version?: number) =>
  http('PUT', `/api/v1/members/${id}/roles`, { roleIds, version: version ?? (await member(id)).version }, token);
async function newRole(code: string, permissions: string[], token = owner): Promise<string> {
  const c = await http('POST', '/api/v1/roles', { code: `${code}_${RUN}`, name: code }, token);
  assert.equal(c.status, 201, c.text);
  const p = await http('PUT', `/api/v1/roles/${c.body.id}/permissions`, { permissions, version: c.body.version }, token);
  assert.equal(p.status, 200, p.text);
  return c.body.id;
}
const can = async (token: string) => (await http('GET', '/api/v1/members', undefined, token)).status;

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
  await cleanupInvitationArtifacts(db);
  mulai = (await db.query('SELECT clock_timestamp() AS t')).rows[0].t;
  owner = await tokenFor('owner@alpha.demo', ALPHA);
  auditor = await tokenFor('multi@demo.local', ALPHA);
});

after(async () => {
  if (db) await cleanupInvitationArtifacts(db);
  await db?.end();
  await app?.close();
  if (outbox) rmSync(outbox, { recursive: true, force: true });
});

const suspend = async (id: string, token = owner) =>
  http('POST', `/api/v1/members/${id}/suspend`, { version: (await member(id)).version }, token);
const reactivate = async (id: string, token = owner, version?: number) =>
  http('POST', `/api/v1/members/${id}/reactivate`, { version: version ?? (await member(id)).version }, token);
const status = async (id: string) => (await member(id)).status;

describe('slice 11b - reaktivasi anggota (D-27) dan penanda owner (D-28)', () => {
  test('1. reaktivasi: kembali aktif dengan versi, session lama tetap mati, login ulang memulihkan hak', async () => {
    const n = await newMember('bangun', [R.user]);
    const lama = n.token;
    const v = (await member(n.membershipId)).version;
    assert.equal((await http('POST', `/api/v1/members/${n.membershipId}/suspend`, { version: v }, owner)).status, 200);

    assert.equal((await reactivate(n.membershipId, owner, v)).status, 409, 'versi basi diterima');
    const r = await reactivate(n.membershipId, owner, v + 1);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.status, r.body.version], ['ACTIVE', v + 2]);

    // Session yang dicabut saat penangguhan tidak dihidupkan: anggota login ulang.
    assert.equal((await http('GET', '/api/v1/me/contexts', undefined, lama)).status, 401, 'session lama hidup kembali');
    const baru = await tokenFor(n.email, ALPHA, `Anggota#${RUN}x`);
    assert.deepEqual((await http('GET', '/api/v1/me/permissions', undefined, baru)).body.permissions,
      ['menus.read', 'profile.read', 'profile.update']);

    // Hanya anggota yang ditangguhkan; anggota tenant lain tidak ada (404).
    assert.equal((await reactivate(n.membershipId)).status, 409, 'anggota aktif diaktifkan kembali');
    assert.equal((await http('POST', '/api/v1/members/e2e2e2e2-0000-0000-0000-000000000009/reactivate', { version: 1 }, owner)).status, 404);
    const { rows } = await db.query(
      `SELECT id FROM tenant_memberships WHERE tenant_id = $1 ORDER BY id LIMIT 1`, [BETA]);
    assert.equal((await http('POST', `/api/v1/members/${rows[0].id}/reactivate`, { version: 1 }, owner)).status, 404);
  });

  test('2. reaktivasi: tidak untuk diri sendiri, tanpa members.suspend, atau pemegang hak lebih tinggi', async () => {
    assert.equal((await reactivate(M_OWNER_A)).status, 403, 'owner mengaktifkan diri sendiri');

    const penangguh = await newRole('t11b_penangguh', ['members.read', 'members.suspend']);
    const kecil = await newRole('t11b_kecil', ['members.read']);
    const g = await newMember('penangguh', [penangguh]);
    const h = await newMember('tinggi', [R.auditor]);
    const k = await newMember('rendah', [kecil]);
    assert.equal((await suspend(h.membershipId)).status, 200);
    assert.equal((await suspend(k.membershipId)).status, 200);

    // Auditor memegang members.read (cukup untuk "menyentuh" K), tetapi tidak
    // members.suspend: yang menolak adalah permission route.
    assert.equal((await reactivate(k.membershipId, auditor)).status, 403);
    // G memegang members.suspend, tetapi H memegang audit.read yang tidak ia pegang.
    assert.equal((await reactivate(h.membershipId, g.token)).status, 403);
    assert.equal(await status(h.membershipId), 'SUSPENDED');
    // Kontrol: dalam jangkauan G, boleh.
    assert.equal((await reactivate(k.membershipId, g.token)).status, 200);
    assert.equal(await status(k.membershipId), 'ACTIVE');
  });

  test('3. D-28: tenant_admin tidak dapat menyentuh role owner maupun pemegangnya; owner dapat', async () => {
    const a = await newMember('admin', [R.admin]);
    const mine = (await http('GET', '/api/v1/me/permissions', undefined, a.token)).body.permissions;
    assert.ok(mine.includes('members.assign_role') && !mine.includes('owners.manage'), `hak admin: ${mine}`);

    const x = await newMember('calon');
    // Memberi role owner.
    assert.equal((await setRoles(x.membershipId, [R.owner], a.token)).status, 403, 'admin memberi role owner');
    assert.equal((await setRoles(x.membershipId, [R.owner])).status, 200);
    // Mencabut, menangguhkan, dan mengaktifkan kembali pemegang role owner.
    assert.equal((await setRoles(x.membershipId, [], a.token)).status, 403, 'admin mencabut role owner');
    assert.equal((await suspend(x.membershipId, a.token)).status, 403, 'admin menangguhkan owner');
    assert.equal((await suspend(x.membershipId)).status, 200);
    // Selama ditangguhkan hak efektif X kosong; yang dinilai adalah hak yang dipegangnya.
    assert.equal((await reactivate(x.membershipId, a.token)).status, 403, 'admin mengaktifkan kembali owner');
    assert.equal(await status(x.membershipId), 'SUSPENDED');
    assert.equal((await reactivate(x.membershipId)).status, 200);
    // Jalan memutar: undangan dengan role owner, atau role buatan yang memuat penanda.
    assert.equal((await http('POST', '/api/v1/invitations', { email: `t11b-akun2-${RUN}@test.demo`, roleIds: [R.owner] }, a.token)).status, 403);
    const c = await http('POST', '/api/v1/roles', { code: `t11b_tiru_${RUN}`, name: 'tiru' }, a.token);
    assert.equal(c.status, 201, c.text);
    assert.equal((await http('PUT', `/api/v1/roles/${c.body.id}/permissions`,
      { permissions: ['members.read', 'owners.manage'], version: c.body.version }, a.token)).status, 403, 'admin memasang owners.manage');

    // Kontrol: di luar pemegang role owner, admin tetap mengelola anggota seperti biasa.
    const y = await newMember('biasa', [R.user]);
    assert.equal((await suspend(y.membershipId, a.token)).status, 200);
    assert.equal((await reactivate(y.membershipId, a.token)).status, 200);
    assert.equal((await setRoles(y.membershipId, [R.auditor], a.token)).status, 200);
  });

  test('4. reaktivasi tercatat di audit, tanpa nama maupun email', async () => {
    const { rows } = await db.query(
      `SELECT subject_id, detail, row_to_json(a)::text AS j FROM audit_logs a
       WHERE occurred_at >= $1 AND event_type = 'member.reactivated'`, [mulai]);
    assert.equal(rows.length, 4, `reaktivasi tercatat ${rows.length} kali`);
    const semua = rows.map((r) => r.j).join('\n');
    assert.ok(!semua.includes('@test.demo') && !semua.includes('T11b '), 'data pribadi di audit');
  });
});
