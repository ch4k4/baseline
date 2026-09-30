import { test, expect, Page, Browser } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Slice 12 di browser: layar administrasi (DEMO-0307) dan dua skenario demo
 * (Demo Foundation sec.19 skenario 1 dan 2).
 *
 * Yang diuji di sini adalah apa yang dialami orang di layar, bukan apa yang
 * dijawab API - itu sudah dijaga tes API slice 10-11b. Karena itu setiap
 * langkah skenario dijalankan lewat klik dan isian, bukan lewat fetch.
 *
 * Navigasi berbasis menu dinamis (GET /me/menu) adalah kapabilitas Sprint 4
 * (DEMO-0403/0405). Di slice ini navigasinya daftar tetap yang disaring
 * permission efektif, dan itulah yang diuji: tautan muncul dan hilang mengikuti
 * hak, sementara URL yang dibuka langsung tetap dijaga API.
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const OUTBOX = process.env.DEMO_OUTBOX_DIR ?? path.join(homedir(), '.saas-demo', 'outbox');
const API_DIR = path.resolve(__dirname, '..', '..', 'api');
const CLEANUP = path.join(API_DIR, 'dist', 'scripts', 'test-cleanup.js');
const RUN = randomBytes(3).toString('hex');
const require_ = createRequire(__filename);

function bersihkan() {
  if (!process.env.DEMO_DB_SUPER_PASSWORD) {
    throw new Error('Set $env:DEMO_DB_SUPER_PASSWORD di jendela ini: tes slice 12 membuat anggota dan role.');
  }
  if (!existsSync(CLEANUP)) throw new Error(`${CLEANUP} belum ada - jalankan build API dulu.`);
  execFileSync(process.execPath, [CLEANUP], { stdio: 'pipe' });
}

/** Klien database superuser untuk memeriksa audit (dipakai skenario 1 langkah 6). */
async function db<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  // Klien pg diambil dari node_modules API supaya web tidak perlu dependensi
  // database sendiri; tipenya sengaja longgar - yang dipakai hanya query().
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

let mulai: string;

test.beforeAll(async () => {
  bersihkan();
  mulai = (await db<{ t: string }>('SELECT clock_timestamp() AS t'))[0].t as unknown as string;
});
test.afterAll(bersihkan);

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  // Menunggu pendaratan, bukan sekadar klik: tanpa ini navigasi berikutnya dapat
  // membatalkan permintaan login yang masih berjalan, dan tes gagal di tempat
  // yang tidak ada hubungannya dengan apa yang diujinya.
  await expect(page).toHaveURL(/\/dashboard$/);
}

function isiOutbox(): Set<string> {
  return new Set(existsSync(OUTBOX) ? readdirSync(OUTBOX) : []);
}

async function suratBaru(sebelum: Set<string>) {
  let berkas: string[] = [];
  await expect
    .poll(() => (berkas = readdirSync(OUTBOX).filter((f) => !sebelum.has(f))).length, {
      message: 'undangan tidak muncul di outbox',
    })
    .toBe(1);
  const isi = readFileSync(path.join(OUTBOX, berkas[0]), 'utf8');
  return new URL(/^(http\S+\/invite\?token=\S+)$/m.exec(isi)![1]);
}

test('1. skenario demo 1 - owner membuat role, memberi permission, mengundang, dan semuanya tercatat', async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  const kode = `demo12_${RUN}`;
  const email = `web12-${RUN}@test.demo`;
  const pass = `Tamu#${RUN}xyz`;

  // 1-2. Masuk sebagai Alpha Owner; tenant aktif terlihat jelas.
  await login(page, 'owner@alpha.demo');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('[data-testid=tenant-aktif]')).toHaveText('Tenant Alpha');

  // 3. Tautan administrasi terlihat karena permission, bukan karena nama role.
  await expect(page.locator('[data-testid=nav-members]')).toBeVisible();
  await expect(page.locator('[data-testid=nav-roles]')).toBeVisible();

  // 4a. Membuat role demo.
  await page.click('[data-testid=nav-roles]');
  await page.fill('#role-code', kode);
  await page.fill('#role-name', `Demo ${RUN}`);
  await page.click('[data-testid=buat-role-submit]');
  await expect(page.locator('[data-testid=pesan-halaman]')).toContainText('Role dibuat');

  // 4b. Editor permission memakai katalog server: kode yang ada di katalog tenant
  // muncul sebagai pilihan, dan keadaan tercentang datang dari isi role saat ini.
  await expect(page.locator('[data-testid=permission-members\\.read]')).not.toBeChecked();
  await page.check('[data-testid=permission-members\\.read]');
  await page.click('[data-testid=simpan-permission]');
  await expect(page.locator('[data-testid=pesan-sukses]')).toContainText('permission role disimpan');
  await expect(page.locator('[data-testid=permission-members\\.read]')).toBeChecked();
  // Permission platform tidak pernah ditawarkan ke tenant.
  await expect(page.locator('[data-testid^=permission-platform\\.]')).toHaveCount(0);

  // 4c. Assign ke Alpha User lewat layar anggota.
  await page.click('[data-testid=nav-members]');
  await page.locator('tr', { hasText: 'Alpha User' }).locator('[data-testid=anggota-detail]').click();
  await expect(page.locator('[data-testid=anggota-nama]')).toHaveText('Alpha User');
  await page.check(`[data-testid=role-${kode}]`);
  await page.click('[data-testid=simpan-role]');
  await expect(page.locator('[data-testid=pesan-sukses]')).toContainText('Role anggota diperbarui');

  // 5. Mengundang email baru DENGAN role yang dituju; undangan diterima lewat
  // outbox (kanal provisioning demo), lalu anggota baru tampil dengan role itu.
  const sebelum = isiOutbox();
  await page.click('[data-testid=nav-invitations]');
  await page.fill('#invite-email', email);
  await page.check(`[data-testid=undangan-role-${kode}]`);
  await page.click('[data-testid=invite-submit]');
  await expect(page.locator('[data-testid=pesan-sukses]')).toContainText('Undangan dikirim');
  const tautan = await suratBaru(sebelum);

  const ctx = await browser.newContext();
  const tamu = await ctx.newPage();
  await tamu.goto(`${tautan.pathname}${tautan.search}`);
  await tamu.fill('#displayName', `Anggota Baru ${RUN}`);
  await tamu.fill('#password', pass);
  await tamu.click('[data-testid=accept-submit]');
  await expect(tamu).toHaveURL(/\/invite\/diterima$/);

  await page.click('[data-testid=nav-members]');
  const baris = page.locator('tr', { hasText: `Anggota Baru ${RUN}` });
  await expect(baris).toContainText(`Demo ${RUN}`);

  // Anggota baru benar-benar memegang haknya: tautan anggota muncul untuknya.
  await login(tamu, email, pass);
  await expect(tamu.locator('[data-testid=nav-members]')).toBeVisible();
  await tamu.goto('/administration/members');
  await expect(tamu.locator('[data-testid=members-table]')).toBeVisible();
  await ctx.close();

  // Alpha User dikembalikan ke keadaan seed: tes berikutnya (dan tes API slice 10)
  // memeriksa hak akun seed SECARA PERSIS, jadi role demo tidak boleh tertinggal.
  await page.click('[data-testid=nav-members]');
  await page.locator('tr', { hasText: 'Alpha User' }).locator('[data-testid=anggota-detail]').click();
  await page.uncheck(`[data-testid=role-${kode}]`);
  await page.click('[data-testid=simpan-role]');
  await expect(page.locator('[data-testid=pesan-sukses]')).toBeVisible();

  // 6. Perubahan menghasilkan audit event - dan tidak satu pun memuat email.
  const baris_audit = await db<{ event_type: string; j: string }>(
    `SELECT event_type, row_to_json(a)::text AS j FROM audit_logs a WHERE occurred_at >= $1`,
    [mulai],
  );
  const jenis = new Set(baris_audit.map((r) => r.event_type));
  for (const e of ['role.created', 'role.permissions_replaced', 'member.roles_replaced', 'invitation.created', 'invitation.accepted']) {
    expect(jenis.has(e), `kejadian ${e} tidak tercatat`).toBe(true);
  }
  expect(baris_audit.map((r) => r.j).join('\n')).not.toContain(email);
});

test('2. skenario demo 2 - hak yang baru diberikan langsung berlaku, tanpa masuk ulang', async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  const kode = `lihat12_${RUN}`;
  const email = `web12b-${RUN}@test.demo`;
  const pass = `Biasa#${RUN}xyz`;

  // Pemeran "Alpha User" dibuat lewat undangan dengan role seed tenant_user,
  // bukan memakai akun seed user@alpha.demo. Alasannya praktis: tes API sengaja
  // mengunci akun itu selama lima menit (rate limiting), sehingga tes browser
  // yang memakainya gagal atau tidak, tergantung urutan menjalankan suite - dan
  // tes yang hasilnya bergantung pada urutan tidak menjaga apa pun.
  await login(page, 'owner@alpha.demo');
  const sebelum = isiOutbox();
  await page.click('[data-testid=nav-invitations]');
  await page.fill('#invite-email', email);
  await page.check('[data-testid=undangan-role-tenant_user]');
  await page.click('[data-testid=invite-submit]');
  await expect(page.locator('[data-testid=pesan-sukses]')).toBeVisible();
  const tautan = await suratBaru(sebelum);

  const ctxUser = await browser.newContext();
  const user = await ctxUser.newPage();
  await user.goto(`${tautan.pathname}${tautan.search}`);
  await user.fill('#displayName', `Pengguna Biasa ${RUN}`);
  await user.fill('#password', pass);
  await user.click('[data-testid=accept-submit]');
  await expect(user).toHaveURL(/\/invite\/diterima$/);

  // 1-2. Masuk: tidak ada satu pun tautan administrasi.
  await login(user, email, pass);
  await expect(user.locator('[data-testid=nav-members]')).toHaveCount(0);
  await expect(user.locator('[data-testid=nav-roles]')).toHaveCount(0);
  // Dasbor pun tidak menawarkan pintu masuknya.
  await expect(user.locator('[data-testid=kartu-nav-members]')).toHaveCount(0);
  await expect(user.locator('[data-testid=tanpa-akses]')).toHaveCount(0);

  // 3. Membuka halamannya langsung tetap ditolak - menyembunyikan tautan bukan
  // kontrol akses, dan halaman /403 tidak menyebut permission apa yang kurang.
  await user.goto('/administration/members');
  await expect(user).toHaveURL(/\/403/);
  await expect(user.locator('[data-testid=forbidden]')).toBeVisible();
  expect(await user.locator('body').innerText()).not.toContain('members.read');

  // 4. Owner menambahkan members.read lewat role, di layar.
  await page.click('[data-testid=nav-roles]');
  await page.fill('#role-code', kode);
  await page.fill('#role-name', `Pembaca ${RUN}`);
  await page.click('[data-testid=buat-role-submit]');
  await page.check('[data-testid=permission-members\\.read]');
  await page.click('[data-testid=simpan-permission]');
  await expect(page.locator('[data-testid=pesan-sukses]')).toBeVisible();

  await page.click('[data-testid=nav-members]');
  await page.locator('tr', { hasText: `Pengguna Biasa ${RUN}` }).locator('[data-testid=anggota-detail]').click();
  await expect(page.locator('[data-testid=anggota-nama]')).toHaveText(`Pengguna Biasa ${RUN}`);
  const versiSebelum = await page.locator('[data-testid=anggota-versi]').innerText();
  await page.check(`[data-testid=role-${kode}]`);
  await page.click('[data-testid=simpan-role]');
  await expect(page.locator('[data-testid=pesan-sukses]')).toBeVisible();

  // Versi yang TAMPIL wajib ikut segar sesudah penyimpanan berhasil.
  //
  // Kasus ini pernah gagal dua kali dengan gejala yang menyesatkan: centang role
  // masih tercentang setelah dicabut, seolah pencabutan tidak tersimpan. Sebabnya
  // bukan pencabutan itu, melainkan penyimpanan KEDUA dari formulir yang sama
  // mengirim `version` yang sudah basi, lalu ditolak 409 - dan optimistic locking
  // memang menolak, itu perilaku yang benar. Yang tidak benar adalah formulirnya
  // masih memegang versi lama: `revalidatePath` menyegarkan halaman ini, tetapi
  // tidak selalu sebelum klik berikutnya terjadi (D-44).
  //
  // Pemeriksaan ini menunggu (toHaveText mengulang sampai timeout), jadi
  // penyegaran yang lambat tetap lulus; yang gagal adalah versi yang TIDAK pernah
  // segar - dan pesannya menyebut sebab yang sebenarnya.
  await expect(page.locator('[data-testid=anggota-versi]')).not.toHaveText(versiSebelum);

  // 5. Tanpa masuk ulang: muat ulang saja, tautan muncul dan halamannya terbuka
  // read-only (tanpa form undangan, tanpa editor role).
  await user.goto('/dashboard');
  await expect(user.locator('[data-testid=nav-members]')).toBeVisible();
  await user.click('[data-testid=nav-members]');
  await expect(user.locator('[data-testid=members-table]')).toBeVisible();
  await expect(user.locator('[data-testid=nav-roles]')).toHaveCount(0);
  await user.goto('/administration/invitations');
  await expect(user.locator('[data-testid=invitations-table]')).toBeVisible();
  await expect(user.locator('[data-testid=invite-section]')).toHaveCount(0);

  // Dan mencabutnya kembali juga langsung berlaku. Keadaan centang yang
  // diperiksa, bukan pesan sukses: pesan dari penyimpanan SEBELUMNYA masih ada
  // di alamat halaman, jadi ia akan lulus walau penyimpanan kedua tidak terjadi.
  //
  // Centangnya diperiksa SESUDAH muat ulang, dan itu bukan kehati-hatian
  // berlebihan: tanpa muat ulang, `not.toBeChecked()` lulus seketika karena klik
  // uncheck() sudah mengubah DOM di browser - tes tidak menunggu penyimpanan
  // sampai ke server sama sekali. Akibatnya baris berikutnya kadang membaca hak
  // yang belum dicabut, dan kasus ini gagal di mesin target sementara lulus di
  // lingkungan pengembangan. Muat ulang memaksa halaman dirender ULANG di server,
  // jadi centang yang kosong berarti pencabutan memang sudah tersimpan.
  await page.uncheck(`[data-testid=role-${kode}]`);
  await page.click('[data-testid=simpan-role]');
  await page.reload();
  await expect(page.locator(`[data-testid=role-${kode}]`)).not.toBeChecked();
  await user.goto('/administration/members');
  await expect(user).toHaveURL(/\/403/);
  await ctxUser.close();
});

test('3. state layar: sukses, kosong, tidak ditemukan, bentrok versi, dan konfirmasi', async ({ page }) => {
  await login(page, 'owner@alpha.demo');

  // Empty state: filter yang tidak cocok dengan siapa pun.
  await page.goto(`/administration/members?email=tidak-ada-${RUN}@test.demo`);
  await expect(page.locator('[data-testid=anggota-kosong]')).toBeVisible();
  await page.click('[data-testid=filter-bersihkan]');
  await expect(page.locator('[data-testid=members-table]')).toBeVisible();

  // Tidak ditemukan: id yang sah bentuknya, tetapi bukan milik tenant ini.
  await page.goto('/administration/members/e1e1e1e1-0000-0000-0000-000000000009');
  await expect(page).toHaveURL(/\/administration\/members\?gagal=hilang/);
  await expect(page.locator('[data-testid=pesan-halaman-gagal]')).toBeVisible();

  // Bentrok versi: dua halaman membuka anggota yang sama, yang kedua menyimpan
  // lebih dulu, lalu yang pertama mengirim versi yang sudah basi.
  await page.click('[data-testid=nav-members]');
  await page.locator('tr', { hasText: 'Alpha User' }).locator('[data-testid=anggota-detail]').click();
  // Alamat dibaca SETELAH halaman detail benar-benar terbuka: page.url() tepat
  // setelah klik masih mengembalikan alamat daftar.
  await expect(page.locator('[data-testid=anggota-nama]')).toHaveText('Alpha User');
  const url = page.url();
  const versiAwal = await page.locator('[data-testid=anggota-versi]').innerText();

  const kedua = await page.context().newPage();
  await kedua.goto(url);
  await kedua.fill('#displayName', 'Alpha User');
  await kedua.click('[data-testid=simpan-nama]');
  await expect(kedua.locator('[data-testid=pesan-sukses]')).toBeVisible();
  await expect(kedua.locator('[data-testid=anggota-versi]')).not.toHaveText(versiAwal);
  await kedua.close();

  await page.fill('#displayName', 'Alpha User');
  await page.click('[data-testid=simpan-nama]');
  await expect(page.locator('[data-testid=pesan-gagal]')).toContainText('berubah sejak halaman dimuat');
  // Keadaan terbaru ikut ditampilkan, bukan versi basi yang tadi gagal.
  await expect(page.locator('[data-testid=anggota-versi]')).not.toHaveText(versiAwal);

  // Bentrok juga dijaga di LANGKAH KONFIRMASI: tautan membawa versi yang dilihat,
  // dan versi itu sudah basi setelah penyimpanan di halaman kedua tadi.
  const detail = page.url();
  const versiBasi = Number(await page.locator('[data-testid=anggota-versi]').innerText()) - 1;
  await page.goto(`${detail.split('?')[0]}/konfirmasi?aksi=tangguhkan&versi=${versiBasi}`);
  await expect(page).toHaveURL(/gagal=bentrok/);
  await expect(page.locator('[data-testid=pesan-halaman-gagal]')).toContainText('berubah sejak halaman dimuat');

  // Konfirmasi aksi berdampak besar menyebut tenant aktif dan akibatnya.
  await page.click('[data-testid=aksi-tangguhkan]');
  await expect(page.locator('[data-testid=konfirmasi-tenant]')).toHaveText('Tenant Alpha');
  await expect(page.locator('[data-testid=konfirmasi-ringkas]')).toContainText('Alpha User');
  await page.click('[data-testid=konfirmasi-batal]');
  await expect(page.locator('[data-testid=anggota-status]')).toHaveText('Aktif');

  // Dijalankan: status berubah, lalu dipulihkan lewat jalur yang sama.
  await page.click('[data-testid=aksi-tangguhkan]');
  await page.click('[data-testid=konfirmasi-ya]');
  await expect(page.locator('[data-testid=pesan-halaman]')).toContainText('ditangguhkan');
  await expect(page.locator('[data-testid=anggota-status]')).toHaveText('Ditangguhkan');

  await page.click('[data-testid=aksi-aktifkan]');
  await page.click('[data-testid=konfirmasi-ya]');
  await expect(page.locator('[data-testid=pesan-halaman]')).toContainText('diaktifkan kembali');
  await expect(page.locator('[data-testid=anggota-status]')).toHaveText('Aktif');
});

test('4. paginasi: halaman kedua berisi sisanya, tanpa tumpang tindih', async ({ page }) => {
  await login(page, 'owner@alpha.demo');

  // Ukuran halaman dikecilkan lewat URL supaya paginasi teruji tanpa membuat
  // puluhan anggota palsu. Jumlah anggota TIDAK dipatok di tes: berkas ini
  // menambah anggota lewat undangan, dan angka tetap akan membuat kasus ini
  // gagal karena urutan tes, bukan karena paginasinya rusak.
  await page.goto('/administration/members?limit=2');
  const baris = page.locator('[data-testid=members-table] tbody tr td:first-child');
  await expect(baris).toHaveCount(2);
  const halaman1 = await baris.allInnerTexts();
  const ringkas = await page.locator('[data-testid=paginasi]').innerText();
  const total = Number(/dari (\d+)/.exec(ringkas)![1]);
  expect(total, 'paginasi hanya berarti bila anggotanya lebih dari satu halaman').toBeGreaterThan(2);
  expect(ringkas).toContain('1-2 dari');
  await expect(page.locator('[data-testid=paginasi-sebelumnya]')).toHaveCount(0);

  await page.click('[data-testid=paginasi-berikutnya]');
  await expect(page.locator('[data-testid=paginasi]')).toContainText('3-');
  const halaman2 = await baris.allInnerTexts();
  expect(halaman2.length).toBeGreaterThan(0);
  // Tidak ada nama yang muncul di dua halaman - itulah gunanya offset.
  expect(halaman1.filter((n) => halaman2.includes(n))).toEqual([]);

  // Halaman terakhir tidak menawarkan "Berikutnya".
  await page.goto(`/administration/members?limit=2&offset=${Math.max(0, total - 1)}`);
  await expect(page.locator('[data-testid=paginasi-berikutnya]')).toHaveCount(0);

  // Filter ikut terbawa saat berpindah halaman, bukan hilang diam-diam.
  await page.goto('/administration/members?limit=2&status=ACTIVE');
  await page.click('[data-testid=paginasi-berikutnya]');
  await expect(page).toHaveURL(/status=ACTIVE/);
  await expect(page).toHaveURL(/limit=2/);
  await page.click('[data-testid=paginasi-sebelumnya]');
  await expect(page.locator('[data-testid=paginasi]')).toContainText('1-2 dari');
});

test('5. loading state, navigasi keyboard, dan viewport ponsel', async ({ page }) => {
  await login(page, 'owner@alpha.demo');

  // Loading state (sec.12.1). Yang diperiksa adalah mekanismenya: server
  // mengalirkan kerangka "Memuat..." LEBIH DULU, lalu isinya menyusul setelah
  // API menjawab. Diperiksa pada badan respons, bukan dengan menahan permintaan
  // lalu mengintip layar: cara itu bergantung pada apakah halaman sudah
  // ter-hydrate dan pada prefetch Next, dan tes yang bergantung pada keduanya
  // lulus atau gagal karena waktu, bukan karena kode yang dijaganya.
  const res = await page.request.get('/administration/roles');
  const html = await res.text();
  expect(html, 'kerangka memuat tidak dikirim lebih dulu').toContain('data-testid="memuat"');
  expect(html, 'isi halaman ikut di potongan pertama - berarti tidak dialirkan').not.toContain(
    'data-testid="roles-table"',
  );
  // Dan isinya memang menyusul di layar, bukan berhenti di kerangka.
  await page.goto('/administration/roles');
  await expect(page.locator('[data-testid=roles-table]')).toBeVisible();
  await expect(page.locator('[data-testid=memuat]')).toHaveCount(0);

  // Keyboard: tautan navigasi dapat dicapai dengan Tab dan dijalankan dengan Enter.
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid=nav-members]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/administration\/members$/, { timeout: 15_000 });
  // Dan Tab dari awal halaman benar-benar sampai ke navigasi: tautan yang hanya
  // dapat diklik mouse tidak memenuhi syarat keyboard navigation (sec.12.1).
  await expect(page.locator('[data-testid=members-table]')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Tab');
  let sampai = '';
  for (let i = 0; i < 12 && !sampai.startsWith('nav-'); i++) {
    sampai = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    if (!sampai.startsWith('nav-')) await page.keyboard.press('Tab');
  }
  expect(sampai, 'navigasi tidak tercapai dengan Tab').toMatch(/^nav-/);

  // Viewport ponsel: isi tetap terbaca tanpa gulir mendatar di seluruh halaman.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/administration/members');
  await expect(page.locator('[data-testid=members-table]')).toBeVisible();
  const meluber = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(meluber, 'halaman meluber ke samping di viewport ponsel').toBe(false);
});

test('6. hak yang dicabut saat formulir terbuka: aksinya ditolak, dan pengguna tidak dikeluarkan', async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  const kode = `ubah12_${RUN}`;
  const email = `web12c-${RUN}@test.demo`;
  const pass = `Ubah#${RUN}xyz`;

  // Kasus yang tidak dapat diuji lewat tombol: formulir sudah terbuka, lalu
  // haknya dicabut. Menyembunyikan tombol tidak menolong di sini - yang menolak
  // adalah API, dan halaman harus menanganinya tanpa mengusir penggunanya.
  await login(page, 'owner@alpha.demo');
  await page.click('[data-testid=nav-roles]');
  await page.fill('#role-code', kode);
  await page.fill('#role-name', `Pengubah ${RUN}`);
  await page.click('[data-testid=buat-role-submit]');
  await page.check('[data-testid=permission-members\\.read]');
  await page.check('[data-testid=permission-members\\.update_profile]');
  await page.click('[data-testid=simpan-permission]');
  await expect(page.locator('[data-testid=permission-members\\.update_profile]')).toBeChecked();
  const alamatRole = page.url();

  const sebelum = isiOutbox();
  await page.click('[data-testid=nav-invitations]');
  await page.fill('#invite-email', email);
  await page.check(`[data-testid=undangan-role-${kode}]`);
  await page.click('[data-testid=invite-submit]');
  await expect(page.locator('[data-testid=pesan-sukses]')).toBeVisible();
  const tautan = await suratBaru(sebelum);

  const ctx = await browser.newContext();
  const user = await ctx.newPage();
  await user.goto(`${tautan.pathname}${tautan.search}`);
  await user.fill('#displayName', `Pengubah ${RUN}`);
  await user.fill('#password', pass);
  await user.click('[data-testid=accept-submit]');
  await expect(user).toHaveURL(/\/invite\/diterima$/);

  // Formulir dibuka selagi haknya masih ada.
  await login(user, email, pass);
  await user.click('[data-testid=nav-members]');
  await user.locator('tr', { hasText: `Pengubah ${RUN}` }).locator('[data-testid=anggota-detail]').click();
  await expect(user.locator('[data-testid=simpan-nama]')).toBeVisible();

  // Hak dicabut owner, sementara formulir tadi masih terbuka.
  await page.goto(alamatRole);
  await page.uncheck('[data-testid=permission-members\\.update_profile]');
  await page.click('[data-testid=simpan-permission]');
  await expect(page.locator('[data-testid=permission-members\\.update_profile]')).not.toBeChecked();

  // Kirim: ditolak API, halaman /403, dan sesinya TETAP hidup.
  await user.fill('#displayName', `Pengubah ${RUN} baru`);
  await user.click('[data-testid=simpan-nama]');
  await expect(user).toHaveURL(/\/403/);
  await expect(user.locator('[data-testid=forbidden]')).toBeVisible();
  expect(
    (await ctx.cookies()).some((c) => c.name === 'demo_session'),
    'session dibuang padahal yang kurang hanya hak',
  ).toBe(true);
  await user.click('[data-testid=ke-dashboard]');
  await expect(user).toHaveURL(/\/dashboard$/);
  await ctx.close();
});

test('7. nama role bukan tempat data pribadi (D-26)', async ({ page }) => {
  await login(page, 'owner@alpha.demo');
  await page.click('[data-testid=nav-roles]');

  // Peringatannya ada di layar, bukan hanya di dokumen.
  await expect(page.locator('[data-testid=peringatan-nama-role]')).toContainText('bukan tempat data orang');

  // Alamat email dan deretan angka identitas ditolak, dengan alasan yang terbaca.
  for (const buruk of ['budi@contoh.co.id', 'Budi 3204012501900001']) {
    await page.fill('#role-code', `pd12_${RUN}`);
    await page.fill('#role-name', buruk);
    await page.click('[data-testid=buat-role-submit]');
    await expect(page.locator('[data-testid=pesan-gagal]')).toContainText('label');
    await expect(page.locator(`[data-testid=role-baris-pd12_${RUN}]`)).toHaveCount(0);
  }

  // Kontrol: label biasa dengan angka pendek tetap dibuat.
  await page.fill('#role-code', `label12_${RUN}`);
  await page.fill('#role-name', 'Supervisor Gudang 2 (shift 3)');
  await page.click('[data-testid=buat-role-submit]');
  await expect(page.locator('[data-testid=role-nama]')).toHaveText('Supervisor Gudang 2 (shift 3)');
});
