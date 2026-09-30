import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { bootstrap } from '../src/main.js';

/**
 * Tes slice 15 - DEMO-0401/0402/0403/0405: menu sebagai DATA, dan resolver menu
 * efektif.
 *
 * Yang dibuktikan di sini:
 *
 *   * navigasi datang dari backend dan mengikuti permission EFEKTIF, bukan nama
 *     role dan bukan daftar di kode frontend;
 *   * menu tanpa pemetaan permission tidak terlihat (deny-by-default), kecuali yang
 *     ditandai terbuka bagi session sah;
 *   * grup tanpa route dipangkas bila tidak punya anak yang terlihat;
 *   * perubahan hak berlaku pada permintaan BERIKUTNYA, tanpa masuk ulang;
 *   * ketiga context (tenant, platform, support) mendapat navigasi yang berbeda,
 *     dan yang membedakannya policy database - bukan cabang di kode;
 *   * keluaran TIDAK memuat kode permission: navigasi bukan tempat membocorkan peta
 *     hak akses;
 *   * menu yang disembunyikan BUKAN kontrol akses - route-nya tetap 403;
 *   * validasi hierarki dan route ditegakkan DATABASE (diuji lewat koneksi
 *     superuser, karena app_user memang tidak punya hak tulis sama sekali).
 *
 * `user@alpha.demo` TIDAK dipakai: akun itu dikunci tes rate limiting slice 6, dan
 * tes yang memakainya lulus atau gagal tergantung urutan suite.
 */

const PORT = Number(process.env.TEST_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';
const SENTINEL = '00000000-0000-0000-0000-000000000000';
const SUPERADMIN_EMAIL = 'superadmin@demo.platform';
const R_ALPHA_ROLES_ONLY = null; // dibuat per run, lihat di bawah
const RUN = randomBytes(3).toString('hex');

let app: any;
let db: Client;
let ownerAlpha: string;
let auditorAlpha: string;
let platform: string;

async function http(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    body: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })() as any,
  };
}

async function login(email: string, tenantId?: string): Promise<string> {
  const r = await http('POST', '/api/v1/auth/login', { email, password: PASSWORD });
  assert.equal(r.status, 201, `login ${email} gagal: ${r.text}`);
  if (r.body.status === 'SESSION') return r.body.accessToken;
  const s = await http('POST', '/api/v1/auth/select-context', { ticket: r.body.ticket, tenantId });
  assert.equal(s.status, 201, s.text);
  return s.body.accessToken;
}

/** Bentuk yang mudah dibandingkan: "kode(anak1,anak2)". */
function bentuk(menu: any[]): string {
  return menu
    .map((m: any) => (m.children.length > 0 ? `${m.code}(${bentuk(m.children)})` : m.code))
    .join(',');
}

async function menu(token: string): Promise<any[]> {
  const r = await http('GET', '/api/v1/me/menu', undefined, token);
  assert.equal(r.status, 200, `GET /me/menu gagal: ${r.text}`);
  return r.body.menu;
}

before(async () => {
  process.env.PORT = String(PORT);
  app = await bootstrap(PORT);
  db = new Client({
    host: process.env.DEMO_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DEMO_DB_PORT ?? 5432),
    database: process.env.DEMO_DB_NAME ?? 'saas_demo',
    user: process.env.DEMO_DB_SUPER ?? 'postgres',
    password: process.env.DEMO_DB_SUPER_PASSWORD,
  });
  await db.connect();

  ownerAlpha = await login('owner@alpha.demo', ALPHA);
  auditorAlpha = await login('multi@demo.local', ALPHA);
  platform = await login(SUPERADMIN_EMAIL);
});

after(async () => {
  if (db) {
    // Sesi support yang mungkin tertinggal dibersihkan lebih dulu (arah FK).
    await db.query('DELETE FROM tenant_notifications');
    await db.query('DELETE FROM support_sessions');
    // Menu yang dibuat tes dibersihkan, DAN kebersihannya dibuktikan: menus adalah
    // keadaan bersama, dan tes yang meninggalkan jejak di keadaan bersama membuat
    // tes lain lulus atau gagal karena sebab yang tidak ada di dalamnya.
    await db.query('DELETE FROM menu_permissions WHERE tenant_id IS NOT NULL');
    await db.query('DELETE FROM menus WHERE tenant_id IS NOT NULL');
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM menus WHERE tenant_id IS NOT NULL',
    );
    assert.equal(rows[0].n, 0, 'pembersihan menu tes tidak tuntas');
    // Menu seed tidak boleh ikut terhapus.
    const { rows: seed } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM menus');
    assert.equal(seed[0].n, 8, 'menu seed berubah jumlahnya setelah tes');
  }
  await db?.end();
  await app?.close();
});

describe('slice 15 - menu sebagai data dan resolver menu efektif', () => {
  test('1. owner mendapat pohon lengkap, terurut, tanpa kebocoran permission', async () => {
    const m = await menu(ownerAlpha);

    // Urutan mengikuti sort_order, bukan urutan baris database.
    assert.equal(bentuk(m), 'dashboard,administration(members,invitations,roles,security)');

    const dasbor = m[0];
    assert.deepEqual(Object.keys(dasbor).sort(), ['children', 'code', 'icon', 'label', 'path']);
    assert.equal(dasbor.label, 'Dasbor');
    assert.equal(dasbor.path, '/dashboard');

    // Grup tanpa route: path null, dan anaknya yang membawa route.
    const grup = m[1];
    assert.equal(grup.path, null);
    assert.equal(grup.children.length, 4);

    // TIDAK ada kode permission, id, sort_order, maupun penanda internal di mana pun.
    const teks = JSON.stringify(m);
    for (const bocor of ['permission', 'members.read', 'audit.read', 'sort_order', 'is_active', 'id']) {
      assert.ok(!teks.includes(bocor), `keluaran menu memuat "${bocor}"`);
    }
  });

  test('2. anggota tanpa hak administrasi hanya melihat dasbor, dan grupnya dipangkas', async () => {
    // Yang diperlukan kasus ini adalah session TANPA hak administrasi. Jalannya
    // BUKAN membuat anggota baru lewat undangan (itu sudah diuji slice 9 dan
    // meninggalkan jejak di keadaan bersama), melainkan mencabut role anggota yang
    // ada lalu memulihkannya - satu-satunya akun seed tanpa hak administrasi adalah
    // akun yang dikunci tes rate limiting.
    //
    // Versi pertama kasus ini membuat undangan yang tidak pernah dipakai, lalu
    // menghapus SELURUH undangan PENDING untuk merapikannya - termasuk undangan
    // SEED, yang menggagalkan tes slice 9 #11. Data seed bukan milik tes mana pun.

    // Auditor dipakai sebagai kontrol: ia PUNYA hak, jadi menunya lengkap.
    const auditor = await menu(auditorAlpha);
    assert.equal(bentuk(auditor), 'dashboard,administration(members,invitations,roles,security)');

    // Lalu seluruh role auditor dicabut lewat API oleh owner, dan menunya menyusut.
    const daftar = await http('GET', '/api/v1/members', undefined, ownerAlpha);
    const target = daftar.body.members.find((x: any) =>
      x.roles.some((r: any) => r.code === 'tenant_auditor'),
    );
    assert.ok(target, 'anggota auditor tidak ditemukan');
    const cabut = await http(
      'PUT',
      `/api/v1/members/${target.membership_id}/roles`,
      { roleIds: [], version: target.version },
      ownerAlpha,
    );
    assert.equal(cabut.status, 200, cabut.text);

    try {
      // Permintaan BERIKUTNYA dengan token yang SAMA sudah melihat perubahannya:
      // tidak ada cache, dan tidak perlu masuk ulang.
      assert.equal(bentuk(await menu(auditorAlpha)), 'dashboard');
    } finally {
      const lagi = await http('GET', '/api/v1/members', undefined, ownerAlpha);
      const sekarang = lagi.body.members.find(
        (x: any) => x.membership_id === target.membership_id,
      );
      const pulih = await http(
        'PUT',
        `/api/v1/members/${target.membership_id}/roles`,
        { roleIds: target.roles.map((r: any) => r.id), version: sekarang.version },
        ownerAlpha,
      );
      assert.equal(pulih.status, 200, pulih.text);
    }
  });

  test('3. menu yang disembunyikan bukan kontrol akses: route-nya tetap 403', async () => {
    // Inti Demo Foundation sec.10.2 baris kelima. Tanpa kasus ini, "menu hilang"
    // mudah disalahartikan sebagai "halaman terlindungi".
    const daftar = await http('GET', '/api/v1/members', undefined, ownerAlpha);
    const target = daftar.body.members.find((x: any) =>
      x.roles.some((r: any) => r.code === 'tenant_auditor'),
    );
    const cabut = await http(
      'PUT',
      `/api/v1/members/${target.membership_id}/roles`,
      { roleIds: [], version: target.version },
      ownerAlpha,
    );
    assert.equal(cabut.status, 200, cabut.text);

    try {
      assert.equal(bentuk(await menu(auditorAlpha)), 'dashboard');
      // Menunya hilang, tetapi yang menolak tetap API - bukan hilangnya menu.
      for (const path of ['/api/v1/members', '/api/v1/roles', '/api/v1/notifications/security']) {
        const r = await http('GET', path, undefined, auditorAlpha);
        assert.equal(r.status, 403, `${path} seharusnya tetap 403: ${r.text}`);
      }
    } finally {
      const lagi = await http('GET', '/api/v1/members', undefined, ownerAlpha);
      const sekarang = lagi.body.members.find(
        (x: any) => x.membership_id === target.membership_id,
      );
      await http(
        'PUT',
        `/api/v1/members/${target.membership_id}/roles`,
        { roleIds: target.roles.map((r: any) => r.id), version: sekarang.version },
        ownerAlpha,
      );
    }
  });

  test('4. context platform mendapat navigasi konsol, bukan navigasi tenant', async () => {
    const m = await menu(platform);
    assert.equal(bentuk(m), 'platform-admins,platform-support');

    // Dan sebaliknya: session tenant tidak pernah melihat menu konsol platform.
    const tenant = JSON.stringify(await menu(ownerAlpha));
    assert.ok(!tenant.includes('platform'), 'navigasi tenant memuat menu platform');
  });

  test('5. menu milik satu tenant tidak terlihat dari tenant lain', async () => {
    // Menu tenant hanya dapat dibuat lewat koneksi superuser: app_user tidak punya
    // hak tulis, dan administrasi menu adalah P2 yang tidak ada di baseline.
    const id = randomUUID();
    await db.query(
      `INSERT INTO menus (id, tenant_id, context_kind, code, label, path, sort_order, is_public_authenticated)
       VALUES ($1, $2, 'TENANT', $3, 'Khusus Alpha', '/dashboard', 90, true)`,
      [id, ALPHA, `khusus-${RUN}`],
    );

    try {
      const alpha = await menu(ownerAlpha);
      assert.ok(alpha.some((m: any) => m.code === `khusus-${RUN}`), 'Alpha tidak melihat menunya sendiri');

      const betaToken = await login('admin@beta.demo', BETA);
      const beta = await menu(betaToken);
      assert.ok(!beta.some((m: any) => m.code === `khusus-${RUN}`), 'Beta melihat menu Alpha');

      // owner_key terisi dari tenant_id - kolom yang menjadi dasar seluruh FK hierarki.
      const { rows } = await db.query<{ owner_key: string }>(
        'SELECT owner_key FROM menus WHERE id = $1',
        [id],
      );
      assert.equal(rows[0].owner_key, ALPHA);
    } finally {
      // Dibersihkan di sini, bukan hanya di `after`: menu ini TERLIHAT (ditandai
      // terbuka), jadi ia ikut masuk ke navigasi kasus lain dan membuat harapan
      // mereka bergantung pada urutan tes. Kasus yang menambah data bersama
      // merapikannya sendiri.
      await db.query('DELETE FROM menus WHERE id = $1', [id]);
    }
  });

  test('6. validasi hierarki dan route ditegakkan database, bukan aplikasi', async () => {
    const induk = randomUUID();
    const anak = randomUUID();
    await db.query(
      `INSERT INTO menus (id, tenant_id, context_kind, code, label, sort_order)
       VALUES ($1, $2, 'TENANT', $3, 'Induk Uji', 91)`,
      [induk, ALPHA, `induk-${RUN}`],
    );
    await db.query(
      `INSERT INTO menus (id, tenant_id, context_kind, parent_id, code, label, path, sort_order)
       VALUES ($1, $2, 'TENANT', $3, $4, 'Anak Uji', '/dashboard', 92)`,
      [anak, ALPHA, induk, `anak-${RUN}`],
    );

    const tolak = async (sql: string, params: unknown[], harapan: string, kenapa: string) => {
      await assert.rejects(
        () => db.query(sql, params),
        (e: any) => {
          assert.equal(e.code, harapan, `${kenapa}: kode ${e.code}, harusnya ${harapan}`);
          return true;
        },
        kenapa,
      );
    };

    // Menjadi induk diri sendiri: CHECK.
    await tolak(
      `UPDATE menus SET parent_id = id WHERE id = $1`,
      [anak],
      '23514',
      'menu menjadi induk dirinya sendiri',
    );

    // Siklus dua tingkat: trigger penjaga hierarki. Kasus ini juga membuktikan
    // trigger itu TIDAK BUTA - kalau SELECT di dalamnya membaca nol baris karena
    // FORCE RLS, ia akan meloloskan siklus tanpa pesan apa pun.
    await tolak(
      `UPDATE menus SET parent_id = $2 WHERE id = $1`,
      [induk, anak],
      '23514',
      'siklus induk-anak',
    );

    // Induk dari tenant LAIN: composite FK (owner_key, parent_id).
    const indukBeta = randomUUID();
    await db.query(
      `INSERT INTO menus (id, tenant_id, context_kind, code, label, sort_order)
       VALUES ($1, $2, 'TENANT', $3, 'Induk Beta', 93)`,
      [indukBeta, BETA, `indukbeta-${RUN}`],
    );
    await tolak(
      `UPDATE menus SET parent_id = $2 WHERE id = $1`,
      [anak, indukBeta],
      '23503',
      'induk lintas tenant',
    );

    // Route di luar allowlist: skema yang dapat dieksekusi, URL absolut, dan
    // penelusuran direktori. Ketiganya ditolak CHECK yang sama.
    for (const jahat of ['javascript:alert(1)', 'https://contoh.co.id', '//contoh.co.id', '/../etc', 'DASHBOARD']) {
      await tolak(
        `UPDATE menus SET path = $2 WHERE id = $1`,
        [anak, jahat],
        '23514',
        `route "${jahat}" diterima`,
      );
    }

    // Scope permission wajib cocok dengan context menu: menu tenant tidak dapat
    // dipetakan ke permission platform, dan sebaliknya.
    await tolak(
      `INSERT INTO menu_permissions (tenant_id, menu_id, context_kind, permission_code, permission_scope)
       VALUES ($1, $2, 'TENANT', 'platform.admins.read', 'PLATFORM')`,
      [ALPHA, anak],
      '23514',
      'permission platform pada menu tenant',
    );

    // Dan permission yang tidak ada di katalog tetap ditolak foreign key.
    await tolak(
      `INSERT INTO menu_permissions (tenant_id, menu_id, context_kind, permission_code, permission_scope)
       VALUES ($1, $2, 'TENANT', 'tidak.ada', 'TENANT')`,
      [ALPHA, anak],
      '23503',
      'permission di luar katalog',
    );

    // Kasus ini membersihkan barisnya SENDIRI, tidak menunggu `after`.
    //
    // Sebabnya ditemukan uji mutasi R1: `anak-*` di atas adalah menu ber-route TANPA
    // pemetaan permission, dan selama ia tertinggal, kasus 9 ikut menjaga
    // deny-by-default - dengan data yang dibuat kasus lain untuk keperluan lain.
    // Mutasi yang mengubah deny-by-default menjadi allow-by-default karena itu
    // "tertangkap" oleh kasus yang tidak memiliki perilaku itu. Penjaganya sekarang
    // dinyatakan sendiri di kasus 10; di sini yang diperbaiki adalah sebabnya:
    // keadaan bersama tidak boleh menyeberang antar kasus di dalam satu run.
    await db.query(`DELETE FROM menu_permissions WHERE menu_id IN ($1, $2, $3)`, [
      induk,
      anak,
      indukBeta,
    ]);
    await db.query(`DELETE FROM menus WHERE id IN ($1, $2, $3)`, [anak, induk, indukBeta]);
  });

  test('7. menu tidak aktif dan pemetaan ALL diuji, bukan hanya didukung di kode', async () => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO menus (id, tenant_id, context_kind, code, label, path, sort_order, is_active)
       VALUES ($1, $2, 'TENANT', $3, 'Nonaktif', '/dashboard', 94, false)`,
      [id, ALPHA, `nonaktif-${RUN}`],
    );
    await db.query(
      `INSERT INTO menu_permissions (tenant_id, menu_id, context_kind, permission_code, permission_scope)
       VALUES ($1, $2, 'TENANT', 'members.read', 'TENANT')`,
      [ALPHA, id],
    );
    assert.ok(
      !(await menu(ownerAlpha)).some((m: any) => m.code === `nonaktif-${RUN}`),
      'menu tidak aktif tetap muncul',
    );

    // match_mode ALL: pemegang SALAH SATU permission tidak cukup.
    const semua = randomUUID();
    await db.query(
      `INSERT INTO menus (id, tenant_id, context_kind, code, label, path, sort_order)
       VALUES ($1, $2, 'TENANT', $3, 'Butuh Dua', '/dashboard', 95)`,
      [semua, ALPHA, `semua-${RUN}`],
    );
    await db.query(
      `INSERT INTO menu_permissions (tenant_id, menu_id, context_kind, permission_code, permission_scope, match_mode)
       VALUES ($1, $2, 'TENANT', 'members.read', 'TENANT', 'ALL'),
              ($1, $2, 'TENANT', 'owners.manage', 'TENANT', 'ALL')`,
      [ALPHA, semua],
    );

    // Owner memegang keduanya: terlihat.
    assert.ok(
      (await menu(ownerAlpha)).some((m: any) => m.code === `semua-${RUN}`),
      'pemegang kedua permission tidak melihat menu ALL',
    );
    // Auditor memegang members.read tetapi bukan owners.manage: TIDAK terlihat.
    assert.ok(
      !(await menu(auditorAlpha)).some((m: any) => m.code === `semua-${RUN}`),
      'ALL diperlakukan seperti ANY',
    );
  });

  test('9. sesi support mendapat navigasi dari himpunan permissionnya, bukan dari membership', async () => {
    // Kasus ini lahir dari uji mutasi R8: mengganti himpunan tetap support dengan
    // permission efektif sebuah membership TIDAK menggagalkan satu tes API pun -
    // sesi support tidak punya membership, jadi hasilnya himpunan kosong dan
    // navigasinya menyusut menjadi satu butir. Yang menangkapnya hanya tes browser
    // slice 14, di lapisan yang tidak memiliki perilaku ini. Penjaganya dipindahkan
    // ke sini.
    const buka = await http(
      'POST',
      '/api/v1/platform/support-sessions',
      {
        tenantId: ALPHA,
        reasonCode: 'TENANT_REPORTED_BUG',
        reasonText: 'Memeriksa navigasi yang dilihat sesi dukungan',
        scope: 'READ_ONLY',
        durationMinutes: 10,
      },
      platform,
    );
    assert.equal(buka.status, 201, buka.text);

    try {
      // SUPPORT_READ_SET memuat members.read, roles.read, dan audit.read, jadi
      // seluruh grup administrasi terlihat - tetapi karena himpunan TETAP, bukan
      // karena sesi ini punya role apa pun di tenant itu.
      assert.equal(
        bentuk(await menu(buka.body.supportToken)),
        'dashboard,administration(members,invitations,roles,security)',
      );
    } finally {
      const akhir = await http(
        'POST',
        `/api/v1/platform/support-sessions/${buka.body.session.id}/end`,
        {},
        platform,
      );
      assert.equal(akhir.status, 200, akhir.text);
    }
  });

  test('10. deny-by-default dan urutan adalah perilaku yang diuji, bukan kebetulan data', async () => {
    // Kedua penjaga di sini lahir dari uji mutasi Bagian A, dan keduanya menutup
    // lubang dengan bentuk yang sama: perilaku yang BENAR di kode, tetapi tidak
    // dijaga satu kasus pun.
    //
    //   * R1 (deny-by-default -> allow-by-default) hanya tertangkap selama kasus 6
    //     meninggalkan menu ber-route tanpa pemetaan. Seed tidak punya menu semacam
    //     itu: satu-satunya menu tak berpemetaan adalah grup (dipangkas) dan dasbor
    //     (ditandai terbuka). Jadi tanpa kasus ini, aturan terpenting sec.10.2 tidak
    //     diuji sama sekali.
    //   * R4 (ORDER BY dihapus) LOLOS seluruh suite: urutan baris seed kebetulan
    //     sama dengan urutan `sort_order`, sehingga "terurut" di kasus 1 terpenuhi
    //     oleh kebetulan. Menu di bawah disisipkan TERAKHIR tetapi harus muncul
    //     PERTAMA - kebetulan itu tidak dapat menolongnya.
    const sepi = randomUUID();
    const awal = randomUUID();
    await db.query(
      `INSERT INTO menus (id, tenant_id, context_kind, code, label, path, sort_order)
       VALUES ($1, $2, 'TENANT', $3, 'Tanpa Pemetaan', '/dashboard', 96),
              ($4, $2, 'TENANT', $5, 'Paling Atas', '/dashboard', 5)`,
      [sepi, ALPHA, `sepi-${RUN}`, awal, `awal-${RUN}`],
    );
    await db.query(
      `INSERT INTO menu_permissions (tenant_id, menu_id, context_kind, permission_code, permission_scope)
       VALUES ($1, $2, 'TENANT', 'members.read', 'TENANT')`,
      [ALPHA, awal],
    );

    try {
      const m = await menu(ownerAlpha);

      // Deny-by-default: owner memegang SELURUH permission tenant, dan tetap tidak
      // melihat menu yang tidak dipetakan ke permission apa pun.
      assert.ok(
        !m.some((x: any) => x.code === `sepi-${RUN}`),
        'menu tanpa pemetaan permission terlihat (deny-by-default tidak berlaku)',
      );

      // Urutan: `sort_order` 5 mendahului dasbor (10), meskipun barisnya disisipkan
      // paling akhir.
      assert.equal(
        m[0].code,
        `awal-${RUN}`,
        `urutan tidak mengikuti sort_order: ${m.map((x: any) => x.code).join(',')}`,
      );
    } finally {
      await db.query(`DELETE FROM menu_permissions WHERE menu_id IN ($1, $2)`, [sepi, awal]);
      await db.query(`DELETE FROM menus WHERE id IN ($1, $2)`, [sepi, awal]);
    }
  });

  test('8. deskripsi katalog menus.read mengatakan untuk apa ia dipakai', async () => {
    // GET /me/menu sengaja TIDAK ber-permission: anggota tanpa role harus tetap
    // mendapat kerangka dan dasbornya. Deskripsi lama ("Melihat menu yang
    // diizinkan") mengundang kekeliruan itu, jadi katalognya dikoreksi di migrasi
    // 0021 - dan koreksi yang tidak diuji akan hilang pada migrasi berikutnya.
    const { rows } = await db.query<{ description: string }>(
      `SELECT description FROM permissions WHERE code = 'menus.read'`,
    );
    assert.match(rows[0].description, /administrasi menu/i);
  });
});
