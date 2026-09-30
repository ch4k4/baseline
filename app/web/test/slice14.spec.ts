import { test, expect, Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * Slice 14 di browser: sesi dukungan break-glass (DEMO-0312).
 *
 * Yang dijaga di sini adalah hal-hal yang hanya terlihat di layar, dan justru
 * itulah bagian yang paling mudah salah:
 *
 *   * banner mode support ADA, permanen, dan menyebut tenant, scope, sisa waktu
 *     (ADR-003 sec.2.2 butir 8). Orang yang tidak sadar sedang berada di dalam
 *     data tenant orang lain adalah risiko yang tidak dapat diperbaiki kemudian;
 *   * nama anggota DI-MASKER di mata sesi support, dan tidak di mata tenant;
 *   * sesi support TIDAK dapat menandai notifikasi tentang dirinya sendiri
 *     terbaca - peringatan tenant tidak boleh dapat dibersihkan oleh yang
 *     diperingatkan;
 *   * "Akhiri sesi" benar-benar mengakhiri di server, bukan hanya menghapus
 *     cookie;
 *   * tenant melihat kejadiannya di lonceng Keamanan miliknya.
 *
 * Akun: superadmin platform dan owner@alpha.demo. `user@alpha.demo` TIDAK dipakai -
 * akun itu dikunci tes rate limiting slice 6 selama lima menit, dan tes yang
 * memakainya lulus atau gagal tergantung urutan suite (pelajaran slice 12, dan
 * kesalahan yang saya ulangi di slice 13).
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const API_DIR = path.resolve(__dirname, '..', '..', 'api');
const require_ = createRequire(__filename);

const ALPHA = '11111111-1111-1111-1111-111111111111';
const SUPERADMIN_EMAIL = 'superadmin@demo.platform';
const RUN = randomBytes(3).toString('hex');

const ALASAN = `Tenant melaporkan daftar anggota tidak dapat dibuka - tiket ${RUN}`;

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
      'Set $env:DEMO_DB_SUPER_PASSWORD di jendela ini: tes slice 14 memeriksa tabel sesi dukungan.',
    );
  }
  // Urutan mengikuti arah foreign key: notifikasi -> sesi support (migrasi 0020).
  await db('DELETE FROM tenant_notifications');
  await db('DELETE FROM support_sessions');
}

// beforeEach: setiap kasus membuka sesinya sendiri, dan index "satu sesi aktif per
// superadmin" membuat kasus yang mewarisi sesi kasus sebelumnya gagal dengan
// alasan yang tidak ada hubungannya dengan apa yang diujinya.
test.beforeEach(bersihkan);
test.afterAll(bersihkan);

async function isiLogin(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
}

/**
 * Keluar lewat tombolnya, bukan dengan menghapus cookie.
 *
 * Dibutuhkan karena beberapa kasus di bawah berganti IDENTITAS di browser yang
 * sama: membuka /login sementara session lama masih ada akan dialihkan ke dasbor,
 * dan `page.fill('#email')` kemudian gagal dengan "waiting for locator" - kegagalan
 * yang menuduh formulirnya, padahal sebabnya session sebelumnya.
 */
async function keluarDulu(page: Page) {
  await page.click('[data-testid=logout]');
  await expect(page.locator('#email')).toBeVisible();
}

/** Masuk sebagai superadmin dan berhenti di halaman sesi dukungan. */
async function konsolSupport(page: Page) {
  await isiLogin(page, SUPERADMIN_EMAIL);
  await expect(page.getByTestId('context-platform')).toHaveText('Platform');
  await page.click('[data-testid=nav-platform-support]');
  await expect(page.getByTestId('buka-sesi')).toBeVisible();
}

async function bukaSesi(
  page: Page,
  opsi: { tenantId?: string; menit?: number; readWrite?: boolean; alasanKode?: string } = {},
) {
  await page.fill('#tenantId', opsi.tenantId ?? ALPHA);
  await page.fill('#reasonText', ALASAN);
  await page.fill('#durationMinutes', String(opsi.menit ?? 30));
  await page.fill('#ticketReference', `TIKET-${RUN}`);
  if (opsi.alasanKode) await page.selectOption('#reasonCode', opsi.alasanKode);
  if (opsi.readWrite) await page.check('[data-testid=scope-read-write]');
  await page.click('[data-testid=buka-sesi-submit]');
}

test.describe('slice 14 - sesi dukungan break-glass', () => {
  test('1. sesi dibuka dari konsol platform dan mendarat di tenant dengan banner mode support', async ({
    page,
  }) => {
    await konsolSupport(page);
    await expect(page.getByTestId('sesi-kosong')).toBeVisible();

    await bukaSesi(page);

    // Mendarat di dasbor TENANT, bukan tetap di konsol: sesi support memang untuk
    // bekerja di dalam tenant itu.
    await expect(page.getByTestId('tenant-aktif')).toHaveText('Tenant Alpha');
    await expect(page).toHaveURL(/\/dashboard/);

    // Banner: tenant, scope, sisa waktu, dan jalan keluar. Semua empat disebut
    // ADR-003 sec.2.2 butir 8, dan semua empat diperiksa - bukan hanya
    // keberadaan bannernya.
    const banner = page.getByTestId('banner-support');
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('banner-support-teks')).toContainText('Tenant Alpha');
    await expect(page.getByTestId('banner-support-teks')).toContainText('READ_ONLY');
    const sisa = Number(await page.getByTestId('banner-support-sisa').innerText());
    expect(sisa).toBeGreaterThan(0);
    expect(sisa).toBeLessThanOrEqual(30);
    await expect(page.getByTestId('akhiri-sesi-support')).toBeVisible();

    // Jalan keluar tenant biasa TIDAK ditawarkan: keduanya route identitas, yang
    // ditolak API untuk sesi support. Tombol yang pasti gagal lebih buruk daripada
    // tombol yang tidak ada.
    await expect(page.getByTestId('logout')).toHaveCount(0);
    await expect(page.getByTestId('pindah-beta')).toHaveCount(0);

    // Navigasi mengikuti permission set support, bukan role tenant mana pun.
    await expect(page.getByTestId('nav-members')).toBeVisible();
    await expect(page.getByTestId('nav-roles')).toBeVisible();

    // Bannernya PERMANEN: berpindah halaman tidak menghilangkannya.
    await page.click('[data-testid=nav-members]');
    await expect(page.getByTestId('banner-support')).toBeVisible();

    const baris = await db<{ status: string; scope: string }>(
      `SELECT status, scope FROM support_sessions WHERE tenant_id = $1`,
      [ALPHA],
    );
    expect(baris).toHaveLength(1);
    expect(baris[0].status).toBe('ACTIVE');
    expect(baris[0].scope).toBe('READ_ONLY');
  });

  test('2. nama anggota ber-masker di mata sesi support, utuh di mata tenant', async ({ page }) => {
    // Mata TENANT lebih dulu, di halaman yang sama - supaya yang dibandingkan
    // adalah tampilan, bukan ingatan tentang seed.
    await isiLogin(page, 'owner@alpha.demo');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.click('[data-testid=nav-members]');
    // Ditunggu SAMPAI TABELNYA ADA sebelum isinya dibaca. allInnerTexts() tidak
    // menunggu apa pun: tanpa penantian ini ia mengembalikan daftar kosong, dan
    // pemeriksaan "tidak ada yang ber-masker" lulus tanpa memeriksa apa pun.
    // Kelas kekeliruan yang sama dengan temuan slice 12 dan 13.
    await expect(page.getByTestId('members-table')).toBeVisible();
    const namaTenant = await page.locator('[data-testid=members-table] tbody tr td:first-child').allInnerTexts();
    expect(namaTenant.length).toBeGreaterThan(0);
    expect(namaTenant.some((n) => n.includes('***'))).toBe(false);

    // Mata SUPPORT, browser yang sama - jadi identitas tenant harus keluar dulu.
    await keluarDulu(page);
    await konsolSupport(page);
    await bukaSesi(page);
    await expect(page.getByTestId('banner-support')).toBeVisible();
    await page.click('[data-testid=nav-members]');
    await expect(page.getByTestId('members-table')).toBeVisible();
    const namaSupport = await page.locator('[data-testid=members-table] tbody tr td:first-child').allInnerTexts();
    expect(namaSupport.length).toBe(namaTenant.length);
    for (const n of namaSupport) expect(n).toContain('***');
    for (const n of namaTenant) expect(namaSupport).not.toContain(n);
  });

  test('3. sesi support tidak dapat menandai notifikasi tentang dirinya sendiri terbaca', async ({
    page,
  }) => {
    await konsolSupport(page);
    await bukaSesi(page);
    await expect(page.getByTestId('banner-support')).toBeVisible();

    // Sesi support MELIHAT notifikasi tentang dirinya (audit.read ada di
    // SUPPORT_READ_SET) - dan itu memang tidak berbahaya.
    await page.click('[data-testid=lonceng-keamanan]');
    await expect(page.getByTestId('notifikasi-table')).toBeVisible();
    const tombol = page.locator('[data-testid^=tandai-]').first();
    await expect(tombol).toBeVisible();

    // Tetapi menandainya terbaca DITOLAK: peringatan tenant tidak boleh dapat
    // dibersihkan oleh yang diperingatkan. Yang menolak adalah guard (metode yang
    // mengubah keadaan + permission di luar SUPPORT_MUTATION_SET), dan layar
    // menerjemahkan 403 menjadi halaman /403 - bukan mengeluarkan orang.
    await tombol.click();
    await expect(page).toHaveURL(/\/403/);

    const [notif] = await db<{ read_at: string | null }>(
      'SELECT read_at FROM tenant_notifications WHERE tenant_id = $1',
      [ALPHA],
    );
    expect(notif.read_at).toBeNull();
  });

  test('4. "Akhiri sesi" mengakhiri di server, bukan hanya di browser', async ({ page }) => {
    await konsolSupport(page);
    await bukaSesi(page);
    await expect(page.getByTestId('banner-support')).toBeVisible();

    await page.click('[data-testid=akhiri-sesi-support]');

    // Kembali ke konsol platform, dengan kabar - dan session PLATFORM masih hidup:
    // mengakhiri sesi support bukan keluar dari aplikasi.
    await expect(page.getByTestId('buka-sesi')).toBeVisible();
    await expect(page.getByTestId('pesan-halaman')).toContainText('diakhiri');

    const [baris] = await db<{ status: string; end_reason: string }>(
      'SELECT status, end_reason FROM support_sessions WHERE tenant_id = $1',
      [ALPHA],
    );
    expect(baris.status).toBe('ENDED');
    expect(baris.end_reason).toBe('MANUAL');

    // Dan tenant tidak lagi terbuka bagi browser ini: membuka dasbor tenant
    // mengembalikannya ke konsol platform, karena yang tersisa adalah session
    // PLATFORM yang tidak punya tenant.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/platform\/admins$/);
    await expect(page.getByTestId('banner-support')).toHaveCount(0);

    // Tenant menerima kabar penutupan, bukan hanya pembukaan.
    const tipe = (
      await db<{ type: string }>('SELECT type FROM tenant_notifications WHERE tenant_id = $1', [ALPHA])
    ).map((r) => r.type);
    expect(tipe).toContain('SUPPORT_SESSION_STARTED');
    expect(tipe).toContain('SUPPORT_SESSION_ENDED');
  });

  test('5. READ_WRITE dengan alasan yang tidak mengizinkan perubahan ditolak di formulir', async ({
    page,
  }) => {
    await konsolSupport(page);
    await bukaSesi(page, { readWrite: true, alasanKode: 'SECURITY_INCIDENT' });

    // Pesannya dirender DI FORMULIR (pelajaran D-26: hasil aksi tidak dipantulkan
    // ke alamat halaman), dan tidak ada sesi yang terbuka.
    await expect(page.getByTestId('pesan-gagal')).toContainText('READ_WRITE');
    await expect(page.getByTestId('banner-support')).toHaveCount(0);
    expect(await db('SELECT id FROM support_sessions')).toHaveLength(0);

    // Dengan alasan yang benar: diterima, dan scopenya memang READ_WRITE.
    await bukaSesi(page, { readWrite: true, alasanKode: 'DATA_CORRECTION_REQUESTED_BY_TENANT' });
    await expect(page.getByTestId('banner-support-teks')).toContainText('READ_WRITE');
    const [baris] = await db<{ scope: string }>('SELECT scope FROM support_sessions');
    expect(baris.scope).toBe('READ_WRITE');
  });

  test('6. tenant melihat kejadiannya sendiri di lonceng Keamanan', async ({ page }) => {
    await konsolSupport(page);
    await bukaSesi(page);
    await expect(page.getByTestId('banner-support')).toBeVisible();
    await page.click('[data-testid=akhiri-sesi-support]');
    await expect(page.getByTestId('buka-sesi')).toBeVisible();

    // Mata TENANT, dengan browser yang sama: session platform keluar dulu.
    await keluarDulu(page);
    await isiLogin(page, 'owner@alpha.demo');
    await expect(page).toHaveURL(/\/dashboard$/);
    const lonceng = page.getByTestId('lonceng-keamanan');
    await expect(lonceng).toContainText('(2)');

    await lonceng.click();
    await expect(page.getByTestId('notifikasi-table')).toBeVisible();

    // Tenant melihat SESINYA, bukan hanya pemberitahuan bahwa ada sesi: scope,
    // alasan, nomor tiket, dan bahwa sesinya sudah berakhir. Keterangan bebas
    // TIDAK ada di sini - kuncinya milik platform (migrasi 0020).
    await expect(page.getByTestId('sesi-support-table')).toBeVisible();
    const tabelSesi = page.getByTestId('sesi-support-table');
    await expect(tabelSesi).toContainText('READ_ONLY');
    await expect(tabelSesi).toContainText('TENANT_REPORTED_BUG');
    await expect(tabelSesi).toContainText(`TIKET-${RUN}`);
    await expect(tabelSesi).toContainText('ENDED');
    await expect(tabelSesi).not.toContainText('daftar anggota tidak dapat dibuka');
    await expect(page.locator('[data-testid=notifikasi-baru]')).toHaveCount(2);
    await expect(page.getByTestId('notifikasi-table')).toContainText('Sesi dukungan platform dibuka');
    await expect(page.getByTestId('notifikasi-table')).toContainText('Sesi dukungan platform berakhir');

    // Dan tenant - berbeda dari sesi support - MEMANG dapat menandainya terbaca.
    await page.locator('[data-testid^=tandai-]').first().click();
    await expect(page.getByTestId('pesan-sukses')).toBeVisible();
    await expect(page.locator('[data-testid=notifikasi-baru]')).toHaveCount(1);
  });
});
