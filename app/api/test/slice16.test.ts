import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { bootstrap } from '../src/main.js';

/**
 * Tes slice 16 - provisioning tenant (D-17 kunci enkripsi, D-25 role sistem).
 *
 * Sampai slice ini, tenant hanya dapat lahir dari skrip seed: kuncinya dibuat skrip
 * yang memegang KEK dan rolenya ditulis skrip yang sama. Artinya membuat tenant saat
 * runtime MUSTAHIL - syarat paling dasar bagi produk apa pun, dan itulah kenapa ini
 * pekerjaan fondasi, bukan hiasan konsol platform.
 *
 * Yang dibuktikan di sini:
 *
 *   * tenant hasil `POST /platform/tenants` LANGSUNG dapat dipakai - ownernya masuk,
 *     melihat dirinya sebagai anggota, namanya terdekripsi, menunya terbentuk. Inilah
 *     kasus yang membuat "provisioning berhasil" berarti sesuatu; memeriksa baris
 *     database saja akan lulus walau tenantnya tidak dapat dipakai siapa pun;
 *   * kewenangan platform membuat owner LANGSUNG (pengecualian ADR-002 sec.2.2 atas
 *     keputusan pemilik proyek) dibatasi DATABASE, bukan kode: F-28 menolak tenant
 *     yang sudah ACTIVE, tenant yang sudah punya anggota, dan identitas yang tidak
 *     ada. Ketiga penolakan diuji dengan memanggil fungsinya LANGSUNG, karena batas
 *     yang hanya berlaku lewat endpoint bukan batas;
 *   * kegagalan tidak meninggalkan tenant separuh jadi (satu transaksi);
 *   * role owner memuat SELURUH permission tenant yang belum pensiun, DIHITUNG dari
 *     katalog saat provisioning - bukan daftar beku di template;
 *   * audit tercatat di kedua sisi (platform dan tenant) tanpa data pribadi.
 */

const PORT = Number(process.env.TEST_PORT ?? 3212);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';
const SUPERADMIN_EMAIL = 'superadmin@demo.platform';
const ALPHA = '11111111-1111-1111-1111-111111111111';
const RUN = randomBytes(3).toString('hex');

let app: any;
let db: Client;
let platform: string;
/** Identitas yang dipakai sebagai owner tenant baru: sudah ada, ACTIVE, dan bukan superadmin. */
let ownerUserId: string;
let ownerEmail: string;

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
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    })() as any,
  };
}

/** Membuat tenant lewat endpoint platform, dengan slug khas run ini. */
async function buatTenant(nama: string, opsi: Record<string, unknown> = {}) {
  return http(
    'POST',
    '/api/v1/platform/tenants',
    {
      slug: `${nama}-${RUN}`,
      name: `Tenant ${nama} ${RUN}`,
      ownerUserId,
      ownerDisplayName: `Owner ${nama}`,
      ownerContactEmail: `owner-${nama}-${RUN}@contoh.test`,
      ...opsi,
    },
    platform,
  );
}

/**
 * Pembersihan mengikuti arah foreign key, dan urutannya ditemukan dengan cara paling
 * mahal: mencoba menghapus tenant lebih dulu dan ditolak tiga kali berturut-turut
 * (sessions, lalu audit_logs). Ditulis di satu tempat supaya tidak diulang salah.
 */
async function hapusTenantUji() {
  const ids = (
    await db.query<{ id: string }>(`SELECT id FROM tenants WHERE slug LIKE $1`, [`%-${RUN}`])
  ).rows.map((r) => r.id);
  for (const id of ids) {
    await db.query('DELETE FROM audit_logs WHERE tenant_id = $1', [id]);
    await db.query('DELETE FROM refresh_tokens WHERE tenant_id = $1', [id]);
    await db.query('DELETE FROM sessions WHERE tenant_id = $1', [id]);
    await db.query('DELETE FROM user_role_assignments WHERE tenant_id = $1', [id]);
    await db.query('DELETE FROM tenant_member_profiles WHERE tenant_id = $1', [id]);
    await db.query('DELETE FROM tenant_memberships WHERE tenant_id = $1', [id]);
    await db.query('DELETE FROM role_permissions WHERE tenant_id = $1', [id]);
    await db.query('DELETE FROM roles WHERE tenant_id = $1', [id]);
    await db.query('DELETE FROM crypto_keys WHERE tenant_id = $1', [id]);
    await db.query('DELETE FROM tenants WHERE id = $1', [id]);
  }
  await db.query(`DELETE FROM audit_logs WHERE event_type LIKE 'tenant.%' AND tenant_id IS NULL`);
  return ids.length;
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

  const masuk = await http('POST', '/api/v1/auth/login', {
    email: SUPERADMIN_EMAIL,
    password: PASSWORD,
  });
  assert.equal(masuk.status, 201, masuk.text);
  platform = masuk.body.accessToken;

  // Owner tenant baru: Alpha Owner. Identitas yang SUDAH ada, karena platform tidak
  // membuat identitas - itu tetap hanya lewat undangan (F-16).
  //
  // Diambil dari membership SEED yang id-nya tetap, bukan dari "membership pertama
  // tenant Alpha": versi pertama tes ini memakai ORDER BY created_at LIMIT 1 dan
  // mendapat identitas multi@, sementara emailnya ditulis owner@alpha.demo - dua
  // identitas berbeda, dan kasus 1 gagal dengan pesan yang menuding pemilihan context.
  // Identitas owner dan emailnya harus datang dari SATU sumber.
  ownerEmail = 'owner@alpha.demo';
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM tenant_memberships WHERE id = 'a1a1a1a1-0000-0000-0000-000000000001'`,
  );
  assert.equal(rows.length, 1, 'membership seed Alpha Owner tidak ditemukan');
  ownerUserId = rows[0].user_id;
});

after(async () => {
  if (db) {
    await hapusTenantUji();
    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM tenants');
    assert.equal(rows[0].n, 2, 'tenant uji tidak terhapus tuntas (seharusnya tinggal dua tenant seed)');
  }
  await db?.end();
  await app?.close();
});

describe('slice 16 - provisioning tenant', () => {
  test('1. tenant hasil provisioning langsung dapat dipakai ownernya', async () => {
    const dibuat = await buatTenant('alfa');
    assert.equal(dibuat.status, 201, dibuat.text);
    const tenantId = dibuat.body.tenantId;
    assert.equal(dibuat.body.status, 'ACTIVE');
    assert.equal(dibuat.body.roleCount, 4);

    // Kunci: dua purpose tenant, versi 1, dan bentuk envelope-nya benar (byte pertama
    // versi format, panjang 61) - CHECK tabel sudah menuntutnya, di sini yang
    // diperiksa adalah keduanya BENAR-BENAR ada.
    const kunci = await db.query<{ purpose: string; key_version: number }>(
      `SELECT purpose, key_version FROM crypto_keys WHERE tenant_id = $1 ORDER BY purpose`,
      [tenantId],
    );
    assert.deepEqual(
      kunci.rows.map((k) => `${k.purpose} v${k.key_version}`),
      ['identity v1', 'identity_blind_index v1'],
    );

    // Role sistem: empat, seluruhnya is_system, dengan isi permission dari template.
    const role = await db.query<{ code: string; is_system: boolean; n: number }>(
      `SELECT r.code, r.is_system, count(rp.permission_code)::int AS n
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE r.tenant_id = $1 GROUP BY r.code, r.is_system ORDER BY r.code`,
      [tenantId],
    );
    assert.deepEqual(
      role.rows.map((r) => `${r.code}:${r.n}${r.is_system ? '' : ' BUKAN-SISTEM'}`),
      ['tenant_admin:15', 'tenant_auditor:6', 'tenant_owner:16', 'tenant_user:3'],
    );

    // DAN INI YANG MEMBUAT SEMUANYA BERARTI: ownernya dapat masuk dan memakai tenant
    // itu. Memeriksa baris database saja akan lulus walau tenantnya tidak dapat
    // dipakai siapa pun - misalnya karena kuncinya tidak cocok dengan ciphertextnya.
    const masuk = await http('POST', '/api/v1/auth/login', { email: ownerEmail, password: PASSWORD });
    assert.equal(masuk.body.status, 'CONTEXT_REQUIRED', masuk.text);
    const pilih = await http('POST', '/api/v1/auth/select-context', {
      ticket: masuk.body.ticket,
      tenantId,
    });
    assert.equal(pilih.status, 201, pilih.text);

    const anggota = await http('GET', '/api/v1/members', undefined, pilih.body.accessToken);
    assert.equal(anggota.status, 200, anggota.text);
    assert.equal(anggota.body.members.length, 1);
    assert.equal(anggota.body.members[0].display_name, 'Owner alfa');
    assert.deepEqual(
      anggota.body.members[0].roles.map((r: any) => r.code),
      ['tenant_owner'],
    );
    // Pemberi role adalah platform, dan platform tidak punya membership di sini -
    // jejaknya di audit, bukan dipalsukan sebagai anggota.
    const pemberi = await db.query<{ n: number }>(
      `SELECT count(id)::int AS n FROM user_role_assignments
       WHERE tenant_id = $1 AND assigned_by_membership_id IS NOT NULL`,
      [tenantId],
    );
    assert.equal(pemberi.rows[0].n, 0);

    // Menu efektif terbentuk: tenant baru bukan tenant tanpa navigasi.
    const menu = await http('GET', '/api/v1/me/menu', undefined, pilih.body.accessToken);
    assert.equal(menu.status, 200, menu.text);
    assert.ok(
      menu.body.menu.some((m: any) => m.code === 'administration'),
      'tenant baru tidak mendapat grup administrasi',
    );
  });

  test('2. role owner dihitung dari katalog, bukan daftar beku di template', async () => {
    const dibuat = await buatTenant('beta');
    assert.equal(dibuat.status, 201, dibuat.text);

    // Kalau isinya disalin dari template saat migrasi dibuat, permission tenant yang
    // ditambahkan SESUDAH itu tidak akan pernah dipegang owner tenant baru - dan
    // tidak ada yang akan memberitahu.
    const { rows } = await db.query<{ hilang: string[] }>(
      `SELECT coalesce(array_agg(p.code ORDER BY p.code), '{}') AS hilang
       FROM permissions p
       WHERE p.scope = 'TENANT' AND p.retired_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           WHERE r.tenant_id = $1 AND r.code = 'tenant_owner' AND rp.permission_code = p.code
         )`,
      [dibuat.body.tenantId],
    );
    assert.deepEqual(rows[0].hilang, [], 'role owner tenant baru tidak memegang seluruh permission tenant');
  });

  test('3. audit tercatat di kedua sisi, tanpa data pribadi', async () => {
    const dibuat = await buatTenant('gama');
    assert.equal(dibuat.status, 201, dibuat.text);
    const tenantId = dibuat.body.tenantId;

    const { rows } = await db.query<{ event_type: string; tenant_id: string | null; detail: any }>(
      `SELECT event_type, tenant_id, detail FROM audit_logs
       WHERE subject_id IN ($1, $2) AND event_type LIKE 'tenant.%'
       ORDER BY event_type, tenant_id NULLS FIRST`,
      [tenantId, dibuat.body.ownerMembershipId],
    );

    // Empat baris: dua kejadian x dua sisi. Tenant HARUS dapat melihat bahwa anggota
    // pertamanya dibuat platform; kalau hanya audit platform yang mencatatnya,
    // transparansi itu bergantung pada niat platform.
    assert.deepEqual(
      rows.map((r) => `${r.event_type}@${r.tenant_id === null ? 'platform' : 'tenant'}`),
      [
        'tenant.created@platform',
        'tenant.created@tenant',
        'tenant.owner_provisioned@platform',
        'tenant.owner_provisioned@tenant',
      ],
    );

    const teks = JSON.stringify(rows.map((r) => r.detail));
    for (const bocor of ['Owner gama', '@contoh.test', 'password']) {
      assert.ok(!teks.includes(bocor), `detail audit memuat "${bocor}"`);
    }
    assert.ok(teks.includes(ownerUserId), 'audit tidak mencatat identitas yang ditunjuk sebagai owner');
  });

  test('4. kegagalan tidak meninggalkan tenant separuh jadi', async () => {
    const sebelum = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM tenants');

    // Slug ganda: bentrokan, bukan kesalahan server.
    const pertama = await buatTenant('delta');
    assert.equal(pertama.status, 201, pertama.text);
    const kedua = await buatTenant('delta');
    assert.equal(kedua.status, 409, kedua.text);

    // Identitas yang tidak ada: 400, dan tenantnya TIDAK tertinggal. Inilah yang
    // membuktikan satu transaksi - tanpa itu, tenant + kunci + role sudah terpasang
    // sebelum F-28 menolak, dan tidak ada endpoint yang dapat memperbaikinya.
    const hantu = await buatTenant('epsilon', { ownerUserId: randomUUID() });
    assert.equal(hantu.status, 400, hantu.text);
    const sisa = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM tenants WHERE slug = $1`, [
      `epsilon-${RUN}`,
    ]);
    assert.equal(sisa.rows[0].n, 0, 'tenant tertinggal padahal provisioningnya gagal');

    const sesudah = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM tenants');
    assert.equal(sesudah.rows[0].n, sebelum.rows[0].n + 1, 'jumlah tenant tidak sesuai (hanya delta yang jadi)');
  });

  test('5. batas kewenangan platform atas owner ditegakkan DATABASE (F-28)', async () => {
    const dibuat = await buatTenant('zeta');
    assert.equal(dibuat.status, 201, dibuat.text);
    const tenantId = dibuat.body.tenantId;

    // Dipanggil LANGSUNG, bukan lewat endpoint: batas yang hanya berlaku di kode
    // aplikasi bukan batas. Ketiganya harus NULL.
    const panggil = async (idTenant: string, idUser: string) => {
      const { rows } = await db.query<{ hasil: string | null }>(
        `SELECT auth.provision_tenant_owner($1,$2,$3,$4,$5,$6,$7,$8) AS hasil`,
        [idTenant, idUser, randomUUID(), Buffer.alloc(30, 1), 1, Buffer.alloc(30, 1), 1, Buffer.alloc(32, 1)],
      );
      return rows[0].hasil;
    };

    assert.equal(
      await panggil(tenantId, ownerUserId),
      null,
      'tenant yang sudah ACTIVE dan sudah punya anggota masih menerima owner kedua',
    );

    // DUA PENJAGA YANG SALING MENUTUPI, dan karena itu masing-masing butuh kasusnya
    // sendiri (ditemukan uji mutasi P1 dan P2: melepas salah satu syarat TIDAK
    // menggagalkan satu tes pun, karena syarat yang lain masih menangkapnya - pola
    // yang sama dengan S11/S13 slice 14).
    //
    // (a) Hanya syarat STATUS yang dapat menangkap ini: tenant ACTIVE, tanpa anggota,
    //     TETAPI rolenya sudah ada. Versi pertama kasus ini tidak menyiapkan role, dan
    //     penjaga ketiga (role tenant_owner harus ada) ikut menutupi syarat status -
    //     mutasi P1 tetap lolos. Rolenya dibuat saat tenant masih PROVISIONING, lalu
    //     statusnya dinaikkan, sehingga yang tersisa sebagai penjaga hanyalah status.
    const aktifKosong = randomUUID();
    await db.query(
      `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'PROVISIONING')`,
      [aktifKosong, `kappa-${RUN}`, `Tenant kappa ${RUN}`],
    );
    await db.query(`SELECT auth.provision_tenant_roles($1)`, [aktifKosong]);
    await db.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [aktifKosong]);
    assert.equal(
      await panggil(aktifKosong, ownerUserId),
      null,
      'tenant ACTIVE tanpa anggota masih menerima owner dari platform',
    );

    // (b) Hanya syarat ANGGOTA yang dapat menangkap ini: tenant PROVISIONING yang
    //     sudah punya anggota. Rolenya disiapkan lebih dulu supaya penolakan tidak
    //     datang dari syarat role.
    const provisiBerisi = randomUUID();
    await db.query(
      `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'PROVISIONING')`,
      [provisiBerisi, `lambda-${RUN}`, `Tenant lambda ${RUN}`],
    );
    await db.query(`SELECT auth.provision_tenant_roles($1)`, [provisiBerisi]);
    const pertama = await panggil(provisiBerisi, ownerUserId);
    assert.ok(pertama, 'owner pertama seharusnya berhasil di tenant PROVISIONING yang masih kosong');
    assert.equal(
      await panggil(provisiBerisi, ownerUserId),
      null,
      'tenant PROVISIONING yang sudah punya anggota masih menerima owner kedua',
    );

    // Tenant PROVISIONING yang belum punya anggota, tetapi identitasnya tidak ada.
    const kosong = randomUUID();
    await db.query(
      `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'PROVISIONING')`,
      [kosong, `eta-${RUN}`, `Tenant eta ${RUN}`],
    );
    assert.equal(await panggil(kosong, randomUUID()), null, 'identitas yang tidak ada diterima');

    // Dan identitas yang ada pun ditolak selama role owner belum dibuat (F-27 belum
    // dijalankan): urutan provisioning adalah bagian dari aturannya.
    assert.equal(
      await panggil(kosong, ownerUserId),
      null,
      'owner dibuat padahal role tenant_owner belum ada',
    );
  });

  test('6. F-27 dan F-26 menolak di luar keadaan provisioning', async () => {
    const dibuat = await buatTenant('theta');
    assert.equal(dibuat.status, 201, dibuat.text);
    const tenantId = dibuat.body.tenantId;

    const roles = await db.query<{ n: number }>(`SELECT auth.provision_tenant_roles($1) AS n`, [tenantId]);
    assert.equal(roles.rows[0].n, -1, 'F-27 menerima tenant yang sudah ACTIVE');

    // Kunci platform tidak boleh lahir dari jalur tenant, dan tenant yang tidak ada
    // tidak boleh mendapat kunci.
    const platformKey = await db.query<{ ok: boolean }>(
      `SELECT auth.create_tenant_key($1, 'platform_identity', 1, $2) AS ok`,
      [tenantId, Buffer.alloc(61, 1)],
    );
    assert.equal(platformKey.rows[0].ok, false, 'F-26 menerima purpose platform');

    const hantu = await db.query<{ ok: boolean }>(
      `SELECT auth.create_tenant_key($1, 'identity', 2, $2) AS ok`,
      [randomUUID(), Buffer.alloc(61, 1)],
    );
    assert.equal(hantu.rows[0].ok, false, 'F-26 memberi kunci pada tenant yang tidak ada');
  });

  test('7. template role adalah katalog: tidak dapat ditulis runtime, tanpa permission platform', async () => {
    // Pola yang sama dengan katalog permission: diubah migrasi, bukan runtime. Yang
    // menjaganya GRANT, dan diperiksa langsung - bukan lewat percobaan INSERT, karena
    // RLS dan grant yang kurang memakai SQLSTATE yang sama (pelajaran slice 14).
    const { rows: hak } = await db.query<{ privilege_type: string }>(
      `SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'app_user' AND table_name IN ('role_templates', 'role_template_permissions')
       ORDER BY 1`,
    );
    assert.deepEqual(hak.map((h) => h.privilege_type), ['SELECT']);

    // Permission platform di template role tenant ditolak foreign key (code, scope),
    // bukan validasi aplikasi.
    await db.query('BEGIN');
    try {
      await assert.rejects(
        () =>
          db.query(
            `INSERT INTO role_template_permissions (component, role_code, permission_code, permission_scope)
             VALUES ('baseline', 'tenant_admin', 'platform.admins.read', 'PLATFORM')`,
          ),
        (e: any) => {
          // 23514 = CHECK permission_scope = 'TENANT' menolak lebih dulu; 23503 bila
          // CHECK itu dilepas. Keduanya penolakan database, dan keduanya diterima -
          // yang TIDAK diterima adalah baris yang masuk.
          assert.ok(['23514', '23503'].includes(e.code), `kode ${e.code}`);
          return true;
        },
      );
    } finally {
      await db.query('ROLLBACK');
    }
  });

  test('8. tenant baru tidak terlihat oleh tenant lain', async () => {
    const dibuat = await buatTenant('iota');
    assert.equal(dibuat.status, 201, dibuat.text);

    // Owner Alpha (context Alpha) tidak melihat anggota, role, maupun kunci tenant
    // baru itu - RLS, bukan klausa WHERE di aplikasi.
    const masuk = await http('POST', '/api/v1/auth/login', { email: ownerEmail, password: PASSWORD });
    const pilih = await http('POST', '/api/v1/auth/select-context', {
      ticket: masuk.body.ticket,
      tenantId: ALPHA,
    });
    const anggota = await http('GET', '/api/v1/members', undefined, pilih.body.accessToken);
    assert.equal(anggota.body.tenantId, ALPHA);
    assert.ok(
      !anggota.body.members.some((m: any) => m.display_name === 'Owner iota'),
      'anggota tenant baru terlihat dari tenant lain',
    );
  });
});
