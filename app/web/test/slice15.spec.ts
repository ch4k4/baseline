import { test, expect, Page } from '@playwright/test';
import path from 'node:path';

/**
 * Slice 15 di browser: navigasi yang seluruhnya datang dari `GET /me/menu`
 * (DEMO-0405).
 *
 * Yang dijaga di sini adalah hal yang hanya terlihat di layar: bahwa daftar menu di
 * kode web benar-benar sudah HILANG, bukan sekadar tidak dipakai. Kalau ia masih ada
 * sebagai cadangan, kasus 2 akan tetap menampilkan menu administrasi kepada orang
 * yang haknya baru dicabut - dan itulah bentuk kegagalan yang paling mudah lolos.
 *
 * `user@alpha.demo` TIDAK dipakai: akun itu dikunci tes rate limiting slice 6.
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const API = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const ALPHA = '11111111-1111-1111-1111-111111111111';

async function api(method: string, p: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}${p}`, {
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

async function tokenOwner(): Promise<string> {
  const r = await api('POST', '/api/v1/auth/login', {
    email: 'owner@alpha.demo',
    password: PASSWORD,
  });
  if (r.status !== 201) throw new Error(`login owner gagal: ${r.teks}`);
  return r.body.accessToken as string;
}

/** Mencabut seluruh role satu anggota, dan mengembalikannya lewat fungsi yang dikembalikan. */
async function cabutRole(kodeRole: string): Promise<() => Promise<void>> {
  const owner = await tokenOwner();
  const daftar = await api('GET', '/api/v1/members', undefined, owner);
  const target = daftar.body.members.find((m: any) =>
    m.roles.some((r: any) => r.code === kodeRole),
  );
  if (!target) throw new Error(`anggota dengan role ${kodeRole} tidak ditemukan`);
  const semula = target.roles.map((r: any) => r.id);

  const cabut = await api(
    'PUT',
    `/api/v1/members/${target.membership_id}/roles`,
    { roleIds: [], version: target.version },
    owner,
  );
  if (cabut.status !== 200) throw new Error(`pencabutan role gagal: ${cabut.teks}`);

  return async () => {
    const t = await tokenOwner();
    const lagi = await api('GET', '/api/v1/members', undefined, t);
    const kini = lagi.body.members.find((m: any) => m.membership_id === target.membership_id);
    const pulih = await api(
      'PUT',
      `/api/v1/members/${target.membership_id}/roles`,
      { roleIds: semula, version: kini.version },
      t,
    );
    if (pulih.status !== 200) throw new Error(`pemulihan role gagal: ${pulih.teks}`);
  };
}

async function masuk(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
}

test.describe('slice 15 - navigasi dari backend', () => {
  test('1. navigasi tenant dirender dari menu efektif, dengan grup dan urutannya', async ({ page }) => {
    await masuk(page, 'owner@alpha.demo');
    await expect(page).toHaveURL(/\/dashboard$/);

    // Urutan dibaca dari DOM, bukan diperiksa satu per satu: urutan yang salah
    // adalah cacat yang tidak terlihat oleh pemeriksaan keberadaan.
    const nav = page.getByTestId('nav-utama');
    await expect(nav).toBeVisible();
    const teks = (await nav.innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
    expect(teks).toEqual(['Dasbor', 'ADMINISTRASI', 'Anggota', 'Undangan', 'Role', 'Keamanan']);

    // Grup adalah LABEL, bukan tautan: ia tidak boleh dapat diklik.
    const grup = page.getByTestId('nav-grup-administration');
    await expect(grup).toBeVisible();
    expect(await grup.evaluate((el) => el.tagName)).toBe('SPAN');

    // Halaman aktif ditandai, dan penandanya mengikuti route - bukan urutan menu.
    await page.click('[data-testid=nav-roles]');
    await expect(page.getByTestId('roles-table')).toBeVisible();
    await expect(page.getByTestId('nav-roles')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('nav-members')).not.toHaveAttribute('aria-current', 'page');
  });

  test('2. hak yang dicabut menghapus menunya, dan halamannya tetap ditolak', async ({ page }) => {
    const pulihkan = await cabutRole('tenant_auditor');
    try {
      // multi@ ada di dua tenant, jadi ia memilih tempat masuk lebih dulu.
      await masuk(page, 'multi@demo.local');
      await page.click('[data-testid=pilih-alpha]');
      await expect(page).toHaveURL(/\/dashboard$/);

      // Navigasi menyusut menjadi satu butir. Kalau daftar menu di kode web masih
      // ada sebagai cadangan, di sini akan muncul menu administrasi.
      const teks = (await page.getByTestId('nav-utama').innerText())
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(teks).toEqual(['Dasbor']);
      await expect(page.getByTestId('nav-grup-administration')).toHaveCount(0);
      await expect(page.getByTestId('nav-members')).toHaveCount(0);

      // Kartu dasbor membaca sumber yang sama, jadi ia ikut kosong - dan
      // mengatakannya, bukan menampilkan daftar kosong tanpa penjelasan.
      await expect(page.getByTestId('tanpa-akses')).toBeVisible();

      // DAN menu yang hilang bukan kontrol akses: alamatnya tetap ditolak API.
      await page.goto('/administration/roles');
      await expect(page).toHaveURL(/\/403/);
    } finally {
      await pulihkan();
    }
  });

  test('3. kartu dasbor menawarkan hal yang sama dengan navigasi', async ({ page }) => {
    await masuk(page, 'owner@alpha.demo');
    await expect(page).toHaveURL(/\/dashboard$/);

    // Dua tempat, satu sumber. Sebelum slice 15 keduanya membaca daftar tetap yang
    // sama di kode; sekarang keduanya membaca menu efektif, dan kasus ini yang
    // menjaga supaya tidak ada yang kembali memelihara daftarnya sendiri.
    for (const kode of ['members', 'invitations', 'roles', 'security']) {
      await expect(page.getByTestId(`kartu-nav-${kode}`)).toBeVisible();
    }
    // Dasbor tidak menawarkan dirinya sendiri.
    await expect(page.getByTestId('kartu-nav-dashboard')).toHaveCount(0);
  });

  test('4. konsol platform mendapat navigasinya sendiri, tanpa menu tenant', async ({ page }) => {
    await masuk(page, 'superadmin@demo.platform');
    await expect(page.getByTestId('context-platform')).toHaveText('Platform');

    const nav = page.getByTestId('nav-platform');
    const teks = (await nav.innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
    expect(teks).toEqual(['Admin platform', 'Sesi dukungan']);

    // Tidak ada sisa navigasi tenant di konsol platform.
    await expect(page.getByTestId('nav-utama')).toHaveCount(0);
    await expect(page.getByTestId('nav-members')).toHaveCount(0);

    await page.click('[data-testid=nav-platform-support]');
    await expect(page.getByTestId('buka-sesi')).toBeVisible();
    await expect(page.getByTestId('nav-platform-support')).toHaveAttribute('aria-current', 'page');
  });
});
