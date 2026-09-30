import { test, expect, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * Slice 13 di browser: konsol platform (DEMO-0311) dan lonceng notifikasi
 * keamanan (DEMO-0313).
 *
 * Yang paling penting di berkas ini bukan tampilannya, melainkan satu jalan
 * buntu yang diciptakan slice ini sendiri: superadmin TIDAK punya membership
 * tenant, jadi halaman pilih-tenant dan dasbor tenant keduanya bukan tempatnya
 * mendarat. Kasus 1 dan 4 menjaga supaya jalan buntu itu tidak kembali.
 *
 * Yang TIDAK diuji di sini: banner mode support, registry tenant, dan audit
 * platform (DEMO-0409, sesudah 0312).
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const API_DIR = path.resolve(__dirname, '..', '..', 'api');
const require_ = createRequire(__filename);

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';
const SUPERADMIN_EMAIL = 'superadmin@demo.platform';
const SUPERADMIN_ID = 'dddddddd-0000-0000-0000-000000000001';

/**
 * Calon admin platform: admin Beta - BUKAN `user@alpha.demo`.
 *
 * Akun itu sengaja dikunci tes API slice 6 selama 5 menit. Versi pertama berkas
 * ini memakainya, lulus di lingkungan pengembangan, dan gagal di mesin target
 * dengan `login?error=terkunci` karena di sana tes API berjalan tepat sebelum tes
 * browser. Kelas kekeliruan yang sama sudah tercatat di slice 12; saya
 * mengulanginya, dan ini perbaikannya.
 */
const BETA_ADMIN_EMAIL = 'admin@beta.demo';
const BETA_ADMIN_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const R_ALPHA_USER = '9a9a9a9a-0000-0000-0000-000000000003';

const API = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const OUTBOX = process.env.DEMO_OUTBOX_DIR ?? path.join(homedir(), '.saas-demo', 'outbox');
const API_DIR_CLEANUP = path.resolve(__dirname, '..', '..', 'api', 'dist', 'scripts', 'test-cleanup.js');
const RUN = randomBytes(3).toString('hex');

/** Klien database superuser: notifikasi keamanan hanya dapat dibuat lewat F-15. */
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

async function bersihkan() {
  if (!process.env.DEMO_DB_SUPER_PASSWORD) {
    throw new Error(
      'Set $env:DEMO_DB_SUPER_PASSWORD di jendela ini: tes slice 13 memeriksa tabel platform.',
    );
  }
  // Keadaan bersama dikembalikan: daftar admin platform dan notifikasi tenant
  // dibaca juga oleh tes lain.
  await db('DELETE FROM platform_role_assignments WHERE user_id <> $1', [SUPERADMIN_ID]);
  await db('DELETE FROM tenant_notifications');
  // Urutan mengikuti arah foreign key: notifikasi -> sesi support (migrasi 0020).
  await db('DELETE FROM support_sessions');
  // Anggota hasil undangan dibersihkan lewat skrip yang sama dengan tes lain.
  if (existsSync(API_DIR_CLEANUP)) execFileSync(process.execPath, [API_DIR_CLEANUP], { stdio: 'pipe' });
}

// beforeEach, bukan beforeAll: setiap kasus di bawah mengubah daftar admin
// platform, dan kasus yang bergantung pada sisa kasus sebelumnya adalah cara tes
// mulai lulus atau gagal karena sebab yang tidak ada di dalamnya (pelajaran
// slice 12: ketergantungan pada urutan suite).
test.beforeEach(bersihkan);
test.afterAll(bersihkan);

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}${path}`, {
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

/**
 * Anggota Alpha baru dengan role seed `tenant_user` (tanpa `audit.read`),
 * dibuat per run lewat API.
 *
 * Kenapa dibuat, bukan diambil dari seed: satu-satunya akun seed tanpa
 * `audit.read` adalah `user@alpha.demo`, yang dikunci tes API. Kenapa lewat API
 * dan bukan lewat klik: alur undangan di layar sudah dijaga slice 9 dan 12, dan
 * yang diuji di sini adalah lonceng keamanan.
 */
async function anggotaTanpaAudit(): Promise<{ email: string; password: string }> {
  const masuk = await api('POST', '/api/v1/auth/login', {
    email: 'owner@alpha.demo',
    password: PASSWORD,
  });
  if (masuk.status !== 201) throw new Error(`login owner gagal: ${masuk.teks}`);
  const owner = masuk.body.accessToken as string;

  const email = `w13-${RUN}@test.demo`;
  const sebelum = new Set(existsSync(OUTBOX) ? readdirSync(OUTBOX) : []);
  const inv = await api('POST', '/api/v1/invitations', { email, roleIds: [R_ALPHA_USER] }, owner);
  if (inv.status !== 202) throw new Error(`undangan gagal: ${inv.teks}`);

  let berkas: string[] = [];
  await expect
    .poll(() => (berkas = readdirSync(OUTBOX).filter((f) => !sebelum.has(f))).length, {
      message: 'undangan tidak muncul di outbox',
    })
    .toBe(1);
  const isi = readFileSync(path.join(OUTBOX, berkas[0]), 'utf8');
  const token = /\/invite\?token=([A-Za-z0-9_-]{43})/.exec(isi)![1];

  const password = `Anggota#${RUN}x`;
  const acc = await api('POST', '/api/v1/invitations/accept', {
    token,
    password,
    displayName: `W13 ${RUN}`,
  });
  if (acc.status !== 200) throw new Error(`penerimaan gagal: ${acc.teks}`);
  return { email, password };
}

async function isiLogin(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
}

async function masukTenant(page: Page, email: string) {
  await isiLogin(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe('slice 13 - konsol platform dan notifikasi keamanan', () => {
  test('1. superadmin mendarat di konsol platform, bukan di dasbor tenant kosong', async ({ page }) => {
    await isiLogin(page, SUPERADMIN_EMAIL);

    // Satu context: tanpa halaman pemilihan. Pendaratannya konsol platform.
    await expect(page.getByTestId('context-platform')).toHaveText('Platform');
    await expect(page).toHaveURL(/\/platform\/admins$/);

    // Tidak ada sisa kerangka tenant: tanpa nama tenant, tanpa navigasi anggota.
    await expect(page.getByTestId('tenant-aktif')).toHaveCount(0);
    await expect(page.getByTestId('nav-members')).toHaveCount(0);

    // Bootstrap menghasilkan tepat satu admin.
    await expect(page.getByTestId(`admin-${SUPERADMIN_ID}`)).toHaveCount(1);

    // Daftar tidak memuat email siapa pun (ADR-003 sec.2.1).
    expect(await page.locator('[data-testid=admins-table]').innerText()).not.toContain('@');
  });

  test('2. session tenant yang membuka konsol platform ditolak, tetapi tidak dikeluarkan', async ({ page }) => {
    await masukTenant(page, 'owner@alpha.demo');
    await page.goto('/platform/admins');

    // 403, bukan login: hak kurang bukan alasan mengusir orang (pelajaran slice 10).
    await expect(page).toHaveURL(/\/403/);
    await page.goto('/dashboard');
    await expect(page.getByTestId('tenant-aktif')).toBeVisible();
  });

  test('3. beri lalu cabut hak admin platform lewat halaman konfirmasi', async ({ page }) => {
    await isiLogin(page, SUPERADMIN_EMAIL);
    await expect(page.getByTestId('admins-table')).toBeVisible();

    await page.fill('#userId', BETA_ADMIN_ID);
    await page.fill('#reason', 'Tiket 12345678: operator kedua');
    await page.getByTestId('beri-admin-submit').click();

    await expect(page.getByTestId('pesan-halaman')).toBeVisible();
    await expect(page.getByTestId(`admin-${BETA_ADMIN_ID}`)).toHaveCount(1);

    // Pencabutan lewat halaman konfirmasi server, bukan confirm() browser.
    await page.getByTestId(`cabut-${BETA_ADMIN_ID}`).click();
    await expect(page.getByTestId('konfirmasi-cabut')).toBeVisible();
    await expect(page.getByTestId('konfirmasi-user-id')).toHaveText(BETA_ADMIN_ID);
    await page.getByTestId('konfirmasi-cabut-submit').click();

    await expect(page).toHaveURL(/\/platform\/admins\?ok=admin-dicabut$/);
    await expect(page.getByTestId(`admin-${BETA_ADMIN_ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`admin-${SUPERADMIN_ID}`)).toHaveCount(1);
  });

  test('4. identitas dengan tenant DAN platform memilih tempat masuk', async ({ page }) => {
    // Jalan buntu yang dicegah kasus ini: sebelum opsi Platform ada di halaman
    // pemilihan, identitas seperti ini hanya dapat memilih tenant - haknya di
    // platform tidak punya pintu sama sekali.
    await db(
      `INSERT INTO platform_role_assignments (user_id, role_code, reason)
       VALUES ($1, 'platform_superadmin', 'Uji browser slice 13')`,
      [BETA_ADMIN_ID],
    );

    await isiLogin(page, BETA_ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/select-context$/);

    // Dua pilihan: tenant Beta dan Platform. Admin Beta hanya punya satu tenant,
    // jadi sesudah memilih tenant tidak ada tombol pindah yang sah - itu yang
    // membuat pemeriksaan di bawah punya arti.
    await expect(page.getByTestId('pilih-beta')).toBeVisible();
    await expect(page.getByTestId('pilih-platform')).toBeVisible();

    // Memilih tenant lebih dulu: kerangka tenant TIDAK boleh menawarkan
    // "pindah ke" context platform sebagai tenant. Tanpa saringan di Kerangka,
    // baris platform (tenantId kosong) terbit sebagai tombol yang mengirim
    // tenantId hampa - dan tidak ada kasus lain yang akan menangkapnya.
    await page.getByTestId('pilih-beta').click();
    // Elemen dasbor ditunggu LEBIH DULU, bukan hanya alamatnya: toHaveURL sudah
    // lulus saat alamat berubah, sementara DOM halaman lama masih terpasang -
    // dan halaman lama memang tidak punya tombol pindah, sehingga hitungan nol
    // di bawah akan lulus tanpa memeriksa apa pun.
    await expect(page.getByTestId('tenant-aktif')).toBeVisible();
    await expect(page.locator('[data-testid^=pindah-]')).toHaveCount(0);

    await page.goto('/logout');
    await isiLogin(page, BETA_ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/select-context$/);
    await page.getByTestId('pilih-platform').click();
    await expect(page).toHaveURL(/\/platform\/admins$/);
    await expect(page.getByTestId('context-platform')).toHaveText('Platform');

    // Dan dari sana, dasbor tenant tetap tertutup untuk session ini.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/platform\/admins$/);
  });

  test('5. alasan bukan tempat data pribadi, dan kegagalan tampil di formulir', async ({ page }) => {
    await isiLogin(page, SUPERADMIN_EMAIL);
    await expect(page.getByTestId('admins-table')).toBeVisible();

    await page.fill('#userId', BETA_ADMIN_ID);
    await page.fill('#reason', 'diminta budi@contoh.co.id');
    await page.getByTestId('beri-admin-submit').click();

    // Pesan muncul DI FORMULIR, bukan lewat alamat halaman (pelajaran D-26).
    await expect(page.getByTestId('pesan-gagal')).toBeVisible();
    await expect(page.getByTestId('pesan-gagal')).toContainText(/email/i);
    await expect(page.getByTestId(`admin-${BETA_ADMIN_ID}`)).toHaveCount(0);

    // Dan formulir yang sama masih dapat dipakai sesudah kegagalan: inilah yang
    // dulu rusak di slice 12 (pengiriman kedua berhenti berpindah halaman).
    //
    // KEDUA isian diisi ulang, dan itu bukan kelalaian tes: render ulang server
    // sesudah aksi gagal mengosongkan isian yang tidak dikendalikan. Kehilangan
    // apa yang sudah diketik adalah cacat kegunaan yang nyata; ia dicatat sebagai
    // utang (D-32), dan tes ini menggambarkan perilaku yang BERLAKU sekarang,
    // bukan yang seharusnya.
    await page.fill('#userId', BETA_ADMIN_ID);
    await page.fill('#reason', 'Tiket 999: operator kedua');
    await page.getByTestId('beri-admin-submit').click();
    await expect(page.getByTestId('pesan-halaman')).toBeVisible();
    await expect(page.getByTestId(`admin-${BETA_ADMIN_ID}`)).toHaveCount(1);
  });

  test('6. lonceng keamanan: hitungan, halaman, dan tanda terbaca', async ({ page }) => {
    // Notifikasi hanya dapat dibuat lewat F-15; tidak ada endpoint yang membuatnya.
    //
    // Sejak migrasi 0020, ref_id adalah FOREIGN KEY ke support_sessions (janji
    // 0019, dibayar di DEMO-0312), jadi notifikasi tidak dapat lagi menunjuk id
    // sembarang - versi pertama kasus ini menunjuk SUPERADMIN_ID, yang kebetulan
    // berbentuk UUID. Sesi supportnya karena itu dibuat lebih dulu.
    const [sesi] = await db<{ id: string }>(
      `INSERT INTO sessions (context_kind, tenant_id, user_id, membership_id, expires_at)
       VALUES ('PLATFORM', NULL, $1, NULL, now() + interval '1 hour') RETURNING id`,
      [SUPERADMIN_ID],
    );
    const [sup] = await db<{ id: string }>(
      `INSERT INTO support_sessions
         (tenant_id, superadmin_user_id, platform_session_id, scope, reason_code,
          reason_text_ciphertext, reason_text_key_version, expires_at)
       VALUES ($1, $2, $3, 'READ_ONLY', 'DATA_INVESTIGATION', '\\x00'::bytea, 1,
               now() + interval '30 minutes')
       RETURNING id`,
      [ALPHA, SUPERADMIN_ID, sesi.id],
    );
    await db('SELECT auth.notify_tenant_security_event($1, $2, $3)', [
      ALPHA,
      'SUPPORT_SESSION_STARTED',
      sup.id,
    ]);

    await masukTenant(page, 'owner@alpha.demo');
    const lonceng = page.getByTestId('lonceng-keamanan');
    await expect(lonceng).toContainText('(1)');

    await lonceng.click();
    await expect(page.getByTestId('notifikasi-table')).toBeVisible();
    await expect(page.getByTestId('notifikasi-baru')).toHaveCount(1);

    await page.locator('[data-testid^=tandai-]').first().click();
    await expect(page.getByTestId('pesan-sukses')).toBeVisible();
    // Hitungan di lonceng ikut turun: halaman dimuat ulang di server, bukan
    // ditebak di browser.
    await expect(page.getByTestId('lonceng-keamanan')).not.toContainText('(1)');
    await expect(page.getByTestId('notifikasi-baru')).toHaveCount(0);

    // Anggota tanpa audit.read tidak melihat loncengnya, dan halamannya tertutup.
    const anggota = await anggotaTanpaAudit();
    await page.goto('/logout');
    await isiLogin(page, anggota.email, anggota.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('lonceng-keamanan')).toHaveCount(0);
    await page.goto('/administration/notifications');
    await expect(page).toHaveURL(/\/403/);
  });
});
