/**
 * Pemasang migrasi: memasang HANYA migrasi yang belum pernah dipasang, dan mencatatnya.
 *
 * Sampai 2026-09-28 satu-satunya jalan memasang perubahan skema adalah `reset` (hapus
 * database, bangun dari nol). Itu cukup untuk demo dan mustahil untuk database yang
 * berisi data - dan begitu baseline ini menjadi skema yang DIPASANG ke database tiap
 * produk, "hanya bisa reset" berarti baseline tidak dapat dinaikkan versinya sama
 * sekali di tempat ia dipakai.
 *
 * Satu implementasi, dua pemanggil: `db.ps1` (Windows) dan `db.sh` (Linux/CI)
 * memanggil berkas ini, tidak menyalin logikanya. Logika yang ditulis dua kali akan
 * berbeda dua kali, dan yang satu adalah yang dipakai mesin target.
 *
 * Tiga perintah:
 *
 *   migrate  pasang berkas yang belum tercatat, satu transaksi per berkas, lalu catat
 *   stamp    catat SELURUH berkas sebagai sudah dipasang TANPA menjalankannya - untuk
 *            mengadopsi database yang sudah ada (mis. database demo yang dibangun
 *            sebelum ledger ada). Salah pakai = skema tidak lengkap tanpa peringatan,
 *            jadi ia menolak berjalan bila tabel inti belum ada.
 *   status   apa yang sudah dipasang, apa yang belum, dan checksum mana yang berubah
 *
 * Yang SELALU diperiksa lebih dulu, di ketiga perintah: checksum setiap berkas yang
 * sudah tercatat. Berkas migrasi yang diedit setelah dipasang membuat dua database
 * mengaku berada di versi yang sama padahal isinya berbeda; di sini itu menjadi
 * kegagalan yang berisik, bukan perbedaan yang diam.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const KOMPONEN = process.env.DEMO_MIGRATION_COMPONENT ?? 'baseline';

/**
 * Dua berkas TIDAK dipasang pemasang ini, dan keduanya punya sebab yang berbeda:
 *
 *   0001_roles.sql  membuat peran dan memiliki database - hanya superuser yang dapat
 *                   menjalankannya, dan ia berjalan sebelum app_owner ada;
 *   0005_seed_demo.sql  bukan skema melainkan data demo, dan dijalankan superuser.
 *
 * Keduanya tetap dicatat di ledger oleh `stamp`/`reset` supaya daftar versi utuh,
 * tetapi tidak pernah dijalankan dari sini.
 */
const BUKAN_MIGRASI = /^(0001_roles|0005_seed_demo)\./;

interface Berkas {
  version: string;
  filename: string;
  checksum: string;
  isi: string;
  sql: string;
  transaksiSendiri: boolean;
  dijalankanDiSini: boolean;
}

/**
 * Berkas migrasi ditulis untuk psql, dan memuat satu meta-command: `\set ON_ERROR_STOP
 * on`. Meta-command bukan SQL, jadi ia dibuang sebelum dikirim ke server - dan
 * ON_ERROR_STOP memang tidak diperlukan di sini, karena kesalahan apa pun menggagalkan
 * transaksinya.
 *
 * `checksum` tetap dihitung dari isi ASLI berkas, bukan dari hasil pembuangan ini:
 * yang harus tidak berubah adalah berkas di repo, bukan bentuk yang dikirim.
 */
function siapkanSql(isi: string, filename: string): string {
  const baris = isi.split('\n');
  if (baris.some((l) => /^\s*\\(?!set\b)/.test(l))) {
    throw new Error(
      `${filename} memuat meta-command psql selain \\set; pemasang ini hanya mengirim SQL. ` +
        'Tulis ulang bagian itu sebagai SQL, atau jalankan berkasnya lewat psql.',
    );
  }
  if (/:'|:"/.test(isi)) {
    throw new Error(
      `${filename} memakai variabel psql (:'x'); pemasang ini tidak menggantinya. ` +
        'Migrasi yang butuh variabel harus dijalankan skrip pemanggil sebagai superuser.',
    );
  }
  return baris.filter((l) => !/^\s*\\/.test(l)).join('\n');
}

function cariMigrations(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const calon = join(dir, 'db', 'migrations');
      readdirSync(calon);
      return calon;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error('folder db/migrations tidak ditemukan');
}

function daftarBerkas(): Berkas[] {
  const folder = cariMigrations();
  const nama = readdirSync(folder)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const berkas = nama.map((filename) => {
    const cocok = /^(\d{4}[a-z]?)_/.exec(filename);
    if (!cocok) {
      throw new Error(
        `nama migrasi tidak sesuai pola NNNN_nama.sql atau NNNNx_nama.sql: ${filename}`,
      );
    }
    const isi = readFileSync(join(folder, filename), 'utf8');
    const dijalankanDiSini = !BUKAN_MIGRASI.test(filename);
    return {
      version: cocok[1],
      filename,
      checksum: createHash('sha256').update(isi, 'utf8').digest('hex'),
      isi,
      sql: dijalankanDiSini ? siapkanSql(isi, filename) : isi,
      // Sebagian migrasi mengurus transaksinya SENDIRI (mis. 0021 melepas FORCE RLS
      // sesaat di dalam satu transaksi). Membungkusnya lagi dari luar justru
      // berbahaya: COMMIT di dalam berkas akan menutup transaksi luar, dan sisa
      // berkasnya berjalan tanpa transaksi - ROLLBACK di pemasang tidak lagi
      // membatalkan apa pun. Karena itu berkas semacam itu dijalankan apa adanya.
      transaksiSendiri: /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(isi),
      dijalankanDiSini,
    };
  });

  // Nomor ganda adalah bahaya nyata begitu lebih dari satu orang menulis migrasi:
  // urutan jalannya menjadi kebetulan abjad, dan ledger hanya dapat memuat satu.
  const nomor = new Map<string, string>();
  for (const b of berkas) {
    const kembar = nomor.get(b.version);
    if (kembar) throw new Error(`nomor migrasi ganda ${b.version}: ${kembar} dan ${b.filename}`);
    nomor.set(b.version, b.filename);
  }
  return berkas;
}

async function buka(): Promise<Client> {
  const db = new Client({
    host: process.env.DEMO_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DEMO_DB_PORT ?? 5432),
    database: process.env.DEMO_DB_NAME ?? 'saas_demo',
    user: process.env.DEMO_DB_OWNER ?? 'app_owner',
    password: process.env.DEMO_DB_OWNER_PASSWORD ?? 'devowner',
  });
  await db.connect();
  return db;
}

async function ledgerAda(db: Client): Promise<boolean> {
  const { rows } = await db.query<{ ada: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ada`,
  );
  return rows[0].ada;
}

async function tercatat(db: Client): Promise<Map<string, { checksum: string; filename: string }>> {
  if (!(await ledgerAda(db))) return new Map();
  const { rows } = await db.query<{ version: string; checksum: string; filename: string }>(
    `SELECT version, checksum, filename FROM schema_migrations WHERE component = $1`,
    [KOMPONEN],
  );
  return new Map(rows.map((r) => [r.version, { checksum: r.checksum, filename: r.filename }]));
}

/** Kegagalan yang berisik, bukan perbedaan yang diam. */
function periksaChecksum(berkas: Berkas[], sudah: Map<string, { checksum: string; filename: string }>) {
  const berubah: string[] = [];
  for (const b of berkas) {
    const catatan = sudah.get(b.version);
    if (catatan && catatan.checksum !== b.checksum) {
      berubah.push(`${b.filename} (tercatat sebagai ${catatan.filename})`);
    }
  }
  if (berubah.length > 0) {
    throw new Error(
      `berkas migrasi berubah SETELAH dipasang:\n  ${berubah.join('\n  ')}\n` +
        'Migrasi yang sudah dipasang tidak boleh diedit. Tulis migrasi baru, atau - ' +
        'bila database ini memang boleh dibangun ulang - jalankan reset.',
    );
  }
}

async function catat(db: Client, b: Berkas) {
  await db.query(
    `INSERT INTO schema_migrations (component, version, filename, checksum)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (component, version) DO UPDATE SET filename = $3, checksum = $4`,
    [KOMPONEN, b.version, b.filename, b.checksum],
  );
}

async function migrate(db: Client) {
  const berkas = daftarBerkas();
  let sudah = await tercatat(db);
  periksaChecksum(berkas, sudah);

  let dipasang = 0;
  for (const b of berkas) {
    if (sudah.has(b.version)) continue;
    if (!b.dijalankanDiSini) {
      // Dicatat, tidak dijalankan: lihat BUKAN_MIGRASI di atas. Yang menjalankannya
      // adalah skrip pemanggil sebagai superuser.
      if (await ledgerAda(db)) await catat(db, b);
      continue;
    }

    // Satu transaksi per berkas, KECUALI berkas yang mengurus transaksinya sendiri:
    // migrasi yang gagal di tengah tidak meninggalkan separuh perubahan DAN baris
    // ledger yang mengaku berhasil.
    if (b.transaksiSendiri) {
      try {
        await db.query(b.sql);
        if (await ledgerAda(db)) await catat(db, b);
      } catch (e) {
        throw new Error(
          `migrasi ${b.filename} gagal: ${(e as Error).message}\n` +
            'Berkas ini mengurus transaksinya sendiri, jadi sebagian perubahannya MUNGKIN ' +
            'sudah terpasang. Periksa keadaan database sebelum mencoba lagi.',
        );
      }
    } else {
      await db.query('BEGIN');
      try {
        await db.query(b.sql);
        if (await ledgerAda(db)) await catat(db, b);
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        throw new Error(`migrasi ${b.filename} gagal: ${(e as Error).message}`);
      }
    }
    console.log(`  -> pasang ${b.filename}${b.transaksiSendiri ? ' (transaksi sendiri)' : ''}`);
    dipasang += 1;
    sudah = await tercatat(db);
  }

  // Berkas yang dilewati sebelum ledger ada (0001, dan 0001b itu sendiri) dicatat
  // sesudahnya, supaya daftar versi utuh.
  for (const b of berkas) {
    if (!sudah.has(b.version)) await catat(db, b);
  }
  console.log(dipasang === 0 ? '  -> tidak ada migrasi baru' : `  -> ${dipasang} migrasi dipasang`);
}

async function stamp(db: Client) {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('tenants','users','sessions')`,
  );
  if (rows[0].n < 3) {
    throw new Error(
      'stamp menolak: tabel inti (tenants, users, sessions) belum ada, jadi database ini BUKAN ' +
        'database lama yang perlu diadopsi. Jalankan migrate.',
    );
  }
  const berkas = daftarBerkas();

  // Ledger-nya sendiri BOLEH dipasang di sini: ia satu-satunya migrasi yang tidak
  // mengubah skema aplikasi, dan tanpanya tidak ada tempat menaruh catatannya. Tanpa
  // pengecualian ini, mengadopsi database lama menjadi mustahil - `migrate` akan
  // mencoba memasang ulang 0002 dan seterusnya, dan gagal di tabel yang sudah ada.
  if (!(await ledgerAda(db))) {
    const ledger = berkas.find((b) => /^0001b_/.test(b.filename));
    if (!ledger) throw new Error('berkas ledger (0001b_*.sql) tidak ada di db/migrations');
    await db.query(ledger.sql);
    console.log(`  -> pasang ${ledger.filename} (hanya ledger)`);
  }

  periksaChecksum(berkas, await tercatat(db));
  for (const b of berkas) await catat(db, b);
  console.log(`  -> ${berkas.length} migrasi dicatat sebagai sudah dipasang (tanpa dijalankan)`);
}

async function status(db: Client) {
  const berkas = daftarBerkas();
  const sudah = await tercatat(db);
  const belum = berkas.filter((b) => !sudah.has(b.version));
  const berubah = berkas.filter((b) => sudah.get(b.version)?.checksum !== undefined
    && sudah.get(b.version)!.checksum !== b.checksum);
  console.log(`komponen   : ${KOMPONEN}`);
  console.log(`ledger     : ${(await ledgerAda(db)) ? 'ada' : 'BELUM ADA'}`);
  console.log(`berkas     : ${berkas.length}`);
  console.log(`terpasang  : ${sudah.size}`);
  console.log(`belum      : ${belum.length}${belum.length ? ' -> ' + belum.map((b) => b.filename).join(', ') : ''}`);
  console.log(`checksum   : ${berubah.length === 0 ? 'cocok' : 'BERUBAH -> ' + berubah.map((b) => b.filename).join(', ')}`);
}

const perintah = process.argv[2] ?? 'migrate';
const db = await buka();
try {
  if (perintah === 'migrate') await migrate(db);
  else if (perintah === 'stamp') await stamp(db);
  else if (perintah === 'status') await status(db);
  else {
    console.error(`perintah tidak dikenal: ${perintah} (migrate | stamp | status)`);
    process.exitCode = 2;
  }
} catch (e) {
  console.error(`GAGAL: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
