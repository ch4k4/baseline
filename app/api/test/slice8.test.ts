import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { bootstrap } from '../src/main.js';
import { CryptoService } from '../src/crypto/crypto.module.js';
import { FIELDS } from '../src/crypto/field-crypto.js';
import { DecryptionError, unwrapDek } from '../src/crypto/envelope.js';
import { KekMismatchError, KeyRing, PLATFORM, Purpose, WrappedKeyLoader } from '../src/crypto/key-ring.js';
import { KekMissingError, loadKek } from '../src/crypto/kek-source.js';

/**
 * Tes slice 8 - D-01: enkripsi field, blind index, dan Data Field Register.
 *
 * Kasus di sini dibagi dua: yang membuktikan data TIDAK terbaca tanpa jalur
 * yang benar (dump database, AAD, kunci tenant lain, kunci pembungkus salah),
 * dan yang membuktikan data TETAP terbaca lewat jalur yang benar (login,
 * daftar anggota). Hanya yang pertama tanpa yang kedua adalah enkripsi yang
 * merusak aplikasi; hanya yang kedua adalah enkripsi yang tidak melindungi.
 */

const PORT = Number(process.env.TEST_PORT ?? 3203);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#12345';

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';
const MULTI = 'cccccccc-0000-0000-0000-000000000001';
const OWNER_ALPHA = 'aaaaaaaa-0000-0000-0000-000000000001';

// Semua plaintext sintetis yang ditulis seed. Tidak satu pun boleh muncul di dump.
const PLAINTEXTS = [
  'owner@alpha.demo', 'user@alpha.demo', 'admin@beta.demo', 'multi@demo.local',
  'Alpha Owner', 'Alpha User', 'Beta Admin', 'Multi di Alpha', 'Multi di Beta',
];

let app: any;
let db: Client;
let crypto: CryptoService;

async function http(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() as any };
}

const login = (email: string, password = PASSWORD) => http('POST', '/api/v1/auth/login', { email, password });

/** Loader superuser untuk kasus yang memeriksa kunci di luar jalur aplikasi. */
function superuserLoader(): WrappedKeyLoader {
  const q = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0] ?? null;
  return {
    active: (p, t) => q(`SELECT key_version, wrapped_dek FROM crypto_keys
      WHERE purpose=$1 AND tenant_id IS NOT DISTINCT FROM $2 AND status='ACTIVE'`, [p, t]),
    version: (p, t, v) => q(`SELECT key_version, wrapped_dek FROM crypto_keys
      WHERE purpose=$1 AND tenant_id IS NOT DISTINCT FROM $2 AND key_version=$3`, [p, t, v]),
  };
}

before(async () => {
  process.env.PORT = String(PORT);
  app = await bootstrap(PORT);
  crypto = app.get(CryptoService);
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
  await app?.close();
});

describe('slice 8 - enkripsi field dan blind index', () => {
  test('1. dump database tidak memuat satu pun plaintext, dalam bentuk apa pun', async () => {
    // Pemeriksaan menyeluruh atas SEMUA tabel skema public, bukan hanya kolom
    // yang kita tahu terenkripsi - kebocoran justru terjadi di kolom yang tidak
    // dipikirkan. Setiap nilai dicari sebagai teks DAN sebagai hex (bytea
    // ditampilkan sebagai \x... di JSON, jadi plaintext di kolom bytea muncul
    // sebagai hex, bukan teks).
    const { rows: tables } = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    for (const { table_name } of tables) {
      const { rows } = await db.query(`SELECT row_to_json(t)::text AS j FROM ${table_name} t`);
      const dump = rows.map((r) => r.j.toLowerCase()).join('\n');
      for (const p of PLAINTEXTS) {
        assert.ok(!dump.includes(p.toLowerCase()), `plaintext "${p}" terbaca di ${table_name}`);
        const hex = Buffer.from(p, 'utf8').toString('hex');
        assert.ok(!dump.includes(hex), `plaintext "${p}" tersimpan sebagai byte mentah di ${table_name}`);
      }
    }
  });

  test('2. plaintext sama menghasilkan ciphertext berbeda, dan keduanya terbuka', async () => {
    const a = await crypto.encrypt(FIELDS.userEmail, PLATFORM, MULTI, 'multi@demo.local');
    const b = await crypto.encrypt(FIELDS.userEmail, PLATFORM, MULTI, 'multi@demo.local');
    assert.notDeepEqual(a.ciphertext, b.ciphertext, 'enkripsi deterministik: nonce tidak acak');
    for (const s of [a, b]) {
      assert.equal(
        await crypto.decrypt(FIELDS.userEmail, PLATFORM, MULTI, s.ciphertext, s.keyVersion),
        'multi@demo.local',
      );
    }
  });

  test('3. ciphertext terikat ke baris, kolom, dan tabelnya (AAD)', async () => {
    const { rows } = await db.query(
      'SELECT email_ciphertext, email_key_version FROM users WHERE id = $1', [MULTI]);
    const { email_ciphertext: ct, email_key_version: v } = rows[0];

    // Jalur sah membuka.
    assert.equal(await crypto.decrypt(FIELDS.userEmail, PLATFORM, MULTI, ct, v), 'multi@demo.local');

    // Ciphertext yang dipindah ke baris lain, kolom lain, atau tabel lain ditolak.
    const salah = [
      () => crypto.decrypt(FIELDS.userEmail, PLATFORM, OWNER_ALPHA, ct, v),
      () => crypto.decrypt({ ...FIELDS.userEmail, field: 'legal_name' }, PLATFORM, MULTI, ct, v),
      () => crypto.decrypt({ ...FIELDS.userEmail, table: 'tenant_member_profiles' }, PLATFORM, MULTI, ct, v),
    ];
    for (const coba of salah) await assert.rejects(coba, DecryptionError);
  });

  test('4. ciphertext tenant tidak terbuka dengan kunci tenant lain', async () => {
    const { rows } = await db.query(
      `SELECT id, display_name_ciphertext AS ct, display_name_key_version AS v
       FROM tenant_member_profiles WHERE tenant_id = $1 LIMIT 1`, [ALPHA]);
    const r = rows[0];
    assert.equal(typeof (await crypto.decrypt(FIELDS.profileDisplayName, ALPHA, r.id, r.ct, r.v)), 'string');
    await assert.rejects(
      () => crypto.decrypt(FIELDS.profileDisplayName, BETA, r.id, r.ct, r.v),
      DecryptionError,
      'data Alpha terbuka dengan kunci Beta',
    );
  });

  test('5. satu bit yang berubah menggagalkan dekripsi', async () => {
    const s = await crypto.encrypt(FIELDS.userEmail, PLATFORM, MULTI, 'multi@demo.local');
    for (const posisi of [1, 13, s.ciphertext.length - 1]) {
      const rusak = Buffer.from(s.ciphertext);
      rusak[posisi] ^= 0x01;
      await assert.rejects(
        () => crypto.decrypt(FIELDS.userEmail, PLATFORM, MULTI, rusak, s.keyVersion),
        DecryptionError,
        `perubahan di byte ${posisi} tidak terdeteksi`,
      );
    }
  });

  test('6. login tetap bekerja lewat blind index, dengan normalisasi yang sama', async () => {
    // Normalisasi email dulu diuji di SQL; sejak D-01 ia tugas aplikasi.
    for (const bentuk of ['owner@alpha.demo', '  OWNER@Alpha.Demo  ', 'Owner@ALPHA.demo']) {
      assert.equal((await login(bentuk)).status, 201, `"${bentuk}" tidak menemukan identitasnya`);
    }
  });

  test('7. blind index terpisah per tenant dan per tujuan', async () => {
    // Email yang sama menghasilkan nilai berbeda di Alpha dan Beta, sehingga
    // anggota dua tenant tidak dapat dikorelasikan lewat kolom ini...
    const { rows } = await db.query(
      `SELECT p.tenant_id, p.contact_email_blind_index AS bi
       FROM tenant_member_profiles p JOIN tenant_memberships m ON m.id = p.membership_id
       WHERE m.user_id = $1`, [MULTI]);
    assert.equal(rows.length, 2);
    assert.notDeepEqual(rows[0].bi, rows[1].bi, 'email yang sama menghasilkan blind index sama di dua tenant');

    // ...dan tidak sama dengan blind index login maupun pseudonim audit. Kalau
    // sama, satu kolom dapat di-join ke kolom lain oleh pemegang database.
    const login = await crypto.userEmailIndex('multi@demo.local');
    const audit = await crypto.auditIdentifier('multi@demo.local');
    const semua = [login, audit, ...rows.map((r) => r.bi)].map((b: Buffer) => b.toString('hex'));
    assert.equal(new Set(semua).size, semua.length, 'dua tujuan berbagi nilai blind index');

    // Pseudonim audit BERKUNCI. Sebelum D-01 nilainya sha256(email) - dapat dibalik
    // oleh siapa pun yang memegang daftar email. Tes slice 6 tidak akan menangkap
    // kemunduran ke bentuk itu, karena tes itu memanggil fungsi yang sama dengan
    // aplikasi; di sinilah bentuk tanpa kunci ditolak secara eksplisit.
    for (const tanpaKunci of ['multi@demo.local', 'MULTI@demo.local']) {
      assert.notDeepEqual(audit, createHash('sha256').update(tanpaKunci, 'utf8').digest(),
        'pseudonim audit adalah hash tanpa kunci');
    }

    // Seed dan aplikasi menghitung nilai yang sama: kalau tidak, pencarian gagal.
    const { rows: u } = await db.query('SELECT email_blind_index FROM users WHERE id = $1', [MULTI]);
    assert.deepEqual(u[0].email_blind_index, login);
  });

  test('8. daftar anggota menampilkan nama utuh dan email ber-masker saja', async () => {
    const res = await login('owner@alpha.demo');
    const list = await http('GET', '/api/v1/members', undefined, res.body.accessToken);
    assert.equal(list.status, 200);

    assert.deepEqual(
      list.body.members.map((m: any) => m.display_name),
      ['Alpha Owner', 'Alpha User', 'Multi di Alpha'],
      'nama tidak terbuka atau tidak terurut setelah dekripsi',
    );
    for (const m of list.body.members) {
      assert.match(m.contact_email_masked, /^.\*\*\*@/);
      assert.ok(!('contact_email' in m), 'email lengkap keluar dari endpoint daftar');
    }
    for (const email of ['owner@alpha.demo', 'user@alpha.demo', 'multi@demo.local']) {
      assert.ok(!list.text.includes(email), `email lengkap ${email} ada di respons`);
    }
  });

  test('9. baris yang tidak dapat dibuka menggagalkan jawaban, bukan dilewati', async () => {
    // Ciphertext SAH milik profil lain dipindahkan ke profil ini: bentuknya lolos
    // CHECK database, tapi AAD-nya menunjuk baris lain. Ini gambaran kerusakan
    // yang paling mungkin terjadi - salah salin, bukan sampah acak.
    const { rows } = await db.query(
      `SELECT id, display_name_ciphertext FROM tenant_member_profiles
       WHERE tenant_id = $1 ORDER BY id LIMIT 2`, [ALPHA]);
    const [a, b] = rows;
    const res = await login('owner@alpha.demo');
    try {
      await db.query('UPDATE tenant_member_profiles SET display_name_ciphertext = $1 WHERE id = $2',
        [b.display_name_ciphertext, a.id]);

      const list = await http('GET', '/api/v1/members', undefined, res.body.accessToken);
      assert.equal(list.status, 500, 'baris rusak dilewati diam-diam');
      assert.ok(!list.text.includes('Alpha'), 'jawaban gagal masih memuat data anggota');
    } finally {
      await db.query('UPDATE tenant_member_profiles SET display_name_ciphertext = $1 WHERE id = $2',
        [a.display_name_ciphertext, a.id]);
    }
    const pulih = await http('GET', '/api/v1/members', undefined, res.body.accessToken);
    assert.equal(pulih.status, 200, 'data tidak pulih setelah kasus');
  });

  test('10. DEK terbungkus terikat ke scope dan purpose-nya', async () => {
    const kek = loadKek();
    const { rows } = await db.query(
      `SELECT purpose, key_version, wrapped_dek FROM crypto_keys WHERE tenant_id = $1 AND purpose = 'identity'`,
      [ALPHA]);
    const r = rows[0];
    assert.equal(unwrapDek(kek, r.wrapped_dek, ALPHA, 'identity', r.key_version).length, 32);
    // DEK Alpha yang disalin ke baris Beta, atau dipakai untuk purpose lain, tidak terbuka.
    assert.throws(() => unwrapDek(kek, r.wrapped_dek, BETA, 'identity', r.key_version), DecryptionError);
    assert.throws(() => unwrapDek(kek, r.wrapped_dek, ALPHA, 'identity_blind_index', r.key_version), DecryptionError);
  });

  test('11. KEK yang salah menghentikan proses dengan pesan, bukan data rusak', async () => {
    const ring = new KeyRing(randomBytes(32), superuserLoader());
    await assert.rejects(() => ring.active('platform_identity', PLATFORM), KekMismatchError);

    const semula = process.env.DEMO_KEK_FILE;
    process.env.DEMO_KEK_FILE = resolve(import.meta.dirname, 'tidak-ada', 'kek.key');
    try {
      assert.throws(() => loadKek(), KekMissingError);
    } finally {
      if (semula === undefined) delete process.env.DEMO_KEK_FILE;
      else process.env.DEMO_KEK_FILE = semula;
    }
  });

  test('12. kunci platform tidak pernah milik tenant, kunci tenant selalu milik tenant', async () => {
    const dek = randomBytes(61); dek[0] = 1;
    for (const [tenant, purpose] of [[ALPHA, 'platform_identity'], [null, 'identity']] as const) {
      await db.query('BEGIN');
      try {
        await assert.rejects(
          db.query(`INSERT INTO crypto_keys (tenant_id, purpose, key_version, wrapped_dek)
                    VALUES ($1, $2, 99, $3)`, [tenant, purpose, dek]),
          (e: any) => e.code === '23514',
          `${purpose} dengan tenant ${tenant} diterima`,
        );
      } finally {
        await db.query('ROLLBACK');
      }
    }
  });
});

// ---------------------------------------------------------------- register

interface RegisterEntry { [k: string]: string }
type Register = { tables: Record<string, Record<string, 'DP-0' | RegisterEntry>> };

const REGISTER_PATH = resolve(import.meta.dirname, '..', '..', '..', 'db', 'data-field-register.json');
const REQUIRED = [
  'description', 'data_subject', 'pdp_category', 'classification', 'purpose', 'legal_basis_owner',
  'encryption_layer', 'key_purpose', 'blind_index', 'masking_rule', 'retention',
  'processing_role', 'information_label', 'cross_border_transfer', 'dpia_required', 'owner',
];
const LABEL: Record<string, string[]> = {
  'DP-0': ['public', 'internal'], 'DP-1': ['confidential'], 'DP-2': ['restricted'], 'DP-3': ['restricted'],
};

describe('slice 8 - Data Field Register', () => {
  let reg: Register;
  let cols: { table_name: string; column_name: string; data_type: string }[];

  before(async () => {
    reg = JSON.parse(readFileSync(REGISTER_PATH, 'utf8'));
    cols = (await db.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public'`)).rows;
  });

  test('13. setiap kolom di database tercatat, dan setiap catatan menunjuk kolom yang ada', () => {
    // Inilah "migration review gagal bila field personal baru belum terdaftar"
    // (DEMO-0105B), dalam bentuk yang tidak bergantung pada ingatan peninjau.
    const diDb = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
    const diRegister = new Set(
      Object.entries(reg.tables).flatMap(([t, cs]) => Object.keys(cs).map((c) => `${t}.${c}`)));
    const belumTercatat = [...diDb].filter((x) => !diRegister.has(x)).sort();
    const hantu = [...diRegister].filter((x) => !diDb.has(x)).sort();
    assert.deepEqual(belumTercatat, [], `kolom tanpa klasifikasi: ${belumTercatat.join(', ')}`);
    assert.deepEqual(hantu, [], `register menunjuk kolom yang tidak ada: ${hantu.join(', ')}`);
  });

  test('14. kolom personal dan rahasia punya catatan lengkap dan label yang sesuai', () => {
    for (const [t, cs] of Object.entries(reg.tables)) {
      for (const [c, e] of Object.entries(cs)) {
        if (e === 'DP-0') continue;
        const kurang = REQUIRED.filter((k) => !e[k] || !String(e[k]).trim());
        assert.deepEqual(kurang, [], `${t}.${c} tanpa atribut: ${kurang.join(', ')}`);
        assert.ok(LABEL[e.classification], `${t}.${c}: klasifikasi ${e.classification} tidak dikenal`);
        assert.ok(LABEL[e.classification].includes(e.information_label),
          `${t}.${c}: ${e.classification} tidak boleh berlabel ${e.information_label}`);
      }
    }
  });

  test('15. field terenkripsi benar-benar berbentuk ciphertext di database', () => {
    const tipe = new Map(cols.map((c) => [`${c.table_name}.${c.column_name}`, c.data_type]));
    for (const [t, cs] of Object.entries(reg.tables)) {
      for (const [c, e] of Object.entries(cs)) {
        if (e === 'DP-0') continue;
        if (['field', 'keyed_hash', 'wrapped_key'].includes(e.encryption_layer)) {
          assert.equal(tipe.get(`${t}.${c}`), 'bytea', `${t}.${c} (${e.encryption_layer}) bukan bytea`);
        }
        if (e.encryption_layer === 'field') {
          assert.match(c, /_ciphertext$/, `${t}.${c}: field terenkripsi wajib berakhiran _ciphertext`);
          const versi = c.replace(/_ciphertext$/, '_key_version');
          assert.ok(tipe.has(`${t}.${versi}`), `${t}.${c} tanpa kolom ${versi}`);
        }
        // DP-1 ke atas tidak boleh disimpan sebagai teks, kecuali hash password
        // yang memang berformat teks (scrypt$N$r$p$salt$hash).
        if (e.classification !== 'DP-0' && e.encryption_layer !== 'hash') {
          assert.notEqual(tipe.get(`${t}.${c}`), 'text', `${t}.${c} personal disimpan sebagai teks`);
        }
      }
    }
  });

  test('16. katalog kripto aplikasi dan register tidak berbeda pendapat', () => {
    for (const def of Object.values(FIELDS)) {
      const e = reg.tables[def.table]?.[`${def.field}_ciphertext`];
      assert.ok(e && e !== 'DP-0', `${def.table}.${def.field}_ciphertext tidak tercatat sebagai field terenkripsi`);
      assert.equal((e as RegisterEntry).encryption_layer, 'field');
      assert.equal((e as RegisterEntry).key_purpose, def.purpose, `${def.table}.${def.field}: purpose berbeda`);
      if ('blindIndexPurpose' in def) {
        const bi = reg.tables[def.table]?.[`${def.field}_blind_index`] as RegisterEntry;
        assert.equal(bi?.key_purpose, (def as any).blindIndexPurpose as Purpose, `${def.table}.${def.field}: purpose blind index berbeda`);
      }
    }
  });
});
