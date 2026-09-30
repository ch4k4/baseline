import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Slice 7 di browser: perpanjangan sesi dan deteksi pemakaian ulang, dilihat
 * dari sisi pengguna.
 *
 * Yang membuat berkas ini ada: rotasi refresh token adalah fitur yang seluruh
 * nilainya terletak pada apa yang TIDAK terjadi. Di tes API hal itu terlihat
 * sebagai angka 401; di sini terlihat sebagai halaman masuk - dan itulah yang
 * benar-benar dialami orang.
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const ALPHA = '11111111-1111-1111-1111-111111111111';
const ASAL = 'http://127.0.0.1:3000';

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

/** Sama seperti di slice 5: cookie dibaca SETELAH navigasi selesai, tidak sebelumnya. */
async function cookieSetelah(page: Page, context: BrowserContext, url: RegExp, nama: string) {
  await expect(page).toHaveURL(url);
  const c = (await context.cookies()).find((x) => x.name === nama);
  expect(c, `cookie ${nama} harus ada setelah navigasi`).toBeTruthy();
  return c!.value;
}

/** Meniru access token yang kedaluwarsa: cookie-nya hilang, refresh-nya masih ada. */
async function buangAccessToken(context: BrowserContext) {
  const tersisa = (await context.cookies()).filter((c) => c.name !== 'demo_session');
  await context.clearCookies();
  await context.addCookies(tersisa);
}

test('1. refresh token tersimpan httpOnly dan tidak terbaca JavaScript', async ({
  page,
  context,
}) => {
  await login(page, 'owner@alpha.demo');
  const nilai = await cookieSetelah(page, context, /\/dashboard$/, 'demo_refresh');

  const terlihat = await page.evaluate(() => document.cookie);
  expect(terlihat).not.toContain('demo_refresh');
  expect(terlihat).not.toContain(nilai);

  const cookie = (await context.cookies()).find((c) => c.name === 'demo_refresh');
  expect(cookie!.httpOnly, 'refresh token wajib httpOnly').toBe(true);
});

test('2. access token yang habis diperpanjang diam-diam, tanpa masuk ulang', async ({
  page,
  context,
}) => {
  await login(page, 'owner@alpha.demo');
  const lama = await cookieSetelah(page, context, /\/dashboard$/, 'demo_refresh');

  await buangAccessToken(context);
  await page.goto('/administration/members');

  // Pengguna tetap di halamannya. Kalau perpanjangan tidak bekerja, yang muncul
  // di sini adalah formulir masuk - dan itulah bedanya bagi orang yang memakainya.
  await expect(page.locator('[data-testid=tenant-id]')).toHaveText(ALPHA);

  const baru = (await context.cookies()).find((c) => c.name === 'demo_refresh')!.value;
  expect(baru, 'refresh token harus ditukar, bukan dipakai ulang').not.toBe(lama);
  expect(
    (await context.cookies()).find((c) => c.name === 'demo_session'),
    'access token baru harus terpasang',
  ).toBeTruthy();
});

test('3. refresh token yang dipakai ulang mematikan seluruh sesi', async ({ page, context }) => {
  await login(page, 'owner@alpha.demo');
  const r0 = await cookieSetelah(page, context, /\/dashboard$/, 'demo_refresh');

  // Perpanjangan normal: r0 ditukar dengan r1.
  await buangAccessToken(context);
  await page.goto('/administration/members');
  const r1 = await cookieSetelah(page, context, /\/dashboard/, 'demo_refresh');
  expect(r1).not.toBe(r0);

  // Skenario pencurian: salinan lama dipasang kembali.
  await context.clearCookies();
  await context.addCookies([{ name: 'demo_refresh', value: r0, url: ASAL }]);
  await page.goto('/administration/members');
  await expect(page).toHaveURL(/\/login/);

  // Dan inilah bagian yang penting: token TERBARU pun ikut mati. Pemakaian ulang
  // tidak hanya menolak yang mengulang, ia mencabut seluruh rantainya.
  await context.clearCookies();
  await context.addCookies([{ name: 'demo_refresh', value: r1, url: ASAL }]);
  await page.goto('/administration/members');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('[data-testid=members-table]')).toHaveCount(0);
});

test('4. keluar membuang kedua cookie, dan refresh token lama tidak menghidupkannya lagi', async ({
  page,
  context,
}) => {
  await login(page, 'owner@alpha.demo');
  const refresh = await cookieSetelah(page, context, /\/dashboard$/, 'demo_refresh');

  await page.click('button:has-text("Keluar")');
  await expect(page).toHaveURL(/\/login$/);

  const tersisa = (await context.cookies()).map((c) => c.name);
  expect(tersisa).not.toContain('demo_session');
  expect(tersisa).not.toContain('demo_refresh');

  // Cookie perpanjangan dipasang ulang. Kalau keluar hanya membersihkan browser,
  // token ini akan mencetak access token baru dan "keluar" tidak berarti apa-apa.
  await context.addCookies([{ name: 'demo_refresh', value: refresh, url: ASAL }]);
  await page.goto('/administration/members');
  await expect(page).toHaveURL(/\/login/);
});

test('5. pindah tenant mengganti kedua cookie sekaligus', async ({ page, context }) => {
  await login(page, 'multi@demo.local');
  await page.click('[data-testid=pilih-alpha]');
  const refreshAlpha = await cookieSetelah(page, context, /\/dashboard$/, 'demo_refresh');

  await page.click('[data-testid=pindah-beta]');
  await expect(page.locator('[data-testid=tenant-id]')).not.toHaveText(ALPHA);

  const refreshBeta = (await context.cookies()).find((c) => c.name === 'demo_refresh')!.value;
  expect(
    refreshBeta,
    'refresh token tenant lama tertinggal setelah pindah tenant',
  ).not.toBe(refreshAlpha);
});

test('6. sesi yang sudah mati dibersihkan seluruhnya, bukan setengah', async ({
  page,
  context,
}) => {
  // Jalur ini berbeda dari kasus 4. Di sana pengguna menekan "Keluar" dan yang
  // membersihkan cookie adalah server action. Di sini pengguna TIDAK menekan apa
  // pun: tokennya sudah mati lebih dulu, dan yang membersihkan adalah /logout
  // yang dituju halaman anggota. Keduanya harus membuang dua-duanya.
  //
  // Mutation test menemukan bahwa kasus 4 tidak pernah menyentuh jalur ini:
  // menghapus pembersihan di /logout tidak membuat satu tes pun gagal.
  await login(page, 'owner@alpha.demo');
  await expect(page).toHaveURL(/\/dashboard$/);
  const semua = await context.cookies();

  await page.click('button:has-text("Keluar")');
  await expect(page).toHaveURL(/\/login$/);

  // Kedua cookie milik sesi yang sudah dicabut dipasang kembali.
  await context.addCookies(
    semua
      .filter((c) => c.name === 'demo_session' || c.name === 'demo_refresh')
      .map((c) => ({ name: c.name, value: c.value, url: ASAL })),
  );

  await page.goto('/administration/members');
  await expect(page).toHaveURL(/\/login/);

  const tersisa = (await context.cookies()).map((c) => c.name);
  expect(tersisa, 'cookie basi tertinggal setelah sesi mati').not.toContain('demo_session');
  expect(tersisa, 'cookie basi tertinggal setelah sesi mati').not.toContain('demo_refresh');
});
