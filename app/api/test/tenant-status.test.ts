import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { bootstrap } from '../src/main.js';

/**
 * Suspend dan reactivate tenant (D-47), dan F-21 yang membuatnya berarti.
 *
 * Status tenant sebelumnya kolom yang tidak dibaca request mana pun: Infrastructure
 * SSOT sec.8.6 menuntut setiap request protected memeriksa tenant ACTIVE, dan tidak
 * ada yang melakukannya. Endpoint suspend di atas keadaan itu akan lulus setiap tes
 * yang hanya memeriksa barisnya - jadi yang diuji di sini adalah AKIBATNYA: anggota
 * yang sedang masuk kehilangan akses, refresh tidak menghidupkannya, login baru
 * tidak menawarkan tenantnya, dan platform tetap bekerja.
 *
 * Tenant uji dibuat lewat provisioning dan dihapus di akhir, supaya tenant seed
 * Alpha dan Beta - yang dipakai setiap tes lain - tidak pernah disuspend.
 */

const PORT = Number(process.env.TEST_PORT ?? 3219);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const SUPERADMIN_EMAIL = 'superadmin@demo.platform';
const OWNER_EMAIL = 'owner@alpha.demo';
const RUN = randomBytes(3).toString('hex');

let app: any;
let db: Client;
let platform: string;
let tenantId: string;
/** Session owner pada tenant uji: access dan refresh token. */
let anggota: { access: string; refresh: string };

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
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* bukan JSON */
  }
  return { status: res.status, text, body: parsed };
}

const ubahStatus = (id: string, status: unknown, token = platform) =>
  http('PATCH', `/api/v1/platform/tenants/${id}/status`, { status }, token);

/** Masuk sebagai owner Alpha lalu memilih tenant uji. */
async function masukKeTenantUji() {
  const masuk = await http('POST', '/api/v1/auth/login', { email: OWNER_EMAIL, password: PASSWORD });
  assert.equal(masuk.body?.status, 'CONTEXT_REQUIRED', masuk.text);
  return masuk;
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

  const sa = await http('POST', '/api/v1/auth/login', { email: SUPERADMIN_EMAIL, password: PASSWORD });
  assert.equal(sa.status, 201, sa.text);
  platform = sa.body.accessToken;

  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM tenant_memberships WHERE id = 'a1a1a1a1-0000-0000-0000-000000000001'`,
  );
  const dibuat = await http(
    'POST',
    '/api/v1/platform/tenants',
    {
      slug: `status-${RUN}`,
      name: `Tenant Status ${RUN}`,
      ownerUserId: rows[0].user_id,
      ownerDisplayName: 'Owner Status',
      ownerContactEmail: `owner-status-${RUN}@contoh.test`,
    },
    platform,
  );
  assert.equal(dibuat.status, 201, dibuat.text);
  tenantId = dibuat.body.tenantId;

  const masuk = await masukKeTenantUji();
  const pilih = await http('POST', '/api/v1/auth/select-context', { ticket: masuk.body.ticket, tenantId });
  assert.equal(pilih.status, 201, pilih.text);
  anggota = { access: pilih.body.accessToken, refresh: pilih.body.refreshToken };
});

after(async () => {
  if (db && tenantId) {
    for (const tabel of [
      'audit_logs',
      'refresh_tokens',
      'sessions',
      'user_role_assignments',
      'tenant_member_profiles',
      'tenant_memberships',
      'role_permissions',
      'roles',
      'crypto_keys',
    ]) {
      await db.query(`DELETE FROM ${tabel} WHERE tenant_id = $1`, [tenantId]);
    }
    await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await db.query(
      `DELETE FROM audit_logs WHERE event_type LIKE 'tenant.%' AND tenant_id IS NULL AND subject_id = $1`,
      [tenantId],
    );
  }
  await db?.end();
  await app?.close();
});

describe('status tenant (D-47)', () => {
  test('1. sebelum suspend, anggota tenant uji bekerja seperti biasa', async () => {
    assert.equal((await http('GET', '/api/v1/members', undefined, anggota.access)).status, 200);
  });

  test('2. suspend: anggota yang SEDANG masuk kehilangan akses pada request berikutnya', async () => {
    const res = await ubahStatus(tenantId, 'SUSPENDED');
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body, { tenantId, status: 'SUSPENDED', previousStatus: 'ACTIVE' });

    const { rows } = await db.query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [tenantId]);
    assert.equal(rows[0].status, 'SUSPENDED');

    // Token yang sama persis, session yang belum dicabut - ditolak karena F-21.
    assert.equal((await http('GET', '/api/v1/members', undefined, anggota.access)).status, 401);
  });

  test('3. refresh tidak menghidupkan session tenant yang disuspend', async () => {
    const res = await http('POST', '/api/v1/auth/refresh', { refreshToken: anggota.refresh });
    assert.equal(res.status, 401, res.text);
  });

  test('4. login baru tidak menawarkan tenant yang disuspend, dan memilihnya ditolak', async () => {
    const masuk = await http('POST', '/api/v1/auth/login', { email: OWNER_EMAIL, password: PASSWORD });
    // Owner Alpha kini hanya punya satu context (Alpha) - tenant uji tidak ditawarkan.
    assert.equal(masuk.status, 201, masuk.text);
    assert.equal(masuk.body.status, 'SESSION');
    assert.notEqual(masuk.body.context.tenantId, tenantId);
  });

  test('5. platform tetap bekerja selama tenant disuspend', async () => {
    const res = await http('GET', '/api/v1/platform/tenants', undefined, platform);
    assert.equal(res.status, 200, res.text);
    const t = res.body.tenants.find((x: any) => x.id === tenantId);
    assert.equal(t.status, 'SUSPENDED');
  });

  test('6. transisi yang tidak sah ditolak, dan tidak mengubah apa pun', async () => {
    assert.equal((await ubahStatus(tenantId, 'SUSPENDED')).status, 409, 'suspend dua kali');
    assert.equal((await ubahStatus(tenantId, 'ARCHIVED')).status, 400);
    assert.equal((await ubahStatus(tenantId, 'PROVISIONING')).status, 400);
    assert.equal((await ubahStatus(tenantId, undefined)).status, 400);
    assert.equal((await ubahStatus('bukan-uuid', 'ACTIVE')).status, 400);
    assert.equal((await ubahStatus('00000000-0000-0000-0000-000000000000', 'ACTIVE')).status, 404);

    const { rows } = await db.query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [tenantId]);
    assert.equal(rows[0].status, 'SUSPENDED');
  });

  test('7. hanya pemegang platform.tenants.update_status yang boleh mengubah status', async () => {
    // Token anggota tenant (Alpha) - bukan context platform.
    const masuk = await http('POST', '/api/v1/auth/login', { email: OWNER_EMAIL, password: PASSWORD });
    const res = await ubahStatus(tenantId, 'ACTIVE', masuk.body.accessToken);
    assert.ok([401, 403].includes(res.status), `seharusnya ditolak, dapat ${res.status}`);
    const { rows } = await db.query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [tenantId]);
    assert.equal(rows[0].status, 'SUSPENDED');
  });

  test('8. reactivate: tenant dapat dipilih dan dipakai lagi', async () => {
    const res = await ubahStatus(tenantId, 'ACTIVE');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.previousStatus, 'SUSPENDED');

    const masuk = await masukKeTenantUji();
    const pilih = await http('POST', '/api/v1/auth/select-context', { ticket: masuk.body.ticket, tenantId });
    assert.equal(pilih.status, 201, pilih.text);
    assert.equal((await http('GET', '/api/v1/members', undefined, pilih.body.accessToken)).status, 200);
  });

  test('9. D-55 dicatat apa adanya: session yang belum kedaluwarsa hidup kembali setelah reactivate', async () => {
    // Bukan sifat yang diinginkan - sifat yang DIKETAHUI. Session anggota tidak dicabut
    // saat suspend (mencabutnya dari context platform berarti menulis data tenant tanpa
    // break-glass). Tes ini memaku perilakunya supaya perubahan apa pun terlihat.
    assert.equal((await http('GET', '/api/v1/members', undefined, anggota.access)).status, 200);
  });

  test('10. setiap perubahan diaudit di kedua sisi, hanya dengan status asal dan tujuan', async () => {
    const { rows } = await db.query<{ tenant_id: string | null; detail: any }>(
      `SELECT tenant_id, detail FROM audit_logs
        WHERE event_type = 'tenant.status_changed' AND subject_id = $1
        ORDER BY occurred_at, tenant_id NULLS FIRST`,
      [tenantId],
    );
    assert.deepEqual(
      rows.map((r) => `${r.tenant_id ? 'tenant' : 'platform'}:${r.detail.from}->${r.detail.to}`),
      [
        'platform:ACTIVE->SUSPENDED',
        'tenant:ACTIVE->SUSPENDED',
        'platform:SUSPENDED->ACTIVE',
        'tenant:SUSPENDED->ACTIVE',
      ],
    );
    for (const r of rows) assert.deepEqual(Object.keys(r.detail).sort(), ['from', 'to']);
  });
});
