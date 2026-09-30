import { test, expect, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Slice 9 di browser: owner mengundang dari halaman anggota, penerima membuka
 * tautan dari "email" (berkas outbox), membuat akun, lalu masuk.
 *
 * Outbox dibaca dari folder yang sama dengan yang ditulis API yang sedang
 * berjalan: DEMO_OUTBOX_DIR bila diisi, selain itu ~/.saas-demo/outbox. Kalau
 * API dijalankan dengan DEMO_OUTBOX_DIR berbeda, jendela ini harus memakai nilai
 * yang sama.
 *
 * Anggota yang ditambahkan dibersihkan sebelum dan sesudah berkas ini lewat
 * api/scripts/test-cleanup (butuh DEMO_DB_SUPER_PASSWORD di jendela ini), karena
 * slice 3/5/8 memeriksa daftar anggota secara persis.
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const OUTBOX = process.env.DEMO_OUTBOX_DIR ?? path.join(homedir(), '.saas-demo', 'outbox');
const CLEANUP = path.resolve(__dirname, '..', '..', 'api', 'dist', 'scripts', 'test-cleanup.js');
const RUN = randomBytes(4).toString('hex');

function bersihkan() {
  if (!process.env.DEMO_DB_SUPER_PASSWORD) {
    throw new Error('Set $env:DEMO_DB_SUPER_PASSWORD di jendela ini: tes undangan membersihkan anggota yang ia tambahkan.');
  }
  if (!existsSync(CLEANUP)) throw new Error(`${CLEANUP} belum ada - jalankan build API dulu.`);
  execFileSync(process.execPath, [CLEANUP], { stdio: 'pipe' });
}

test.beforeAll(bersihkan);
test.afterAll(bersihkan);

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

const isiOutbox = () => new Set(existsSync(OUTBOX) ? readdirSync(OUTBOX) : []);

/** Menunggu tepat satu berkas baru di outbox, lalu membaca tautan dan id-nya. */
async function suratBaru(sebelum: Set<string>) {
  let baru: string[] = [];
  await expect
    .poll(() => (baru = [...isiOutbox()].filter((f) => !sebelum.has(f))).length, { timeout: 5000 })
    .toBe(1);
  const text = readFileSync(path.join(OUTBOX, baru[0]), 'utf8');
  const link = /^(http\S+\/invite\?token=([A-Za-z0-9_-]{43}))$/m.exec(text);
  const id = /^Invitation-Id: (\S+)$/m.exec(text)?.[1];
  expect(link, 'berkas outbox tidak memuat tautan undangan').toBeTruthy();
  return { text, url: new URL(link![1]), token: link![2], id: id! };
}

async function undangSebagaiOwner(page: Page, email: string) {
  const sebelum = isiOutbox();
  await page.goto('/administration/invitations');
  await page.fill('#invite-email', email);
  await page.click('[data-testid=invite-submit]');
  await expect(page.locator('[data-testid=pesan-sukses]')).toContainText('Undangan dikirim');
  return suratBaru(sebelum);
}

test('1. form undangan hanya untuk pemegang members.invite', async ({ page }) => {
  await login(page, 'owner@alpha.demo');
  await page.goto('/administration/invitations');
  await expect(page.locator('[data-testid=invite-section]')).toBeVisible();

  // Auditor: boleh MELIHAT daftar undangan (members.read), tidak boleh mengundang.
  await page.context().clearCookies();
  await login(page, 'multi@demo.local');
  await page.click('[data-testid=pilih-alpha]');
  await page.waitForURL(/\/dashboard$/);
  await page.goto('/administration/invitations');
  await expect(page.locator('[data-testid=invitations-table]')).toBeVisible();
  await expect(page.locator('[data-testid=invite-section]')).toHaveCount(0);
});

test('2. undang, terima sebagai akun baru, lalu masuk', async ({ page, browser }) => {
  const email = `web9-${RUN}@test.demo`;
  const namaBaru = `Tamu Web ${RUN}`;
  const passBaru = `Tamu#${RUN}xyz`;

  await login(page, 'owner@alpha.demo');
  const surat = await undangSebagaiOwner(page, email);

  // Undangan muncul di daftar, ber-masker; email lengkap dan token tidak ada di halaman.
  const baris = page.locator(`[data-testid=invitation-${surat.id}]`);
  await expect(baris).toContainText('w***@test.demo');
  await expect(baris.locator('[data-testid=invitation-status]')).toHaveText('Menunggu');
  await page.goto('/administration/invitations');
  const html = await page.content();
  expect(html).not.toContain(email);
  expect(html).not.toContain(surat.token);

  // Penerima: browser lain, tanpa session apa pun.
  const tamu = await (await browser.newContext()).newPage();
  await tamu.goto(`${surat.url.pathname}${surat.url.search}`);
  await expect(tamu.locator('h1')).toContainText('Bergabung dengan');
  await expect(tamu.locator('[data-testid=invite-mode]')).toContainText('belum punya akun');
  // Token tidak disalin ke field form mana pun.
  expect(await tamu.locator('form input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).not.toContain(surat.token);
  await expect(tamu.locator('meta[name=referrer]')).toHaveAttribute('content', 'no-referrer');

  await tamu.fill('#displayName', namaBaru);
  await tamu.fill('#password', passBaru);
  await tamu.click('[data-testid=accept-submit]');
  await expect(tamu).toHaveURL(/\/invite\/diterima$/);
  await expect(tamu.locator('[data-testid=accept-success]')).toBeVisible();

  // Tautan yang sama kini mati.
  await tamu.goto(`${surat.url.pathname}${surat.url.search}`);
  await expect(tamu.locator('[data-testid=invite-error]')).toContainText('tidak berlaku');

  // Akun baru masuk langsung ke Alpha - tetapi tanpa role (default-deny, slice 10):
  // halaman "tidak punya akses", bukan daftar anggota dan bukan dikeluarkan paksa.
  await tamu.click('a[href="/login"]');
  await login(tamu, email, passBaru);
  // Anggota tanpa role mendarat di dasbor, tanpa satu pun tautan administrasi.
  await expect(tamu).toHaveURL(/\/dashboard$/);
  await expect(tamu.locator('[data-testid=tanpa-akses]')).toBeVisible();
  await tamu.goto('/administration/members');
  await expect(tamu).toHaveURL(/\/403/);
  await expect(tamu.locator('[data-testid=forbidden]')).toBeVisible();
  await expect(tamu.locator('[data-testid=members-table]')).toHaveCount(0);

  // Pengundang melihat anggota baru di daftarnya.
  await page.goto('/administration/members');
  await expect(page.locator('[data-testid=members-table]')).toContainText(namaBaru);

  // Pengundang melihat status Diterima.
  await page.goto('/administration/invitations');
  await expect(baris.locator('[data-testid=invitation-status]')).toHaveText('Diterima');
});

test('3. undangan yang dicabut dari halaman tidak dapat dipakai', async ({ page }) => {
  await login(page, 'owner@alpha.demo');
  const surat = await undangSebagaiOwner(page, `web9-cabut-${RUN}@test.demo`);

  const baris = page.locator(`[data-testid=invitation-${surat.id}]`);
  await baris.locator('[data-testid=invitation-revoke]').click();
  // Pencabutan lewat halaman konfirmasi yang menyebut tenant aktif (AC DEMO-0307).
  await expect(page.locator('[data-testid=konfirmasi-tenant]')).toHaveText('Tenant Alpha');
  await page.click('[data-testid=konfirmasi-ya]');
  await expect(page.locator('[data-testid=pesan-halaman]')).toContainText('dicabut');
  await expect(baris.locator('[data-testid=invitation-status]')).toHaveText('Dicabut');
  await expect(baris.locator('[data-testid=invitation-revoke]')).toHaveCount(0);

  await page.context().clearCookies();
  await page.goto(`${surat.url.pathname}${surat.url.search}`);
  await expect(page.locator('[data-testid=invite-error]')).toContainText('tidak berlaku');
});

test('4. tautan rusak atau asal tidak membuka form', async ({ page }) => {
  for (const t of ['', 'pendek', randomBytes(32).toString('base64url')]) {
    await page.goto(`/invite?token=${encodeURIComponent(t)}`);
    await expect(page.locator('[data-testid=invite-error]')).toBeVisible();
    await expect(page.locator('#password')).toHaveCount(0);
  }
});
