import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Slice 5 di browser: memilih tenant saat masuk, dan berpindah tenant setelahnya.
 *
 * Yang diuji adalah apa yang dialami pengguna, termasuk yang TIDAK boleh terjadi:
 * tiket tidak menjadi akses, dan pindah tenant tidak menyisakan akses ke tenant lama.
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  // Menunggu jawaban server action selesai. Tanpa ini navigasi berikutnya dapat
  // membatalkan login yang masih berjalan, dan tesnya gagal di tempat yang tidak
  // ada hubungannya dengan apa yang diuji (ditemukan saat slice 12).
  await page.waitForLoadState('networkidle');
}

/**
 * Membaca cookie SETELAH memastikan halaman tujuan sudah termuat.
 *
 * Ini ada karena kesalahan yang sama sudah terjadi tiga kali: membaca cookie
 * tepat setelah klik menghasilkan nilai kosong, dan tes yang membaca kosong
 * akan lulus walau perlindungannya dimatikan. Helper ini membuat urutannya
 * tidak bisa dilupakan.
 */
async function cookieSetelah(page: Page, context: BrowserContext, url: RegExp, nama: string) {
  await expect(page).toHaveURL(url);
  const c = (await context.cookies()).find((x) => x.name === nama);
  expect(c, `cookie ${nama} harus ada setelah navigasi`).toBeTruthy();
  return c!.value;
}

test('1. identitas lintas tenant diarahkan ke halaman pilih tenant', async ({ page }) => {
  await login(page, 'multi@demo.local');
  await expect(page).toHaveURL(/\/select-context$/);
  // Judulnya "tempat masuk", bukan "tenant", sejak DEMO-0311: halaman yang sama
  // juga menawarkan context PLATFORM kepada superadmin. Identitas ini bukan admin
  // platform, jadi pilihannya tetap dua tenant.
  await expect(page.locator('h1')).toHaveText('Pilih tempat masuk');
  await expect(page.locator('[data-testid^=pilih-]')).toHaveCount(2);
});

test('2. halaman anggota belum dapat dibuka sebelum tenant dipilih', async ({ page }) => {
  await login(page, 'multi@demo.local');
  await expect(page).toHaveURL(/\/select-context$/);

  // Tiket bukan akses. Kalau kasus ini gagal, pemisahan tiket dan session percuma.
  await page.goto('/members');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('[data-testid=members-table]')).toHaveCount(0);
});

test('3. tiket tersimpan httpOnly, tidak terbaca JavaScript', async ({ page, context }) => {
  await login(page, 'multi@demo.local');
  await expect(page).toHaveURL(/\/select-context$/);

  const terlihat = await page.evaluate(() => document.cookie);
  expect(terlihat).not.toContain('demo_ticket=');

  const tiket = (await context.cookies()).find((c) => c.name === 'demo_ticket');
  expect(tiket, 'cookie tiket harus ada').toBeTruthy();
  expect(tiket!.httpOnly, 'tiket wajib httpOnly').toBe(true);
});

test('4. memilih Alpha menghasilkan daftar anggota Alpha', async ({ page }) => {
  await login(page, 'multi@demo.local');
  await page.click('[data-testid=pilih-alpha]');

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('[data-testid=tenant-id]')).toHaveText(ALPHA);
  await page.goto('/administration/members');
  await expect(page.locator('[data-testid=members-table] tbody tr')).toHaveCount(3);
});

test('5. memilih Beta menghasilkan daftar anggota Beta', async ({ page }) => {
  await login(page, 'multi@demo.local');
  await page.click('[data-testid=pilih-beta]');

  await expect(page.locator('[data-testid=tenant-id]')).toHaveText(BETA);
  await page.goto('/administration/members');
  const nama = await page
    .locator('[data-testid=members-table] tbody tr td:first-child')
    .allInnerTexts();
  expect(nama.sort()).toEqual(['Beta Admin', 'Multi di Beta']);
});

test('6. tiket habis setelah dipakai: kembali ke halaman pilih tidak bisa', async ({
  page,
  context,
}) => {
  // Versi sebelumnya hanya memeriksa bahwa /select-context mengalihkan ke /members.
  // Pengalihan itu dipicu cookie SESSION, bukan tiket - membiarkan tiket tertinggal
  // tidak membuatnya gagal (audit tes 2026-09-21). Sekarang tiketnya sendiri diuji.
  await login(page, 'multi@demo.local');
  const tiket = await cookieSetelah(page, context, /\/select-context$/, 'demo_ticket');
  const daftar = (await context.cookies()).find((c) => c.name === 'demo_ticket_contexts')!.value;

  await page.click('[data-testid=pilih-alpha]');
  await expect(page).toHaveURL(/\/dashboard$/);

  // 1. Browser tidak lagi menyimpan tiket.
  const sisa = (await context.cookies()).map((c) => c.name);
  expect(sisa, 'cookie tiket tertinggal setelah dipakai').not.toContain('demo_ticket');

  // 2. Server menolak tiket yang sama walau dipasang kembali.
  await context.clearCookies();
  await context.addCookies([
    { name: 'demo_ticket', value: tiket, url: 'http://127.0.0.1:3000' },
    { name: 'demo_ticket_contexts', value: daftar, url: 'http://127.0.0.1:3000' },
  ]);
  await page.goto('/select-context');
  await page.click('[data-testid=pilih-alpha]');
  await expect(page).toHaveURL(/\/login\?error=tiket/);
  await expect(page.locator('[data-testid=members-table]')).toHaveCount(0);
});

test('7. berpindah tenant dari halaman anggota', async ({ page }) => {
  await login(page, 'multi@demo.local');
  await page.click('[data-testid=pilih-alpha]');
  await page.waitForURL(/\/dashboard$/);
  await page.goto('/administration/members');
  await expect(page.locator('[data-testid=tenant-id]')).toHaveText(ALPHA);

  // Perpindahan selalu mendarat di dasbor: hak di tenant baru bisa berbeda.
  await page.click('[data-testid=pindah-beta]');
  await expect(page.locator('[data-testid=tenant-id]')).toHaveText(BETA);

  // Daftar anggota tenant baru dibuka lagi, dan tidak boleh memuat nama tenant lama.
  await page.goto('/administration/members');
  const terlihat = await page.locator('body').innerText();
  expect(terlihat).not.toContain('Alpha Owner');
  expect(terlihat).not.toContain('Alpha User');
});

test('8. pemindah tenant hanya menawarkan tenant lain', async ({ page }) => {
  await login(page, 'multi@demo.local');
  await page.click('[data-testid=pilih-alpha]');

  await expect(page.locator('[data-testid=pindah-beta]')).toHaveCount(1);
  await expect(page.locator('[data-testid=pindah-alpha]')).toHaveCount(0);
});

test('9. identitas satu tenant tidak melihat pemindah tenant', async ({ page }) => {
  await login(page, 'owner@alpha.demo');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('[data-testid^=pindah-]')).toHaveCount(0);
});

test('10. token lama tidak berlaku lagi setelah berpindah', async ({ page, context }) => {
  await login(page, 'multi@demo.local');
  await page.click('[data-testid=pilih-alpha]');
  const lama = await cookieSetelah(page, context, /\/dashboard$/, 'demo_session');

  await page.click('[data-testid=pindah-beta]');
  await expect(page.locator('[data-testid=tenant-id]')).toHaveText(BETA);

  // Kembalikan cookie lama secara paksa: meniru orang yang sempat menyalin token.
  await context.clearCookies();
  await context.addCookies([
    { name: 'demo_session', value: lama, url: 'http://127.0.0.1:3000' },
  ]);
  await page.goto('/members');
  await expect(page).toHaveURL(/\/login/);
});

test('11. keluar mencabut session di server, bukan hanya di browser', async ({ page, context }) => {
  await login(page, 'owner@alpha.demo');
  const token = await cookieSetelah(page, context, /\/dashboard$/, 'demo_session');

  await page.click('button:has-text("Keluar")');
  await expect(page).toHaveURL(/\/login$/);

  // Cookie yang sama dipasang ulang. Kalau keluar hanya membuang cookie,
  // token ini akan tetap membuka halaman - dan itu yang diuji di sini.
  await context.addCookies([
    { name: 'demo_session', value: token, url: 'http://127.0.0.1:3000' },
  ]);
  await page.goto('/members');
  await expect(page).toHaveURL(/\/login/);
});
