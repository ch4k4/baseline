import { test, expect, Page } from '@playwright/test';

/**
 * Slice 8 di browser: setelah enkripsi field, halaman anggota tetap terbaca -
 * dan email lengkap tidak pernah sampai ke halaman.
 *
 * Tes API sudah memeriksa JSON-nya. Tes ini ada karena halaman adalah tempat
 * kebocoran paling mudah terjadi kembali: satu komponen yang suatu saat meminta
 * endpoint detail "supaya lengkap" dan email utuh muncul lagi di layar.
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  // Menunggu jawaban server action selesai. Tanpa ini navigasi berikutnya dapat
  // membatalkan login yang masih berjalan, dan tesnya gagal di tempat yang tidak
  // ada hubungannya dengan apa yang diuji (ditemukan saat slice 12).
  await page.waitForLoadState('networkidle');
}

test('1. nama anggota terbaca dan terurut setelah dekripsi', async ({ page }) => {
  await login(page, 'owner@alpha.demo');
  await page.goto('/administration/members');

  const nama = await page
    .locator('[data-testid=members-table] tbody tr td:first-child')
    .allInnerTexts();
  // Urutan diperiksa apa adanya, TIDAK diurutkan ulang oleh tes: pengurutan
  // setelah dekripsi adalah tugas aplikasi (SSOT sec.8.4), jadi yang diuji di sini.
  expect(nama).toEqual(['Alpha Owner', 'Alpha User', 'Multi di Alpha']);
});

test('2. email kontak tampil ber-masker, dan email lengkap tidak ada di halaman', async ({ page }) => {
  await login(page, 'owner@alpha.demo');
  await page.goto('/administration/members');

  const email = await page
    .locator('[data-testid=members-table] tbody tr td:nth-child(2)')
    .allInnerTexts();
  expect(email.sort()).toEqual(['m***@demo.local', 'o***@alpha.demo', 'u***@alpha.demo']);

  // Diperiksa di HTML mentah, bukan hanya teks yang terlihat: atribut, payload
  // RSC, dan data tersembunyi juga sampai ke browser.
  //
  // Halaman dimuat ULANG dulu. Setelah navigasi sisi klien, DOM masih memuat
  // payload halaman login - yang memang menampilkan email demo sebagai
  // petunjuk. Tanpa muat ulang, tes ini menuduh halaman anggota atas teks
  // milik halaman lain.
  await page.goto('/administration/members');
  await expect(page.locator('[data-testid=members-table]')).toBeVisible();
  const html = await page.content();
  for (const penuh of ['owner@alpha.demo', 'user@alpha.demo', 'multi@demo.local']) {
    expect(html, `email lengkap ${penuh} ada di halaman`).not.toContain(penuh);
  }
});
