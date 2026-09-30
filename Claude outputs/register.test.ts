import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

/**
 * Schema inspection test: database dibandingkan dengan register.
 *
 * ADR sec.7 butir 7, sec.3.9, dan Lampiran A sec.5 butir 4 menuntut test ini sejak
 * edisi pertama ("tidak ada fungsi SECURITY DEFINER di database yang tidak tercantum
 * di sec.3; tidak ada policy TO app_auth_definer yang tidak tercantum di sec.4").
 * Test itu belum pernah dibuat, dan akibatnya dapat dihitung: SEMBILAN penyimpangan
 * bertahan tanpa terlihat sampai baseline ini diarahkan menjadi fondasi produk
 * sungguhan -
 *
 *   * F-15, F-17, F-20 masuk register setelah berjalan lebih dulu;
 *   * F-21..F-25 (`find_session`, `find_membership`, `create_refresh_token`,
 *     `get_active_key`, `get_key_version`) berjalan TANPA terdaftar sama sekali - dua
 *     yang pertama dilewati setiap request, dua terakhir membaca tabel DEK;
 *   * `crypto_keys` punya policy definer dan grant kolom `wrapped_dek` tanpa satu pun
 *     entri register;
 *   * empat tabel diberi grant tingkat TABEL padahal register menjanjikan per kolom.
 *
 * Yang membuat semua itu mungkin bukan kelalaian sekali: register adalah dokumen,
 * dan dokumen tidak menolak apa pun. Sejak migrasi 0022 register punya dua bentuk
 * yang saling mengikat - nomor F-xx sebagai COMMENT di setiap fungsi, dan
 * `db/register.json` sebagai kontrak dalam bentuk data.
 *
 * TENTANG `db/register.json`: berkas itu dibuat dari keadaan database pada
 * 2026-09-28 lalu DIPERIKSA baris demi baris terhadap Lampiran A - ia snapshot yang
 * ditinjau, bukan kebenaran yang diturunkan otomatis. Nilainya bukan pada "cocok
 * dengan database hari ini" (itu memang selalu benar saat dibuat), melainkan pada
 * hari ketika seseorang menambah fungsi, policy, atau kolom: test ini gagal sampai
 * penambahan itu dinyatakan di sini DAN di Lampiran A.
 *
 * Test ini TIDAK membaca dokumen normatif (README induk sec.7 kriteria 1) dan tidak
 * bergantung pada data seed apa pun, sehingga dapat dijalankan terhadap database
 * produk mana pun yang memasang baseline ini - itulah gunanya begitu baseline
 * menjadi skema yang dipasang, bukan aplikasi tunggal.
 */

/**
 * Berkas ini dijalankan dari `dist/test`, bukan dari `test`, jadi jaraknya ke akar
 * repo berbeda antara sumber dan hasil build. Menuliskan '../..' akan benar di satu
 * tempat dan salah di tempat lain - karena itu akarnya DICARI, bukan dihitung.
 */
function cariRegister(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const calon = join(dir, 'db', 'register.json');
    if (existsSync(calon)) return calon;
    dir = dirname(dir);
  }
  throw new Error('db/register.json tidak ditemukan dari berkas tes ini');
}

const REGISTER = JSON.parse(readFileSync(cariRegister(), 'utf8')) as Register;

interface Register {
  roles: { owner: string; definer: string; runtime: string };
  functions: { id: string; signature: string; note: string }[];
  belumAda: { id: string; signature: string; alasan: string }[];
  policies: { table: string; cmd: string; policy: string }[];
  columnGrants: { table: string; privilege: string; columns: string[] }[];
}

let db: Client;

/** Perbandingan himpunan yang pesannya menyebut KEDUA arah, bukan hanya "tidak sama". */
function bandingkan(nama: string, ada: string[], seharusnya: string[]) {
  const a = new Set(ada);
  const b = new Set(seharusnya);
  const asing = [...a].filter((x) => !b.has(x)).sort();
  const hilang = [...b].filter((x) => !a.has(x)).sort();
  assert.deepEqual(
    { asing, hilang },
    { asing: [], hilang: [] },
    `${nama}: ${asing.length} di database tanpa entri register, ${hilang.length} di register tanpa isi di database\n` +
      `  di database, tidak terdaftar: ${asing.join('\n    ') || '-'}\n` +
      `  terdaftar, tidak ada di database: ${hilang.join('\n    ') || '-'}`,
  );
}

before(async () => {
  db = new Client({
    host: process.env.DEMO_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DEMO_DB_PORT ?? 5432),
    database: process.env.DEMO_DB_NAME ?? 'saas_demo',
    user: process.env.DEMO_DB_SUPER ?? 'postgres',
    password: process.env.DEMO_DB_SUPER_PASSWORD,
  });
  await db.connect();
});

after(async () => {
  await db?.end();
});

describe('register Lampiran A vs database', () => {
  test('1. setiap fungsi SECURITY DEFINER terdaftar, dan setiap entri punya isi', async () => {
    const { rows } = await db.query<{ signature: string; komentar: string | null }>(`
      SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS signature,
             obj_description(p.oid, 'pg_proc') AS komentar
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);

    bandingkan(
      'fungsi SECURITY DEFINER',
      rows.map((r) => r.signature),
      REGISTER.functions.map((f) => f.signature),
    );

    // Nomor register wajib ada DI DATABASE, bukan hanya di berkas ini. Inilah yang
    // memaksa penulis migrasi berikutnya membuka Lampiran A: tanpa COMMENT ber-nomor,
    // fungsinya tidak lolos test ini.
    const peta = new Map(REGISTER.functions.map((f) => [f.signature, f.id]));
    for (const r of rows) {
      const nomor = /^(F-\d\d)\s/.exec(r.komentar ?? '')?.[1];
      assert.ok(
        nomor,
        `fungsi ${r.signature} tidak membawa nomor register di COMMENT (isi: ${r.komentar ?? 'tidak ada'})`,
      );
      assert.equal(
        nomor,
        peta.get(r.signature),
        `nomor register ${r.signature} di database (${nomor}) berbeda dari register.json (${peta.get(r.signature)})`,
      );
    }

    // Entri yang dinyatakan BELUM ADA harus benar-benar tidak ada. Kalau kelak
    // diimplementasikan, test ini gagal sampai statusnya dipindahkan - sehingga
    // "F-01 sudah ada di dokumen" tidak pernah lagi berarti "fungsinya ada".
    for (const b of REGISTER.belumAda) {
      const nama = b.signature.replace(/\(.*$/, '').split('.')[1];
      const { rows: a } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'auth' AND p.proname = $1`,
        [nama],
      );
      assert.equal(a[0].n, 0, `${b.id} ditandai belum ada, tetapi ${nama} ADA di database`);
    }
  });

  test('2. setiap fungsi definer dimiliki peran definer, ber-search_path, tanpa SQL dinamis', async () => {
    const { rows } = await db.query<{
      signature: string;
      owner: string;
      config: string[] | null;
      dinamis: boolean;
    }>(`
      SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS signature,
             pg_get_userbyid(p.proowner) AS owner,
             p.proconfig AS config,
             (p.prosrc ~* '\\mEXECUTE\\M') AS dinamis
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);

    assert.ok(rows.length > 0, 'tidak ada fungsi definer sama sekali - test ini kehilangan sasaran');
    for (const r of rows) {
      assert.equal(r.owner, REGISTER.roles.definer, `${r.signature} dimiliki ${r.owner}`);
      assert.ok(
        (r.config ?? []).some((c) => c.startsWith('search_path=')),
        `${r.signature} tanpa search_path eksplisit (Lampiran A sec.2 butir 5)`,
      );
      assert.equal(r.dinamis, false, `${r.signature} memuat EXECUTE dinamis (Lampiran A sec.2 butir 5)`);
    }
  });

  test('3. policy TO peran definer sama dengan register, satu operasi per policy', async () => {
    const { rows } = await db.query<{ table: string; cmd: string; policy: string }>(
      `SELECT tablename AS "table", cmd, policyname AS policy
       FROM pg_policies WHERE $1 = ANY(roles)`,
      [REGISTER.roles.definer],
    );

    bandingkan(
      'policy TO peran definer',
      rows.map((r) => `${r.table}.${r.policy} ${r.cmd}`),
      REGISTER.policies.map((p) => `${p.table}.${p.policy} ${p.cmd}`),
    );

    // Lampiran A sec.2 butir 3: policy dibuat per operasi dan TIDAK memakai FOR ALL.
    for (const r of rows) {
      assert.notEqual(r.cmd, 'ALL', `policy ${r.table}.${r.policy} memakai FOR ALL`);
    }
  });

  test('4. grant ke peran definer per KOLOM, dan kolomnya sama dengan register', async () => {
    // Grant tingkat tabel adalah lubang yang tidak terlihat: kolom yang DITAMBAHKAN
    // kelak otomatis ikut terbaca jalur definer, tanpa seorang pun memutuskannya.
    // Empat tabel pernah dalam keadaan itu sampai migrasi 0022.
    const { rows: tabel } = await db.query<{ table: string; privilege: string }>(
      `SELECT table_name AS "table", privilege_type AS privilege
       FROM information_schema.role_table_grants WHERE grantee = $1`,
      [REGISTER.roles.definer],
    );
    assert.deepEqual(
      tabel,
      [],
      `grant tingkat tabel ke peran definer: ${tabel.map((t) => `${t.table}:${t.privilege}`).join(', ')}`,
    );

    const { rows } = await db.query<{ table: string; privilege: string; columns: string[] }>(
      `SELECT table_name AS "table", privilege_type AS privilege,
              array_agg(column_name::text ORDER BY column_name::text) AS columns
       FROM information_schema.column_privileges WHERE grantee = $1
       GROUP BY 1, 2`,
      [REGISTER.roles.definer],
    );

    bandingkan(
      'grant kolom ke peran definer',
      rows.map((r) => `${r.table}.${r.privilege}`),
      REGISTER.columnGrants.map((g) => `${g.table}.${g.privilege}`),
    );

    const seharusnya = new Map(
      REGISTER.columnGrants.map((g) => [`${g.table}.${g.privilege}`, g.columns.join(',')]),
    );
    for (const r of rows) {
      const kunci = `${r.table}.${r.privilege}`;
      assert.equal(
        r.columns.join(','),
        seharusnya.get(kunci),
        `kolom ${kunci} berbeda dari register\n  database: ${r.columns.join(',')}\n  register: ${seharusnya.get(kunci)}`,
      );
    }
  });

  test('5. invarian peran: tanpa BYPASSRLS, tanpa keanggotaan, RLS selalu FORCE', async () => {
    const { rows: bypass } = await db.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolbypassrls AND rolname LIKE 'app\\_%'`,
    );
    assert.deepEqual(bypass, [], `peran aplikasi dengan BYPASSRLS: ${bypass.map((b) => b.rolname)}`);

    const { rows: anggota } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_auth_members m
       JOIN pg_roles anggota ON anggota.oid = m.member
       JOIN pg_roles induk ON induk.oid = m.roleid
       WHERE anggota.rolname = $1 AND induk.rolname = $2`,
      [REGISTER.roles.runtime, REGISTER.roles.definer],
    );
    assert.equal(anggota[0].n, 0, 'peran runtime menjadi anggota peran definer');

    // FORCE, bukan hanya ENABLE: tanpa FORCE, pemilik tabel melewati policy - dan
    // pemilik tabel itulah yang menjalankan migrasi dan seed.
    const { rows: rls } = await db.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND c.relrowsecurity AND NOT c.relforcerowsecurity`,
    );
    assert.deepEqual(rls, [], `tabel dengan RLS ENABLE tanpa FORCE: ${rls.map((r) => r.relname)}`);

    // Dan setiap tabel yang punya tenant_id WAJIB ber-RLS. Tabel baru yang lupa
    // dipasang RLS adalah cara paling mudah membocorkan tenant, dan ia tidak akan
    // menggagalkan satu tes fungsional pun.
    const { rows: tanpaRls } = await db.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
    );
    assert.deepEqual(
      tanpaRls,
      [],
      `tabel ber-tenant_id tanpa RLS: ${tanpaRls.map((r) => r.relname)}`,
    );
  });
});
