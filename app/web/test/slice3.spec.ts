import { test, expect, Page } from '@playwright/test';

/**
 * Tes slice 3 lewat browser sungguhan. Yang diperiksa bukan "halaman terbuka",
 * melainkan nilai yang muncul di layar - termasuk yang HARUS TIDAK muncul.
 *
 * Prasyarat: API di 3001 dan web di 3000 sudah berjalan, database sudah di-seed.
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

test('1. akar mengarahkan tamu ke login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('h1')).toHaveText('Masuk');
});

test('2. halaman anggota tidak dapat diakses tanpa login', async ({ page }) => {
  await page.goto('/members');
  await expect(page).toHaveURL(/\/login/);
  // Tidak boleh ada kedipan konten terlindungi sebelum pengalihan.
  await expect(page.locator('[data-testid=members-table]')).toHaveCount(0);
});

test('3. password salah ditolak dengan pesan generik', async ({ page }) => {
  await login(page, 'owner@alpha.demo', 'password-salah');
  await expect(page.locator('[data-testid=form-error]')).toHaveText('Email atau password salah.');
  await expect(page).toHaveURL(/\/login/);
});

test('4. email tak dikenal menghasilkan pesan yang persis sama', async ({ page }) => {
  // Email acak per run: identitas tetap yang tidak pernah login berhasil
  // menumpuk kegagalan sampai terkunci (audit tes 2026-09-21).
  await login(page, `tidak-ada-${Math.random().toString(36).slice(2, 10)}@nowhere.test`, 'password-salah');
  await expect(page.locator('[data-testid=form-error]')).toHaveText('Email atau password salah.');
});

test('5. login Alpha menampilkan tiga anggota Alpha', async ({ page }) => {
  await login(page, 'owner@alpha.demo');
  // Sejak slice 12 login mendarat di dasbor; daftar anggota ada di halamannya sendiri.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('[data-testid=tenant-id]')).toHaveText(ALPHA);
  await page.goto('/administration/members');

  const rows = page.locator('[data-testid=members-table] tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('td').first()).toHaveText('Alpha Owner');
});

test('6. login Beta tidak menampilkan satu pun nama Alpha', async ({ page }) => {
  await login(page, 'admin@beta.demo');
  await page.goto('/administration/members');
  await expect(page.locator('[data-testid=tenant-id]')).toHaveText(BETA);
  await expect(page.locator('[data-testid=members-table] tbody tr')).toHaveCount(2);

  // innerText, bukan textContent: textContent ikut membaca isi <script>, dan
  // payload RSC halaman sebelumnya masih memuat teks contoh yang menyebut Alpha.
  // Yang diuji di sini adalah apa yang TERLIHAT pengguna.
  const terlihat = await page.locator('body').innerText();
  expect(terlihat).not.toContain('Alpha');
  expect(terlihat).not.toContain(ALPHA);

  // Ditambah pemeriksaan langsung pada sumber datanya, supaya kegagalan menunjuk
  // ke baris tabel, bukan ke teks halaman secara umum.
  const namaBaris = await page.locator('[data-testid=members-table] tbody tr td:first-child').allInnerTexts();
  expect(namaBaris.sort()).toEqual(['Beta Admin', 'Multi di Beta']);
});

test('7. token tidak dapat dibaca JavaScript halaman', async ({ page, context }) => {
  await login(page, 'owner@alpha.demo');
  // WAJIB menunggu navigasi selesai. Tanpa ini, document.cookie dibaca sebelum
  // cookie sempat dipasang, sehingga tes lulus bahkan ketika httpOnly dimatikan -
  // tes yang selalu hijau tidak menjaga apa pun.
  await expect(page).toHaveURL(/\/dashboard$/);

  const visible = await page.evaluate(() => document.cookie);
  expect(visible).not.toContain('demo_session');

  // Diperiksa dari dua arah: flag di cookie jar, bukan hanya efeknya.
  const cookie = (await context.cookies()).find((c) => c.name === 'demo_session');
  expect(cookie, 'cookie session harus ada setelah login').toBeTruthy();
  expect(cookie!.httpOnly, 'cookie session wajib httpOnly').toBe(true);
});

test('8. keluar mencabut akses ke halaman anggota', async ({ page }) => {
  await login(page, 'owner@alpha.demo');
  await page.click('button:has-text("Keluar")');
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/members');
  await expect(page).toHaveURL(/\/login/);
});

test('9. identitas lintas tenant tidak langsung masuk ke tenant mana pun', async ({ page }) => {
  // Perilaku ini BERUBAH di slice 5. Sebelumnya login lintas tenant berhenti di
  // halaman masuk dengan pesan; sekarang ia diarahkan ke pemilihan tenant.
  // Tes ini sengaja tidak dihapus: yang dijaga di sini bukan halamannya,
  // melainkan bahwa tidak ada data tenant yang terbuka sebelum tenant dipilih.
  await login(page, 'multi@demo.local');

  await expect(page).not.toHaveURL(/\/members/);
  await expect(page.locator('[data-testid=members-table]')).toHaveCount(0);
  await expect(page.locator('[data-testid=tenant-id]')).toHaveCount(0);
});

test('10. cookie palsu diperlakukan sebagai tidak berwenang', async ({ page, context }) => {
  await context.addCookies([
    {
      name: 'demo_session',
      value: '00000000-0000-0000-0000-000000000000',
      url: 'http://127.0.0.1:3000',
    },
  ]);
  await page.goto('/members');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('[data-testid=members-table]')).toHaveCount(0);
});

test('11. akun terkunci diberi tahu terkunci, bukan "password salah"', async ({ page }) => {
  // Sebelumnya 429 ditampilkan sebagai "Email atau password salah." - orang yang
  // mengetik password BENAR saat terkunci terus diberi tahu salah.
  // Email acak dipakai sengaja: pesan ini juga muncul untuk email yang tidak ada,
  // jadi ia tidak membocorkan keberadaan akun.
  const email = `terkunci-${Math.random().toString(36).slice(2, 10)}@nowhere.test`;
  for (let i = 0; i < 5; i++) {
    await login(page, email, 'salah');
    await expect(page.locator('[data-testid=form-error]')).toHaveText('Email atau password salah.');
  }

  await login(page, email, 'salah');
  await expect(page.locator('[data-testid=form-error]')).toHaveText(
    'Terlalu banyak percobaan masuk. Tunggu beberapa menit, lalu coba lagi.',
  );
});
