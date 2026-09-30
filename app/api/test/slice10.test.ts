import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { ForbiddenException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { bootstrap } from '../src/main.js';
import { ACCESS_KEY, Access } from '../src/authz/access.decorator.js';
import { AccessGuard } from '../src/authz/access.guard.js';
import { cleanupInvitationArtifacts } from '../scripts/test-cleanup.js';

/**
 * Tes slice 10 - RBAC ditegakkan di endpoint (DEMO-0301 s.d. 0304, D-21).
 *
 * Anggota yang diuji dibuat baru per run lewat undangan, lalu role-nya diatur
 * lewat superuser (API administrasi role baru ada di slice 11). Akun seed tidak
 * pernah diberi atau dicabut role di sini: tes lain bergantung pada hak mereka.
 * Tidak memakai user@alpha.demo: tes slice 6 menguncinya selama 5 menit.
 */

const PORT = Number(process.env.TEST_PORT ?? 3205);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';
const ROLE_ALPHA = {
  tenant_user: '9a9a9a9a-0000-0000-0000-000000000003',
  tenant_auditor: '9a9a9a9a-0000-0000-0000-000000000004',
};
const AUDITOR = ['audit.read', 'members.read', 'menus.read', 'permissions.read', 'profile.read', 'roles.read'];
const ADMIN = [
  'audit.read', 'members.assign_role', 'members.invite', 'members.read', 'members.suspend',
  'members.update_profile', 'menus.read', 'permissions.read', 'profile.read', 'profile.update',
  'roles.archive', 'roles.assign_permission', 'roles.create', 'roles.read', 'roles.update',
];

const RUN = randomBytes(4).toString('hex');

let app: any;
let db: Client;
let outbox: string;
let mulai: Date;
let tenantCatalog: string[];

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

/** Anggota Alpha baru lewat undangan: tanpa role apa pun (default-deny). */
async function newAlphaMember(label: string): Promise<{ token: string; membershipId: string; email: string }> {
  const owner = await tokenFor('owner@alpha.demo', ALPHA);
  const email = `t10-${label}-${RUN}@test.demo`;
  const before = new Set(readdirSync(outbox));
  assert.equal((await http('POST', '/api/v1/invitations', { email }, owner)).status, 202);
  const file = readdirSync(outbox).find((f) => !before.has(f));
  assert.ok(file, 'undangan tidak sampai ke outbox');
  const text = readFileSync(join(outbox, file), 'utf8');
  const invToken = /\/invite\?token=([A-Za-z0-9_-]{43})/.exec(text)![1];
  const invitationId = /^Invitation-Id: (\S+)$/m.exec(text)![1];
  const pass = `Anggota#${RUN}x`;
  assert.equal((await http('POST', '/api/v1/invitations/accept', { token: invToken, password: pass, displayName: label })).status, 200);
  const { rows } = await db.query('SELECT accepted_membership_id AS m FROM user_invitations WHERE id = $1', [invitationId]);
  return { token: await tokenFor(email, ALPHA, pass), membershipId: rows[0].m, email };
}

const assign = async (membershipId: string, roleId: string) =>
  (await db.query(
    `INSERT INTO user_role_assignments (tenant_id, membership_id, role_id) VALUES ($1, $2, $3) RETURNING id`,
    [ALPHA, membershipId, roleId])).rows[0].id as string;
const endAssignment = (id: string) =>
  db.query('UPDATE user_role_assignments SET ended_at = now() WHERE id = $1', [id]);
const mine = async (token: string) => (await http('GET', '/api/v1/me/permissions', undefined, token)).body.permissions as string[];

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
  tenantCatalog = (await db.query(`SELECT code FROM permissions WHERE scope = 'TENANT' ORDER BY code`)).rows.map((r) => r.code);
});

after(async () => {
  if (db) await cleanupInvitationArtifacts(db);
  await db?.end();
  await app?.close();
  if (outbox) rmSync(outbox, { recursive: true, force: true });
});

describe('slice 10 - RBAC di endpoint', () => {
  test('1. permission efektif akun seed mengikuti role-nya, tanpa permission platform', async () => {
    assert.deepEqual(await mine(await tokenFor('owner@alpha.demo', ALPHA)), tenantCatalog, 'owner tidak memegang seluruh katalog tenant');
    assert.deepEqual(await mine(await tokenFor('admin@beta.demo', BETA)), ADMIN);
    assert.deepEqual(await mine(await tokenFor('multi@demo.local', ALPHA)), AUDITOR);
    assert.deepEqual(await mine(await tokenFor('multi@demo.local', BETA)), AUDITOR);
    assert.equal(tenantCatalog.length, 16);
    assert.ok(tenantCatalog.includes('owners.manage') && !ADMIN.includes('owners.manage'), 'penanda owner (D-28)');
  });

  test('2. anggota baru dari undangan tidak punya akses apa pun (default-deny)', async () => {
    const m = await newAlphaMember('baru');
    assert.deepEqual(await mine(m.token), []);
    assert.equal((await http('GET', '/api/v1/members', undefined, m.token)).status, 403);
    assert.equal((await http('GET', '/api/v1/invitations', undefined, m.token)).status, 403);
    assert.equal((await http('POST', '/api/v1/invitations', { email: `x-${RUN}@test.demo` }, m.token)).status, 403);
    assert.equal((await http('GET', '/api/v1/permissions', undefined, m.token)).status, 403);
    // Route identitas tetap terbuka: 403 di atas karena permission, bukan session rusak.
    assert.equal((await http('GET', '/api/v1/me/contexts', undefined, m.token)).status, 200);
  });

  test('3. penolakan tercatat di audit tanpa membocorkan apa pun ke pemanggil', async () => {
    const m = await newAlphaMember('audit');
    const res = await http('GET', '/api/v1/members', undefined, m.token);
    assert.equal(res.status, 403);
    // Respons tidak menyebut permission yang kurang: itu peta hak akses.
    assert.ok(!res.text.includes('members.read'), 'respons 403 menyebut nama permission');

    const { rows } = await db.query(
      `SELECT tenant_id, detail, row_to_json(a)::text AS j FROM audit_logs a
       WHERE event_type = 'authz.denied' AND occurred_at >= $1
         AND actor_user_id = (SELECT user_id FROM tenant_memberships WHERE id = $2)`,
      [mulai, m.membershipId]);
    assert.equal(rows.length, 1, `penolakan tercatat ${rows.length} kali`);
    assert.equal(rows[0].tenant_id, ALPHA);
    // `reason` ikut sejak slice 14: penolakan sesi support atas route yang
    // mengubah keadaan harus dapat dibedakan dari permission yang kurang saat
    // ditelusuri. Isinya tetap diperiksa PERSIS - bukan dilonggarkan menjadi
    // "mengandung" - supaya kolom baru tidak menjadi tempat data pribadi masuk
    // tanpa ada yang memeriksanya.
    assert.deepEqual(rows[0].detail, {
      permission: 'members.read',
      method: 'GET',
      route: '/api/v1/members',
      reason: 'MISSING_PERMISSION',
    });
    assert.ok(!rows[0].j.toLowerCase().includes(m.email), 'email pelaku masuk audit');

    // Yang dicatat POLA route, bukan URL: id di URL tidak ikut ke audit.
    const id = 'e1e1e1e1-0000-0000-0000-000000000001';
    assert.equal((await http('POST', `/api/v1/invitations/${id}/revoke`, undefined, m.token)).status, 403);
    const { rows: r2 } = await db.query(
      `SELECT detail, row_to_json(a)::text AS j FROM audit_logs a
       WHERE event_type = 'authz.denied' AND occurred_at >= $1 AND detail->>'permission' = 'members.invite'
         AND actor_user_id = (SELECT user_id FROM tenant_memberships WHERE id = $2)`,
      [mulai, m.membershipId]);
    assert.equal(r2.length, 1);
    assert.equal(r2[0].detail.route, '/api/v1/invitations/:id/revoke');
    assert.ok(!r2[0].j.includes(id), 'id dari URL masuk audit');
  });

  test('4. memberi dan mencabut role berlaku pada permintaan berikutnya', async () => {
    const m = await newAlphaMember('role');
    const members = () => http('GET', '/api/v1/members', undefined, m.token);

    // tenant_user tidak membawa members.read (Demo Foundation sec.6).
    await assign(m.membershipId, ROLE_ALPHA.tenant_user);
    assert.equal((await members()).status, 403);

    const asg = await assign(m.membershipId, ROLE_ALPHA.tenant_auditor);
    const ok = await members();
    assert.equal(ok.status, 200);
    assert.equal(ok.body.canInvite, false, 'auditor diberi petunjuk boleh mengundang');
    assert.equal((await http('POST', '/api/v1/invitations', { email: `y-${RUN}@test.demo` }, m.token)).status, 403);

    await endAssignment(asg);
    assert.equal((await members()).status, 403, 'role yang dicabut masih berlaku (cache?)');
  });

  test('5. role yang diarsipkan kehilangan aksesnya', async () => {
    const m = await newAlphaMember('arsip');
    const { rows } = await db.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, 'Viewer tes') RETURNING id`,
      [ALPHA, `t10_viewer_${RUN}`]);
    const roleId = rows[0].id;
    await db.query(`INSERT INTO role_permissions (tenant_id, role_id, permission_code) VALUES ($1, $2, 'members.read')`, [ALPHA, roleId]);
    await assign(m.membershipId, roleId);
    assert.equal((await http('GET', '/api/v1/members', undefined, m.token)).status, 200);

    await db.query('UPDATE roles SET archived_at = now() WHERE id = $1', [roleId]);
    assert.equal((await http('GET', '/api/v1/members', undefined, m.token)).status, 403);
  });

  test('6. anggota yang ditangguhkan kehilangan akses walau session-nya masih hidup', async () => {
    const m = await newAlphaMember('tidur');
    await assign(m.membershipId, ROLE_ALPHA.tenant_auditor);
    assert.equal((await http('GET', '/api/v1/members', undefined, m.token)).status, 200);
    await db.query(`UPDATE tenant_memberships SET status = 'SUSPENDED' WHERE id = $1`, [m.membershipId]);
    assert.equal((await http('GET', '/api/v1/members', undefined, m.token)).status, 403);
    assert.deepEqual(await mine(m.token), []);
  });

  test('7. hak mengundang datang dari permission, bukan status owner (D-21)', async () => {
    const admin = await tokenFor('admin@beta.demo', BETA);
    const list = await http('GET', '/api/v1/members', undefined, admin);
    assert.equal(list.body.canInvite, true);
    const res = await http('POST', '/api/v1/invitations', { email: `t10-beta-${RUN}@test.demo` }, admin);
    assert.equal(res.status, 202);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'tenant_memberships' AND column_name = 'is_owner'`);
    assert.equal(rows[0].n, 0, 'penanda is_owner masih ada');
  });

  test('8. katalog permission untuk tenant hanya memuat permission tenant', async () => {
    const auditor = await tokenFor('multi@demo.local', ALPHA);
    const res = await http('GET', '/api/v1/permissions', undefined, auditor);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.permissions.map((p: any) => p.code), tenantCatalog);
    for (const p of res.body.permissions) {
      assert.deepEqual(Object.keys(p).sort(), ['code', 'description']);
      assert.ok(p.description.length > 0);
    }
    assert.ok(!res.text.includes('platform.'), 'permission platform terlihat oleh tenant');
  });

  test('9. setiap route mendeklarasikan aksesnya, dan setiap permission ada di katalog', async () => {
    // Kontainer Nest yang sama dengan yang melayani permintaan: controller yang
    // terdaftar di modul mana pun ikut terperiksa, termasuk yang ditambah nanti.
    const controllers = [...app.container.getModules().values()].flatMap((m: any) => [...m.controllers.values()]);
    const reflector = new Reflector();
    const routes: string[] = [];
    const tanpaDeklarasi: string[] = [];
    const permissionAsing: string[] = [];

    for (const wrapper of controllers) {
      const cls = wrapper.metatype;
      if (!cls) continue;
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        const handler = cls.prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const id = `${cls.name}.${name} (${Reflect.getMetadata(PATH_METADATA, cls)}/${Reflect.getMetadata(PATH_METADATA, handler)})`;
        routes.push(id);
        const access = reflector.getAllAndOverride<Access | undefined>(ACCESS_KEY, [handler, cls]);
        if (!access) tanpaDeklarasi.push(id);
        else if (access.kind === 'permission' && !tenantCatalog.includes(access.permission)) {
          permissionAsing.push(`${id}: ${access.permission}`);
        }
      }
    }
    // Pemindaian yang tidak menemukan route apa pun lulus tanpa arti.
    assert.ok(routes.length >= 14, `hanya ${routes.length} route terbaca`);
    assert.deepEqual(tanpaDeklarasi, [], 'route tanpa deklarasi akses');
    assert.deepEqual(permissionAsing, [], 'permission yang tidak ada di katalog (selalu ditolak)');
  });

  test('10. guard menolak route tanpa deklarasi dan session non-tenant', async () => {
    let sessionDipanggil = false;
    const guard = new AccessGuard(
      new Reflector(),
      { canActivate: async () => { sessionDipanggil = true; return true; } } as any,
      { effective: async () => new Set(['members.read']) } as any,
      { record: async () => undefined } as any,
    );
    const ctx = (handler: Function, req: any) => ({
      getHandler: () => handler,
      getClass: () => class Tanpa {},
      switchToHttp: () => ({ getRequest: () => req }),
    }) as any;

    // Route yang lupa diberi dekorator: ditolak sebelum session diperiksa.
    await assert.rejects(() => guard.canActivate(ctx(function lupa() {}, {})), ForbiddenException);
    assert.equal(sessionDipanggil, false);

    // Permission benar, tetapi session PLATFORM: tetap ditolak.
    function baca() {}
    Reflect.defineMetadata(ACCESS_KEY, { kind: 'permission', permission: 'members.read' }, baca);
    const platform = { session: { context_kind: 'PLATFORM', tenant_id: null, membership_id: null } };
    await assert.rejects(() => guard.canActivate(ctx(baca, platform)), ForbiddenException);

    // Kontrol: session TENANT dengan permission yang sama lolos.
    const tenant = { session: { context_kind: 'TENANT', tenant_id: ALPHA, membership_id: 'm', user_id: 'u', session_id: 's' } };
    assert.equal(await guard.canActivate(ctx(baca, tenant)), true);
  });
});
