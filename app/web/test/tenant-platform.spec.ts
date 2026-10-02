import { test, expect, Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * Registry tenant di konsol platform (D-56): daftar tenant, suspend, dan aktifkan
 * kembali - lewat layar, bukan API.
 *
 * Tenant yang disuspend di sini adalah tenant UJI yang dibuat per run lewat
 * provisioning, tidak pernah Alpha atau Beta: keduanya dipakai setiap tes lain, dan
 * tenant seed yang tertinggal SUSPENDED merusak seluruh suite sesudahnya.
 *
 * Akibat suspend (session ditolak, refresh, login) sudah dijaga tes API
 * tenant-status.test.ts; di sini hanya satu pemeriksaan akibat - login owner tidak
 * lagi ditawari tenant itu - supaya "Disuspend" di layar terbukti bukan sekadar teks.
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const API = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const API_DIR = path.resolve(__dirname, '..', '..', 'api');
const require_ = createRequire(__filename);
const SUPERADMIN_EMAIL = 'superadmin@demo.platform';
const OWNER_EMAIL = 'owner@alpha.demo';
const RUN = randomBytes(3).toString('hex');
const SLUG = `layar-${RUN}`;

let tenantId = '';

async function db<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { Client } = require_(path.join(API_DIR, 'node_modules', 'pg')) as {
    Client: new (c: Record<string, unknown>) => {
      connect(): Promise<void>;
      query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
      end(): Promise<void>;
    };
  };
  const c = new Client({
    host: process.env.DEMO_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DEMO_DB_PORT ?? 5432),
    database: process.env.DEMO_DB_NAME ?? 'saas_demo',
    user: process.env.DEMO_DB_SUPER ?? 'postgres',
    password: process.env.DEMO_DB_SUPER_PASSWORD,
  });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

async function api(method: string, p: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const teks = await res.text();
  let isi: any = null;
  try {
    isi = teks ? JSON.parse(teks) : null;
  } catch {
    isi = null;
  }
  return { status: res.status, teks, body: isi };
}

async function isiLogin(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
}

/** Superadmin di halaman registry tenant. */
async function bukaRegistry(page: Page) {
  await isiLogin(page, SUPERADMIN_EMAIL);
  await expect(page.getByTestId('context-platform')).toBeVisible();
  await page.getByTestId('nav-platform-tenants').click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.beforeAll(async () => {
  if (!process.env.DEMO_DB_SUPER_PASSWORD) {
    throw new Error('Set DEMO_DB_SUPER_PASSWORD: tes registry tenant membuat dan menghapus tenant uji.');
  }
  const sa = await api('POST', '/api/v1/auth/login', { email: SUPERADMIN_EMAIL, password: PASSWORD });
  if (sa.status !== 201) throw new Error(`login superadmin gagal: ${sa.teks}`);
  const [owner] = await db<{ user_id: string }>(
    `SELECT user_id FROM tenant_memberships WHERE id = 'a1a1a1a1-0000-0000-0000-000000000001'`,
  );
  const dibuat = await api(
    'POST',
    '/api/v1/platform/tenants',
    {
      slug: SLUG,
      name: `Tenant Layar ${RUN}`,
      ownerUserId: owner.user_id,
      ownerDisplayName: 'Owner Layar',
      ownerContactEmail: `owner-layar-${RUN}@contoh.test`,
    },
    sa.body.accessToken,
  );
  if (dibuat.status !== 201) throw new Error(`provisioning gagal: ${dibuat.teks}`);
  tenantId = dibuat.body.tenantId;
});

test.afterAll(async () => {
  if (!tenantId) return;
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
    await db(`DELETE FROM ${tabel} WHERE tenant_id = $1`, [tenantId]);
  }
  await db('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await db(`DELETE FROM audit_logs WHERE tenant_id IS NULL AND subject_id = $1`, [tenantId]);
});

test.describe.configure({ mode: 'serial' });

test.describe('registry tenant (D-56)', () => {
  test('1. menu Tenant ada di konsol platform, dan registry memuat tenant seed serta tenant uji', async ({ page }) => {
    await bukaRegistry(page);
    await expect(page.getByTestId('nav-platform-tenants')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('status-alpha')).toHaveText('Aktif');
    await expect(page.getByTestId('status-beta')).toHaveText('Aktif');
    await expect(page.getByTestId(`status-${SLUG}`)).toHaveText('Aktif');
    // Registry hanya data control-plane: tidak ada email siapa pun.
    expect(await page.getByTestId('tenants-table').innerText()).not.toContain('@');
  });

  test('2. suspend lewat layar: konfirmasi menyebut batasnya, lalu status berubah dan berlaku', async ({ page }) => {
    await bukaRegistry(page);
    await page.getByTestId(`ubah-${SLUG}`).click();
    await expect(page.getByTestId('konfirmasi-status')).toContainText('Suspend tenant ini?');
    await expect(page.getByTestId('konfirmasi-nama')).toHaveText(`Tenant Layar ${RUN}`);
    // Batas D-55 dikatakan sebelum tombol ditekan, bukan ditemukan sesudahnya.
    await expect(page.getByTestId('peringatan-sesi')).toContainText('D-55');

    await page.getByTestId('konfirmasi-status-submit').click();
    await expect(page).toHaveURL(/\/platform\/tenants\?ok=tenant-disuspend/);
    await expect(page.getByTestId('pesan-halaman')).toContainText('Tenant disuspend');
    await expect(page.getByTestId(`status-${SLUG}`)).toHaveText('Disuspend');
    await expect(page.getByTestId(`ubah-${SLUG}`)).toHaveText('Aktifkan');

    // Bukan sekadar teks: owner tenant uji tidak lagi ditawari tenant itu saat masuk.
    const masuk = await api('POST', '/api/v1/auth/login', { email: OWNER_EMAIL, password: PASSWORD });
    expect(masuk.status).toBe(201);
    expect(masuk.body.status).toBe('SESSION');
    expect(masuk.body.context.tenantId).not.toBe(tenantId);
  });

  test('3. tautan konfirmasi yang basi tidak menawarkan apa pun', async ({ page }) => {
    await isiLogin(page, SUPERADMIN_EMAIL);
    await expect(page.getByTestId('context-platform')).toBeVisible();
    // Tenant sudah disuspend (kasus 2); tautan "suspend" yang lama dibuka lagi.
    await page.goto(`/platform/tenants/${tenantId}/konfirmasi?status=SUSPENDED`);
    await expect(page.getByText('Tidak ada perubahan yang dapat dilakukan')).toBeVisible();
    await expect(page.getByTestId('konfirmasi-status-submit')).toHaveCount(0);
  });

  test('4. aktifkan kembali lewat layar', async ({ page }) => {
    await bukaRegistry(page);
    await page.getByTestId(`ubah-${SLUG}`).click();
    await expect(page.getByTestId('konfirmasi-status')).toContainText('Aktifkan kembali tenant ini?');
    await page.getByTestId('konfirmasi-status-submit').click();
    await expect(page).toHaveURL(/\/platform\/tenants\?ok=tenant-diaktifkan/);
    await expect(page.getByTestId(`status-${SLUG}`)).toHaveText('Aktif');
  });

  test('5. session tenant yang membuka registry ditolak dengan 403, tidak dikeluarkan', async ({ page }) => {
    await isiLogin(page, 'admin@beta.demo');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/platform/tenants');
    await expect(page).toHaveURL(/\/403/);
  });
});
