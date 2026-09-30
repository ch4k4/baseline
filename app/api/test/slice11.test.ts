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
 * Tes slice 11 - administrasi anggota dan role (DEMO-0305, 0306, 0309) dan tes
 * eskalasi (DEMO-0308, bagian API; melunasi D-24).
 *
 * Aturan yang diuji (keputusan pemilik proyek 2026-09-22):
 *   - anti-eskalasi: hanya role/permission yang seluruhnya dipegang pelaku;
 *   - tidak mengubah role atau status diri sendiri;
 *   - minimal satu anggota aktif memegang members.assign_role;
 *   - penangguhan mencabut session;
 *   - role undangan yang diarsipkan sebelum diterima dilewati.
 *
 * Anggota yang diuji dibuat per run lewat undangan. Akun seed tidak pernah diubah,
 * kecuali penugasan owner Alpha yang diakhiri sementara di kasus 7 (superuser) dan
 * dipulihkan di finally.
 */

const PORT = Number(process.env.TEST_PORT ?? 3206);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';
const M_OWNER_A = 'a1a1a1a1-0000-0000-0000-000000000001';
const M_MULTI_A = 'a1a1a1a1-0000-0000-0000-000000000003';
const R = {
  owner: '9a9a9a9a-0000-0000-0000-000000000001',
  user: '9a9a9a9a-0000-0000-0000-000000000003',
  auditor: '9a9a9a9a-0000-0000-0000-000000000004',
  ownerBeta: '9b9b9b9b-0000-0000-0000-000000000001',
};
const RUN = randomBytes(4).toString('hex');

let app: any;
let db: Client;
let outbox: string;
let mulai: Date;
let owner: string;
let adminBeta: string;
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
  const email = `t11-${label}-${RUN}@test.demo`;
  const before = new Set(readdirSync(outbox));
  const inv = await http('POST', '/api/v1/invitations', roleIds ? { email, roleIds } : { email }, owner);
  assert.equal(inv.status, 202, inv.text);
  const file = readdirSync(outbox).find((f) => !before.has(f));
  const text = readFileSync(join(outbox, file!), 'utf8');
  const invToken = /\/invite\?token=([A-Za-z0-9_-]{43})/.exec(text)![1];
  const invitationId = /^Invitation-Id: (\S+)$/m.exec(text)![1];
  const pass = `Anggota#${RUN}x`;
  const name = `T11 ${label} ${RUN}`;
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
  adminBeta = await tokenFor('admin@beta.demo', BETA);
  auditor = await tokenFor('multi@demo.local', ALPHA);
});

after(async () => {
  if (db) await cleanupInvitationArtifacts(db);
  await db?.end();
  await app?.close();
  if (outbox) rmSync(outbox, { recursive: true, force: true });
});

describe('slice 11 - administrasi anggota dan role', () => {
  test('1. daftar anggota: paginasi, filter, role, dan versi', async () => {
    const all = await http('GET', '/api/v1/members', undefined, owner);
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.page, { limit: 50, offset: 0, total: 3 });
    const byName = Object.fromEntries(all.body.members.map((m: any) => [m.display_name, m]));
    assert.deepEqual(byName['Alpha Owner'].roles.map((r: any) => r.code), ['tenant_owner']);
    assert.deepEqual(byName['Multi di Alpha'].roles.map((r: any) => r.code), ['tenant_auditor']);
    assert.ok(Number.isInteger(byName['Alpha User'].version));

    const page = await http('GET', '/api/v1/members?limit=1&offset=1', undefined, owner);
    assert.equal(page.body.members.length, 1);
    assert.equal(page.body.page.total, 3);

    const byRole = await http('GET', `/api/v1/members?roleId=${R.auditor}`, undefined, owner);
    assert.deepEqual(byRole.body.members.map((m: any) => m.membership_id), [M_MULTI_A]);
    // Email persis lewat blind index tenant, dengan normalisasi yang sama.
    const byEmail = await http('GET', `/api/v1/members?email=${encodeURIComponent(' MULTI@demo.local ')}`, undefined, owner);
    assert.deepEqual(byEmail.body.members.map((m: any) => m.membership_id), [M_MULTI_A]);
    const none = await http('GET', '/api/v1/members?status=SUSPENDED', undefined, owner);
    assert.deepEqual(none.body.members, []);

    for (const q of ['status=AKTIF', 'limit=101', 'limit=0', 'offset=-1', 'roleId=bukan-uuid']) {
      assert.equal((await http('GET', `/api/v1/members?${q}`, undefined, owner)).status, 400, q);
    }
  });

  test('2. detail anggota hanya di tenant sendiri', async () => {
    const d = await member(M_MULTI_A);
    assert.equal(d.membership_id, M_MULTI_A);
    assert.ok(!JSON.stringify(d).includes('multi@demo.local'), 'email lengkap di detail');
    assert.equal((await http('GET', `/api/v1/members/${M_MULTI_A}`, undefined, adminBeta)).status, 404);
    assert.equal((await http('GET', `/api/v1/members/${RUN}-0000-0000-0000-000000000000`, undefined, owner)).status, 404);
  });

  test('3. mengubah nama tampilan dengan optimistic locking', async () => {
    const n = await newMember('profil');
    const v = (await member(n.membershipId)).version;
    const ok = await http('PATCH', `/api/v1/members/${n.membershipId}/profile`, { displayName: `Nama Baru ${RUN}`, version: v }, owner);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.display_name, `Nama Baru ${RUN}`);
    assert.equal(ok.body.version, v + 1);
    const basi = await http('PATCH', `/api/v1/members/${n.membershipId}/profile`, { displayName: 'Lagi', version: v }, owner);
    assert.equal(basi.status, 409);
    assert.equal((await http('PATCH', `/api/v1/members/${n.membershipId}/profile`, { displayName: 'x', version: v + 1 }, auditor)).status, 403);
    assert.equal((await http('PATCH', `/api/v1/members/${n.membershipId}/profile`, { displayName: 'x' }, owner)).status, 400, 'tanpa version diterima');
  });

  test('4. role: buat, ganti nama, isi permission; role sistem terkunci', async () => {
    const c = await http('POST', '/api/v1/roles', { code: `t11_viewer_${RUN}`, name: 'Viewer' }, owner);
    assert.equal(c.status, 201);
    assert.deepEqual([c.body.is_system, c.body.archived, c.body.version, c.body.permissions], [false, false, 1, []]);
    assert.equal((await http('POST', '/api/v1/roles', { code: `t11_viewer_${RUN}`, name: 'Dup' }, owner)).status, 409);
    assert.equal((await http('POST', '/api/v1/roles', { code: 'Bukan Kode', name: 'x' }, owner)).status, 400);

    const ren = await http('PATCH', `/api/v1/roles/${c.body.id}`, { name: 'Pembaca', version: 1 }, owner);
    assert.equal(ren.body.version, 2);
    assert.equal((await http('PATCH', `/api/v1/roles/${c.body.id}`, { name: 'Basi', version: 1 }, owner)).status, 409);

    const put = await http('PUT', `/api/v1/roles/${c.body.id}/permissions`, { permissions: ['members.read', 'audit.read'], version: 2 }, owner);
    assert.deepEqual(put.body.permissions, ['audit.read', 'members.read']);
    assert.equal(put.body.version, 3);
    // Permintaan setara tidak mengubah apa pun, termasuk versi (idempoten).
    const same = await http('PUT', `/api/v1/roles/${c.body.id}/permissions`, { permissions: ['audit.read', 'members.read'], version: 3 }, owner);
    assert.equal(same.status, 200);
    assert.equal(same.body.version, 3);
    for (const bad of [['platform.tenants.read'], ['members.everything']]) {
      assert.equal((await http('PUT', `/api/v1/roles/${c.body.id}/permissions`, { permissions: bad, version: 3 }, owner)).status, 400, bad[0]);
    }

    // Role sistem: 409 untuk setiap perubahan, dan isinya tetap.
    const sys = (await http('GET', `/api/v1/roles/${R.user}`, undefined, owner)).body;
    assert.equal((await http('PATCH', `/api/v1/roles/${R.user}`, { name: 'x', version: sys.version }, owner)).status, 409);
    assert.equal((await http('PUT', `/api/v1/roles/${R.user}/permissions`, { permissions: ['members.read'], version: sys.version }, owner)).status, 409);
    assert.equal((await http('DELETE', `/api/v1/roles/${R.user}?version=${sys.version}`, undefined, owner)).status, 409);
    assert.deepEqual((await http('GET', `/api/v1/roles/${R.user}`, undefined, owner)).body.permissions, sys.permissions);

    // D-26: nama role adalah label, bukan tempat data pribadi. Ditolak API dengan
    // pesan yang dapat dibaca, dan - kalau pemeriksaan itu suatu saat hilang -
    // oleh CHECK di tabel (migrasi 0017).
    for (const buruk of ['budi@contoh.co.id', 'Budi 3204012501900001', 'HRD 081234567890']) {
      const r = await http('POST', '/api/v1/roles', { code: `t11_pd_${RUN}`, name: buruk }, owner);
      assert.equal(r.status, 400, `nama role diterima: ${buruk}`);
      assert.ok(/label/i.test(r.text), `pesan tidak menjelaskan alasannya: ${r.text}`);
    }
    assert.equal(
      (await http('PATCH', `/api/v1/roles/${c.body.id}`, { name: 'kontak budi@contoh.co.id', version: 3 }, owner)).status,
      400, 'nama role diubah menjadi alamat email');
    // Kontrol: label biasa dengan angka pendek tetap diterima, dan versinya naik.
    const label = await http('PATCH', `/api/v1/roles/${c.body.id}`, { name: 'Supervisor Gudang 2 (shift 3)', version: 3 }, owner);
    assert.equal(label.status, 200, label.text);
    assert.equal(label.body.version, 4);

    const list = await http('GET', '/api/v1/roles', undefined, auditor);
    assert.ok(list.body.roles.filter((r: any) => r.is_system).length === 4);
    assert.equal((await http('GET', `/api/v1/roles/${c.body.id}`, undefined, adminBeta)).status, 404, 'role Alpha terlihat Beta');
    assert.equal((await http('POST', '/api/v1/roles', { code: `t11_x_${RUN}`, name: 'x' }, auditor)).status, 403);
  });

  test('5. memberi dan mencabut role anggota; versi melindungi perubahan bersamaan', async () => {
    const n = await newMember('role');
    const viewer = await newRole('t11_baca', ['members.read']);
    assert.equal(await can(n.token), 403);
    const set = await setRoles(n.membershipId, [viewer]);
    assert.equal(set.status, 200, set.text);
    assert.deepEqual(set.body.roles.map((r: any) => r.id), [viewer]);
    assert.equal(await can(n.token), 200);
    assert.equal((await setRoles(n.membershipId, [])).status, 200);
    assert.equal(await can(n.token), 403);

    assert.equal((await setRoles(n.membershipId, [R.ownerBeta])).status, 400, 'role Beta diterima');
    assert.equal((await setRoles(n.membershipId, [`${RUN}-0000-0000-0000-000000000000`])).status, 400);

    // Dua admin mengubah anggota yang sama dari versi yang sama: satu menang.
    const v = (await member(n.membershipId)).version;
    const [a, b] = await Promise.all([
      setRoles(n.membershipId, [viewer], owner, v),
      setRoles(n.membershipId, [R.user], owner, v),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);

    // Role yang diarsipkan tidak dapat diberikan.
    const tmp = await newRole('t11_arsip', ['members.read']);
    const t = (await http('GET', `/api/v1/roles/${tmp}`, undefined, owner)).body;
    assert.equal((await http('DELETE', `/api/v1/roles/${tmp}?version=${t.version}`, undefined, owner)).status, 200);
    assert.equal((await setRoles(n.membershipId, [tmp])).status, 400);
  });

  test('6. anti-eskalasi: tidak ada jalan memberi hak yang tidak dipegang pelaku', async () => {
    // E: boleh mengatur role dan mengundang, tetapi tidak memegang audit.read.
    const delegate = await newRole('t11_delegasi', [
      'members.read', 'members.assign_role', 'members.invite', 'roles.read', 'roles.assign_permission']);
    const e = await newMember('delegasi', [delegate]);
    const n = await newMember('sasaran');
    const small = await newRole('t11_kecil', ['members.read']);

    // Memberi role yang lebih tinggi (auditor punya audit.read): ditolak.
    assert.equal((await setRoles(n.membershipId, [R.auditor], e.token)).status, 403);
    assert.equal((await setRoles(n.membershipId, [R.owner], e.token)).status, 403);
    // Dalam jangkauan: boleh.
    assert.equal((await setRoles(n.membershipId, [small], e.token)).status, 200);
    // Menambah permission yang tidak dipegang ke role: ditolak.
    const s = (await http('GET', `/api/v1/roles/${small}`, undefined, owner)).body;
    assert.equal((await http('PUT', `/api/v1/roles/${small}/permissions`, { permissions: ['members.read', 'audit.read'], version: s.version }, e.token)).status, 403);
    // Mencabut role yang di luar jangkauan juga ditolak.
    assert.equal((await setRoles(n.membershipId, [small, R.auditor])).status, 200);
    assert.equal((await setRoles(n.membershipId, [small], e.token)).status, 403);
    // Mengundang akun kedua dengan role lebih tinggi: jalan memutar yang sama.
    assert.equal((await http('POST', '/api/v1/invitations', { email: `t11-akun2-${RUN}@test.demo`, roleIds: [R.owner] }, e.token)).status, 403);
    assert.equal((await http('POST', '/api/v1/invitations', { email: `t11-akun3-${RUN}@test.demo`, roleIds: [small] }, e.token)).status, 202);
    // Diri sendiri: role sendiri tidak dapat diubah, bahkan oleh owner.
    assert.equal((await setRoles(e.membershipId, [delegate, small], e.token)).status, 403);
    assert.equal((await setRoles(M_OWNER_A, [R.owner])).status, 403);
    // Setelah semua penolakan, hak E tetap persis yang diberikan.
    const mine = (await http('GET', '/api/v1/me/permissions', undefined, e.token)).body.permissions;
    assert.deepEqual(mine, ['members.assign_role', 'members.invite', 'members.read', 'roles.assign_permission', 'roles.read']);
  });

  test('7. tenant tidak dapat kehilangan anggota terakhir yang mengatur role', async () => {
    const keys = await newRole('t11_kunci', ['members.read', 'members.assign_role', 'roles.read', 'roles.assign_permission', 'roles.archive']);
    const e = await newMember('kunci', [keys]);
    // Semua pemegang members.assign_role lain di Alpha (owner seed, delegasi kasus 6)
    // sementara diakhiri penugasannya: E menjadi satu-satunya pemegang.
    const { rows } = await db.query(
      `UPDATE user_role_assignments SET ended_at = now()
       WHERE tenant_id = $1 AND ended_at IS NULL AND membership_id <> $2
         AND role_id IN (SELECT role_id FROM role_permissions WHERE permission_code = 'members.assign_role')
       RETURNING id, membership_id`, [ALPHA, e.membershipId]);
    assert.ok(rows.some((r) => r.membership_id === M_OWNER_A), 'penugasan owner tidak ikut diakhiri');
    try {
      const k = (await http('GET', `/api/v1/roles/${keys}`, undefined, e.token)).body;
      const lepas = await http('PUT', `/api/v1/roles/${keys}/permissions`,
        { permissions: ['members.read', 'roles.read', 'roles.assign_permission', 'roles.archive'], version: k.version }, e.token);
      assert.equal(lepas.status, 409, 'pemegang terakhir melepas members.assign_role');
      assert.equal((await http('DELETE', `/api/v1/roles/${keys}?version=${k.version}`, undefined, e.token)).status, 409);
      // Penolakan tidak meninggalkan perubahan setengah jalan.
      const after = (await http('GET', `/api/v1/roles/${keys}`, undefined, e.token)).body;
      assert.deepEqual([after.version, after.archived, after.permissions.includes('members.assign_role')], [k.version, false, true]);
    } finally {
      await db.query('UPDATE user_role_assignments SET ended_at = NULL WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id)]);
    }
    // Kontrol: dengan owner kembali, E boleh melepas hak itu dari role-nya.
    const k = (await http('GET', `/api/v1/roles/${keys}`, undefined, e.token)).body;
    assert.equal((await http('PUT', `/api/v1/roles/${keys}/permissions`,
      { permissions: ['members.read', 'roles.read', 'roles.assign_permission', 'roles.archive'], version: k.version }, e.token)).status, 200);
  });

  test('7b. dua pemegang terakhir yang melepas hak bersamaan: satu ditolak', async () => {
    // Tanpa kunci per tenant, keduanya masih melihat yang lain saat memeriksa,
    // lalu keduanya commit dan tenant tidak punya administrator lagi.
    const perms = ['members.read', 'members.assign_role', 'roles.read', 'roles.assign_permission'];
    const kx = await newRole('t11_kx', perms);
    const ky = await newRole('t11_ky', perms);
    const x = await newMember('kx', [kx]);
    const y = await newMember('ky', [ky]);
    const { rows } = await db.query(
      `UPDATE user_role_assignments SET ended_at = now()
       WHERE tenant_id = $1 AND ended_at IS NULL AND membership_id NOT IN ($2, $3)
         AND role_id IN (SELECT role_id FROM role_permissions WHERE permission_code = 'members.assign_role')
       RETURNING id`, [ALPHA, x.membershipId, y.membershipId]);
    try {
      const lepas = perms.filter((p) => p !== 'members.assign_role');
      for (let putaran = 0; putaran < 5; putaran++) {
        // Dibaca oleh X/Y sendiri: owner sedang tidak memegang role apa pun.
        const [vx, vy] = [(await http('GET', `/api/v1/roles/${kx}`, undefined, x.token)).body.version,
                          (await http('GET', `/api/v1/roles/${ky}`, undefined, y.token)).body.version];
        const [a, b] = await Promise.all([
          http('PUT', `/api/v1/roles/${kx}/permissions`, { permissions: lepas, version: vx }, x.token),
          http('PUT', `/api/v1/roles/${ky}/permissions`, { permissions: lepas, version: vy }, y.token),
        ]);
        assert.deepEqual([a.status, b.status].sort(), [200, 409], `putaran ${putaran}: ${a.status}/${b.status}`);
        const { rows: h } = await db.query(
          `SELECT count(DISTINCT a.membership_id)::int AS n FROM user_role_assignments a
           JOIN role_permissions rp ON rp.role_id = a.role_id AND rp.permission_code = 'members.assign_role'
           JOIN tenant_memberships m ON m.id = a.membership_id AND m.status = 'ACTIVE'
           WHERE a.tenant_id = $1 AND a.ended_at IS NULL`, [ALPHA]);
        assert.equal(h[0].n, 1);
        // Pulihkan hak yang dilepas untuk putaran berikutnya.
        for (const r of [kx, ky]) {
          await db.query(
            `INSERT INTO role_permissions (tenant_id, role_id, permission_code) VALUES ($1, $2, 'members.assign_role')
             ON CONFLICT DO NOTHING`, [ALPHA, r]);
        }
      }
    } finally {
      await db.query('UPDATE user_role_assignments SET ended_at = NULL WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id)]);
    }
  });

  test('8. menangguhkan anggota mencabut session-nya; tidak untuk diri sendiri atau yang lebih tinggi', async () => {
    const n = await newMember('tidur', [R.user]);
    assert.equal((await http('GET', '/api/v1/me/contexts', undefined, n.token)).status, 200);
    const v = (await member(n.membershipId)).version;
    const s = await http('POST', `/api/v1/members/${n.membershipId}/suspend`, { version: v }, owner);
    assert.equal(s.status, 200, s.text);
    assert.equal(s.body.status, 'SUSPENDED');
    assert.equal(s.body.version, v + 1);
    assert.equal((await http('GET', '/api/v1/me/contexts', undefined, n.token)).status, 401, 'session anggota yang ditangguhkan masih hidup');
    assert.equal((await http('POST', `/api/v1/members/${n.membershipId}/suspend`, { version: v + 1 }, owner)).status, 409);
    const list = await http('GET', '/api/v1/members?status=SUSPENDED', undefined, owner);
    assert.deepEqual(list.body.members.map((m: any) => m.membership_id), [n.membershipId]);

    const ov = (await member(M_OWNER_A)).version;
    assert.equal((await http('POST', `/api/v1/members/${M_OWNER_A}/suspend`, { version: ov }, owner)).status, 403, 'owner menangguhkan diri sendiri');

    // G boleh menangguhkan, tetapi bukan anggota yang memegang hak di luar jangkauannya.
    const suspender = await newRole('t11_penangguh', ['members.read', 'members.suspend']);
    const g = await newMember('penangguh', [suspender]);
    const h = await newMember('tinggi', [R.auditor]);
    assert.equal((await http('POST', `/api/v1/members/${h.membershipId}/suspend`, { version: (await member(h.membershipId)).version }, g.token)).status, 403);
    assert.equal((await http('POST', `/api/v1/members/${h.membershipId}/suspend`, { version: 1 }, auditor)).status, 403);
  });

  test('9. role dari undangan: diberikan saat diterima, yang diarsipkan dilewati', async () => {
    const viewer = await newRole('t11_undang', ['members.read']);
    const n = await newMember('diundang', [viewer]);
    assert.equal(await can(n.token), 200, 'role undangan tidak diberikan');

    // Undang ulang MENGGANTI role undangan: undangan kedua tanpa role -> tanpa akses.
    const ulangEmail = `t11-ulang-${RUN}@test.demo`;
    assert.equal((await http('POST', '/api/v1/invitations', { email: ulangEmail, roleIds: [viewer] }, owner)).status, 202);
    const sebelum = new Set(readdirSync(outbox));
    assert.equal((await http('POST', '/api/v1/invitations', { email: ulangEmail, roleIds: [] }, owner)).status, 202);
    const ulang = readFileSync(join(outbox, readdirSync(outbox).find((f) => !sebelum.has(f))!), 'utf8');
    assert.equal((await http('POST', '/api/v1/invitations/accept',
      { token: /\/invite\?token=([A-Za-z0-9_-]{43})/.exec(ulang)![1], password: `Ulang#${RUN}x`, displayName: 'Ulang' })).status, 200);
    assert.equal(await can(await tokenFor(ulangEmail, ALPHA, `Ulang#${RUN}x`)), 403, 'role undangan lama ikut terbawa');

    const tmp = await newRole('t11_sementara', ['members.read']);
    assert.equal((await http('POST', '/api/v1/invitations', { email: `t11-x-${RUN}@test.demo`, roleIds: [`${RUN}-0000-0000-0000-000000000000`] }, owner)).status, 400);

    // Diarsipkan setelah undangan dibuat, sebelum diterima.
    const email = `t11-arsip-${RUN}@test.demo`;
    const before = new Set(readdirSync(outbox));
    assert.equal((await http('POST', '/api/v1/invitations', { email, roleIds: [tmp] }, owner)).status, 202);
    const file = readdirSync(outbox).find((f) => !before.has(f))!;
    const text = readFileSync(join(outbox, file), 'utf8');
    const t = (await http('GET', `/api/v1/roles/${tmp}`, undefined, owner)).body;
    assert.equal((await http('DELETE', `/api/v1/roles/${tmp}?version=${t.version}`, undefined, owner)).status, 200);
    const acc = await http('POST', '/api/v1/invitations/accept',
      { token: /\/invite\?token=([A-Za-z0-9_-]{43})/.exec(text)![1], password: `Arsip#${RUN}x`, displayName: 'Arsip' });
    assert.equal(acc.status, 200, 'penerimaan gagal karena role diarsipkan');
    const tok = await tokenFor(email, ALPHA, `Arsip#${RUN}x`);
    assert.equal(await can(tok), 403, 'role yang diarsipkan tetap diberikan');

    const { rows } = await db.query(
      `SELECT detail FROM audit_logs WHERE event_type = 'invitation.accepted' AND occurred_at >= $1
       AND subject_id = $2::uuid`, [mulai, /^Invitation-Id: (\S+)$/m.exec(text)![1]]);
    assert.equal(rows[0]?.detail.rolesSkipped, 1);
  });

  test('10. setiap perubahan tercatat di audit, tanpa nama maupun email', async () => {
    const { rows } = await db.query(
      `SELECT event_type, detail, row_to_json(a)::text AS j FROM audit_logs a
       WHERE occurred_at >= $1 AND event_type IN
         ('role.created', 'role.updated', 'role.archived', 'role.permissions_replaced',
          'member.roles_replaced', 'member.suspended', 'member.profile_updated')`, [mulai]);
    const jenis = new Set(rows.map((r) => r.event_type));
    for (const e of ['role.created', 'role.updated', 'role.archived', 'role.permissions_replaced',
                     'member.roles_replaced', 'member.suspended', 'member.profile_updated']) {
      assert.ok(jenis.has(e), `kejadian ${e} tidak tercatat`);
    }
    const suspend = rows.find((r) => r.event_type === 'member.suspended');
    assert.equal(suspend.detail.sessionsRevoked, 1);
    const semua = rows.map((r) => r.j).join('\n');
    assert.ok(!semua.includes('@test.demo'), 'email di audit');
    assert.ok(!semua.includes(`Nama Baru ${RUN}`) && !semua.includes(`T11 `), 'nama tampilan di audit');
  });
});
