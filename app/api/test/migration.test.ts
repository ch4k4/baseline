import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

/**
 * Ledger migrasi: apa yang tercatat terpasang benar-benar sama dengan berkas di repo.
 *
 * Sampai 2026-09-28 database ini tidak punya ledger sama sekali, dan akibatnya satu:
 * satu-satunya cara memasang perubahan skema adalah `reset` - hapus database, bangun
 * dari nol. Untuk demo itu cukup; untuk database yang berisi data itu jalan buntu, dan
 * begitu baseline dipasang ke database tiap produk (keputusan pemilik proyek,
 * 2026-09-28), "hanya bisa reset" berarti baseline tidak dapat dinaikkan versinya di
 * tempat ia dipakai.
 *
 * Yang dijaga di sini BUKAN pemasangnya bekerja (itu terbukti saat dipakai), melainkan
 * dua sifat yang mudah hilang tanpa suara:
 *
 *   1. berkas migrasi yang sudah dipasang TIDAK diedit. Dua database yang mengaku
 *      berada di versi yang sama padahal isinya berbeda adalah cacat yang paling sulit
 *      dilacak, dan checksum mengubahnya menjadi kegagalan yang berisik;
 *   2. tidak ada nomor migrasi ganda. Dengan dua penulis, nomor kembar membuat urutan
 *      jalan menjadi kebetulan abjad - dan ledger hanya dapat memuat salah satunya.
 *
 * Tes ini tidak membaca data seed apa pun dan tidak peduli isi tabel aplikasi,
 * sehingga dapat dijalankan terhadap database produk mana pun yang memasang baseline.
 */

const KOMPONEN = process.env.DEMO_MIGRATION_COMPONENT ?? 'baseline';

interface BerkasMigrasi {
  version: string;
  filename: string;
  checksum: string;
}

function cariMigrations(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      readdirSync(join(dir, 'db', 'migrations'));
      return join(dir, 'db', 'migrations');
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error('folder db/migrations tidak ditemukan');
}

function berkasMigrasi(): BerkasMigrasi[] {
  const folder = cariMigrations();
  return readdirSync(folder)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const cocok = /^(\d{4}[a-z]?)_/.exec(filename);
      assert.ok(cocok, `nama migrasi di luar pola NNNN_nama.sql: ${filename}`);
      const isi = readFileSync(join(folder, filename), 'utf8');
      return {
        version: cocok[1],
        filename,
        checksum: createHash('sha256').update(isi, 'utf8').digest('hex'),
      };
    });
}

let db: Client;

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

describe('ledger migrasi', () => {
  test('1. setiap berkas migrasi tercatat, dan checksumnya masih sama', async () => {
    const berkas = berkasMigrasi();
    assert.ok(berkas.length >= 20, `hanya ${berkas.length} berkas migrasi terbaca - jalurnya salah?`);

    const { rows } = await db.query<{ version: string; filename: string; checksum: string }>(
      `SELECT version, filename, checksum FROM schema_migrations WHERE component = $1 ORDER BY version`,
      [KOMPONEN],
    );
    const tercatat = new Map(rows.map((r) => [r.version, r]));

    const belum = berkas.filter((b) => !tercatat.has(b.version));
    assert.deepEqual(
      belum.map((b) => b.filename),
      [],
      'ada berkas migrasi yang tidak tercatat di ledger - jalankan `db.ps1 migrate`',
    );

    const asing = rows.filter((r) => !berkas.some((b) => b.version === r.version));
    assert.deepEqual(
      asing.map((r) => r.filename),
      [],
      'ledger memuat migrasi yang berkasnya TIDAK ADA di repo - database ini dipasang dari sumber lain',
    );

    // Inilah penjaga yang sebenarnya: berkas yang diedit setelah dipasang.
    const berubah = berkas
      .filter((b) => tercatat.get(b.version)!.checksum !== b.checksum)
      .map((b) => `${b.filename} (ledger: ${tercatat.get(b.version)!.checksum.slice(0, 8)}, berkas: ${b.checksum.slice(0, 8)})`);
    assert.deepEqual(
      berubah,
      [],
      'berkas migrasi berubah SETELAH dipasang. Migrasi yang sudah dipasang tidak boleh diedit: tulis migrasi baru.',
    );
  });

  test('2. nomor migrasi unik, dan nama berkasnya sama dengan yang tercatat', async () => {
    const berkas = berkasMigrasi();
    const nomor = new Map<string, string>();
    for (const b of berkas) {
      const kembar = nomor.get(b.version);
      assert.equal(kembar, undefined, `nomor migrasi ganda ${b.version}: ${kembar} dan ${b.filename}`);
      nomor.set(b.version, b.filename);
    }

    const { rows } = await db.query<{ version: string; filename: string }>(
      `SELECT version, filename FROM schema_migrations WHERE component = $1`,
      [KOMPONEN],
    );
    for (const r of rows) {
      assert.equal(
        r.filename,
        nomor.get(r.version),
        `migrasi ${r.version} tercatat sebagai ${r.filename}, di repo bernama ${nomor.get(r.version)} - berkas migrasi jangan diganti nama setelah dipasang`,
      );
    }
  });

  test('3. ledger tidak dapat disentuh runtime, dan bentuknya dijaga constraint', async () => {
    // Runtime tidak punya urusan dengan ledger. Yang menjaganya adalah GRANT, bukan
    // policy: tabel tanpa grant adalah pernyataan yang lebih keras.
    const { rows: hak } = await db.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_name = 'schema_migrations' AND grantee IN ('app_user', 'app_auth_definer', 'PUBLIC')`,
    );
    assert.deepEqual(
      hak.map((h) => h.privilege_type),
      [],
      'peran runtime/definer punya hak pada schema_migrations',
    );

    // Dan bentuk barisnya dijaga database, bukan hanya oleh pemasang yang menulisnya.
    for (const [kolom, nilai] of [
      ['component', 'Baseline'],
      ['version', '23'],
      ['checksum', 'bukan-sha256'],
    ] as const) {
      const baris = {
        component: 'baseline',
        version: '9999',
        filename: 'uji.sql',
        checksum: 'a'.repeat(64),
        [kolom]: nilai,
      } as Record<string, string>;
      // Di dalam transaksi yang SELALU dibatalkan. Versi pertama kasus ini menulis
      // langsung, dan ketika CHECK-nya sengaja dilepas saat uji mutasi, barisnya
      // benar-benar masuk dan tertinggal di tabel bersama - membuat jalur berikutnya
      // gagal karena sebab yang tidak ada di dalamnya. Aturan slice 9, dilanggar lagi
      // oleh saya sendiri.
      await db.query('BEGIN');
      try {
        await assert.rejects(
          () =>
            db.query(
              `INSERT INTO schema_migrations (component, version, filename, checksum) VALUES ($1, $2, $3, $4)`,
              [baris.component, baris.version, baris.filename, baris.checksum],
            ),
          (e: any) => {
            assert.equal(e.code, '23514', `nilai ${kolom}="${nilai}" diterima dengan kode ${e.code}`);
            return true;
          },
          `nilai ${kolom}="${nilai}" seharusnya ditolak CHECK`,
        );
      } finally {
        await db.query('ROLLBACK');
      }
    }
  });
});
