import { test, expect, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Slice 10 di browser: yang tampil mengikuti permission, dan pengguna tanpa hak
 * diberi tahu - tidak dikeluarkan paksa.
 *
 * Sebelum slice 10 halaman anggota memperlakukan 403 sama dengan 401: session
 * dicoba diperpanjang lalu dibuang. Setelah RBAC, 403 berarti "session sah,
 * haknya tidak ada", dan membuang session untuk itu mengusir orang dari tenant
 * lain tempat ia punya hak.
 *
 * Anggota tanpa role dibuat lewat undangan (outbox), jadi berkas ini butuh
 * DEMO_DB_SUPER_PASSWORD untuk pembersihan seperti slice 9.
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const OUTBOX = process.env.DEMO_OUTBOX_DIR ?? path.join(homedir(), '.saas-demo', 'outbox');
const CLEANUP = path.resolve(__dirname, '..', '..', 'api', 'dist', 'scripts', 'test-cleanup.js');
const RUN = randomBytes(4).toString('hex');

function bersihkan() {
  if (!process.env.DEMO_DB_SUPER_PASSWORD) {
    throw new Error('Set $env:DEMO_DB_SUPER_PASSWORD di jendela ini: tes RBAC membersihkan anggota yang ia tambahkan.');
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

test('1. admin Beta yang bukan owner melihat form undangan (hak dari permission)', async ({ page }) => {
  await login(page, 'admin@beta.demo');
  // Tautan administrasi muncul dari permission efektif, bukan dari nama role.
  await expect(page.locator('[data-testid=nav-members]')).toBeVisible();
  await page.goto('/administration/invitations');
  await expect(page.locator('[data-testid=invite-section]')).toBeVisible();
});

test('2. anggota tanpa hak melihat "tidak punya akses", tetap masuk, dan dapat keluar', async ({ page, browser }) => {
  // Anggota baru lewat undangan: tanpa role.
  await login(page, 'owner@alpha.demo');
  await page.goto('/administration/invitations');
  const email = `web10-${RUN}@test.demo`;
  const pass = `Tamu#${RUN}xyz`;
  const sebelum = new Set(existsSync(OUTBOX) ? readdirSync(OUTBOX) : []);
  await page.fill('#invite-email', email);
  await page.click('[data-testid=invite-submit]');
  await expect(page.locator('[data-testid=pesan-sukses]')).toContainText('Undangan dikirim');
  let berkas: string[] = [];
  await expect.poll(() => (berkas = readdirSync(OUTBOX).filter((f) => !sebelum.has(f))).length).toBe(1);
  const link = new URL(/^(http\S+\/invite\?token=\S+)$/m.exec(readFileSync(path.join(OUTBOX, berkas[0]), 'utf8'))![1]);

  const ctx = await browser.newContext();
  const tamu = await ctx.newPage();
  await tamu.goto(`${link.pathname}${link.search}`);
  await tamu.fill('#displayName', `Tanpa Hak ${RUN}`);
  await tamu.fill('#password', pass);
  await tamu.click('[data-testid=accept-submit]');
  await expect(tamu).toHaveURL(/\/invite\/diterima$/);

  await login(tamu, email, pass);
  // Tanpa role: dasbor terbuka, tautan administrasi tidak ada, dan membuka
  // halamannya langsung berakhir di /403 - bukan dikeluarkan ke /login.
  await expect(tamu).toHaveURL(/\/dashboard$/);
  await expect(tamu.locator('[data-testid=nav-members]')).toHaveCount(0);
  await tamu.goto('/administration/members');
  await expect(tamu).toHaveURL(/\/403/);
  await expect(tamu.locator('[data-testid=forbidden]')).toBeVisible();
  await expect(tamu.locator('[data-testid=members-table]')).toHaveCount(0);

  // Masih masuk: muat ulang tetap di halaman yang sama, bukan dilempar ke /login.
  await tamu.reload();
  await expect(tamu).toHaveURL(/\/403/);
  expect((await ctx.cookies()).some((c) => c.name === 'demo_session'), 'session dibuang karena 403').toBe(true);

  // Tombol keluar tetap bekerja.
  await tamu.click('[data-testid=logout]');
  await expect(tamu).toHaveURL(/\/login/);
});
