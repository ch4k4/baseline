import { test, expect, Page } from '@playwright/test';

/**
 * Rate limit per IP lewat browser: membuktikan BFF MENERUSKAN IP klien ke API.
 *
 * Tes API (api/test/ratelimit-ip.test.ts) memanggil API langsung dengan header
 * yang disusunnya sendiri, jadi tidak ada satu pun tes di sana yang gagal bila
 * halaman login berhenti meneruskan IP. Di sini IP berasal dari
 * `x-forwarded-for` yang dikirim browser - web dijalankan tanpa proxy di depannya
 * (WEB_TRUSTED_PROXY_HOPS = 0), sehingga nilai terakhir header itu yang dipakai.
 *
 * Prasyarat: API di 3001 dan web di 3000 sudah berjalan, dengan
 * DEMO_LOGIN_IP_MAX_FAILURES yang sama dengan proses tes ini (bawaan 30).
 */

const BATAS = Number(process.env.DEMO_LOGIN_IP_MAX_FAILURES ?? 30);

/** IP dokumentasi (RFC 5737) acak per run, supaya run berulang tidak saling mengunci. */
const ipAcak = () => `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
const emailAcak = () => `semprot-${Math.random().toString(36).slice(2, 10)}@nowhere.test`;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForLoadState('networkidle');
}

test('1. password spraying dari satu IP dihentikan, IP lain tetap dilayani', async ({ browser }) => {
  test.setTimeout(30_000 + BATAS * 2_000);

  const ip = ipAcak();
  let lain = ipAcak();
  while (lain === ip) lain = ipAcak();

  const penyerang = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await penyerang.newPage();
  for (let i = 0; i < BATAS; i++) {
    await login(page, emailAcak(), 'salah-sekali');
    await expect(page.locator('[data-testid=form-error]')).toHaveText('Email atau password salah.');
  }

  // Email baru, kegagalan pertamanya - hanya IP-nya yang sudah habis.
  await login(page, emailAcak(), 'salah-sekali');
  await expect(page.locator('[data-testid=form-error]')).toHaveText(
    'Terlalu banyak percobaan masuk. Tunggu beberapa menit, lalu coba lagi.',
  );
  await penyerang.close();

  const tetangga = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': lain } });
  const page2 = await tetangga.newPage();
  await login(page2, emailAcak(), 'salah-sekali');
  await expect(page2.locator('[data-testid=form-error]')).toHaveText('Email atau password salah.');
  await tetangga.close();
});
