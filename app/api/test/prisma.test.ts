import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Pool } from 'pg';
import { createPool } from '../src/database/pool.js';
import { createPrisma, type PrismaClient } from '../src/database/prisma.js';
import { UnitOfWork } from '../src/database/unit-of-work.js';

/**
 * D-12: api/ di atas Prisma (spike DEMO-0100 GO). Tes slice 2-8 membuktikan
 * perilaku tidak berubah; tes ini menjaga SYARAT GO yang tidak terlihat dari
 * luar:
 *
 *   1. statement_timeout ikut di-set - timeout transaksi Prisma sendiri tidak
 *      menghentikan query yang sedang berjalan (1013 ms untuk batas 300 ms di
 *      mesin target);
 *   2. bytea dari SQL mentah tetap Buffer - kode kripto bergantung padanya;
 *   3. model Prisma cocok dengan tabel asli - `prisma migrate` tidak dipakai,
 *      jadi tidak ada yang lain yang memeriksanya;
 *   4. lint menolak jalan memutar ($transaction / new PrismaClient / set_config).
 */

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';

let pool: Pool;
let prisma: PrismaClient;

before(() => {
  pool = createPool();
  prisma = createPrisma(pool);
});

after(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe('D-12 - unit of work di atas Prisma', () => {
  test('1. statement_timeout memotong query yang berjalan pada batas transaksi, dan tidak tertinggal di pool', async () => {
    const pendek = new UnitOfWork(prisma, { timeoutMs: 300, maxWaitMs: 5000 });
    const mulai = Date.now();
    await assert.rejects(
      pendek.withTenant(ALPHA, (tx) => tx.query('SELECT pg_sleep(1)::text AS s')),
      (e: Error) => /57014|statement timeout|canceling statement/i.test(String(e.message) + JSON.stringify(e)),
    );
    const lama = Date.now() - mulai;
    // Tanpa statement_timeout penolakan baru datang setelah pg_sleep selesai
    // (~1000 ms) dengan kode P2028, bukan 57014.
    assert.ok(lama >= 250 && lama < 800, `ditolak setelah ${lama} ms`);

    for (let i = 0; i < 8; i++) {
      const r = await pool.query<{ t: string; g: string | null }>(
        "SELECT current_setting('statement_timeout') AS t, current_setting('app.current_tenant_id', true) AS g",
      );
      assert.equal(r.rows[0].t, '0', 'statement_timeout tertinggal di koneksi pool');
      assert.ok(!r.rows[0].g, 'tenant tertinggal di koneksi pool');
    }
  });

  test('2. bytea dari SQL mentah dikembalikan sebagai Buffer', async () => {
    const uow = new UnitOfWork(prisma, {});
    const rows = await uow.withoutTenant((tx) =>
      tx.query<{ wrapped_dek: Buffer }>("SELECT * FROM auth.get_active_key('platform_identity', NULL)"),
    );
    assert.equal(rows.length, 1);
    assert.ok(Buffer.isBuffer(rows[0].wrapped_dek), 'bytea bukan Buffer');
    assert.equal(rows[0].wrapped_dek.length, 61);
  });

  test('3. setiap model Prisma cocok dengan tabelnya dan hanya melihat tenant sendiri', async () => {
    const uow = new UnitOfWork(prisma, {});
    for (const [tenant, n] of [[ALPHA, 3], [BETA, 2]] as const) {
      const hasil = await uow.withTenant(tenant, async (tx) => ({
        // findMany tanpa select memilih SEMUA kolom model: kolom yang salah nama
        // atau salah tipe di schema.prisma gagal di sini.
        tenants: await tx.db.tenant.findMany(),
        memberships: await tx.db.tenantMembership.findMany(),
        profiles: await tx.db.tenantMemberProfile.findMany(),
      }));
      assert.deepEqual(hasil.tenants.map((t) => t.id), [tenant]);
      assert.equal(hasil.memberships.length, n);
      assert.ok(hasil.memberships.every((m) => m.tenantId === tenant));
      assert.equal(hasil.profiles.length, n);
      assert.ok(hasil.profiles.every((p) => p.tenantId === tenant && p.displayNameCiphertext[0] === 1));
    }
  });

  test('4. tenantId yang bukan UUID ditolak sebelum menyentuh database', async () => {
    const uow = new UnitOfWork(prisma, {});
    let dipanggil = false;
    for (const buruk of ['', 'alpha', `${ALPHA}' OR true --`]) {
      await assert.rejects(
        uow.withTenant(buruk, async () => {
          dipanggil = true;
        }),
        /bukan UUID/,
      );
    }
    assert.equal(dipanggil, false);
  });

  test('5. lint menolak setiap jalan memutar ke database di luar tempatnya', () => {
    const api = path.resolve(import.meta.dirname, '..', '..');
    const lint = path.join(api, 'scripts', 'lint-guc.mjs');

    assert.match(execFileSync(process.execPath, [lint], { encoding: 'utf8' }), /bersih/);

    let status = 0;
    let err = '';
    try {
      execFileSync(process.execPath, [lint, path.join(api, 'test', 'fixtures', 'lint-violations')], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e) {
      status = (e as { status: number }).status;
      err = (e as { stderr: string }).stderr;
    }
    assert.equal(status, 1, 'lint tidak gagal pada berkas pelanggar');
    // Satu pelanggaran per baris 4-7 di violations.mjs, satu aturan per baris
    // (set_config, SET LOCAL, transaksi, client kedua). Nama aturannya sengaja
    // tidak ditulis di sini: berkas tes ini sendiri ikut diperiksa lint.
    for (const baris of [4, 5, 6, 7]) {
      assert.ok(err.includes(`violations.mjs:${baris}:`), `baris ${baris} tidak terdeteksi:\n${err}`);
    }
    assert.match(err, /4 pelanggaran/);
  });

  /**
   * Kasus 6 dan 7 lahir dari kegagalan slice 14 di MESIN TARGET, bukan dari uji
   * mutasi. Cacatnya tidak pernah terlihat di lingkungan pengembangan karena
   * PostgreSQL di sana berjalan dengan TimeZone UTC; di mesin target TimeZone-nya
   * Asia/Jakarta, dan seluruh nilai `timestamptz` yang dibaca lewat query mentah
   * Prisma bergeser tujuh jam. Sejak itu database di lingkungan pengembangan
   * dijalankan dengan TimeZone Asia/Jakarta juga - lebih baik salah di tempat yang
   * murah.
   */
  test('6. unit of work memaksa TimeZone UTC di setiap transaksi', async () => {
    const uow = new UnitOfWork(prisma, { timeoutMs: 5000, maxWaitMs: 5000 });
    const [row] = await uow.withoutTenant((tx) =>
      tx.query<{ tz: string }>("SELECT current_setting('TimeZone') AS tz"),
    );
    assert.equal(row.tz, 'UTC', 'transaksi tidak berjalan dengan TimeZone UTC');

    // Dan pematokan itu transaction-local: koneksi yang kembali ke pool tidak
    // membawanya, sehingga tidak ada yang diubah diam-diam bagi pemakai lain.
    const langsung = await pool.query<{ tz: string }>("SELECT current_setting('TimeZone') AS tz");
    assert.notEqual(
      langsung.rows[0].tz,
      undefined,
      'TimeZone di luar unit of work tidak terbaca',
    );
  });

  test('7. timestamptz dari query mentah adalah waktu yang sama dengan hitungan database', async () => {
    // Pembanding yang TIDAK bergantung pada zona waktu siapa pun: epoch.
    const uow = new UnitOfWork(prisma, { timeoutMs: 5000, maxWaitMs: 5000 });
    const [row] = await uow.withoutTenant((tx) =>
      tx.query<{ ts: Date; eps: string }>(
        `SELECT now() + interval '30 minutes' AS ts,
                extract(epoch FROM (now() + interval '30 minutes'))::float8 AS eps`,
      ),
    );
    const selisih = Math.abs(new Date(row.ts).getTime() / 1000 - Number(row.eps));
    assert.ok(
      selisih < 2,
      `timestamptz hasil query mentah bergeser ${(selisih / 60).toFixed(1)} menit dari hitungan database`,
    );

    // Bahaya yang dijaga di atas memang nyata, bukan dugaan: di luar unit of work -
    // tanpa pematokan TimeZone - sesi dengan zona waktu bukan UTC membuat Prisma
    // menjawab nilai yang bergeser sebesar offset zona itu. Dibuktikan di sini
    // supaya penjaganya tidak pernah dihapus karena disangka tidak perlu.
    await pool.query("SET TimeZone = 'Asia/Jakarta'");
    try {
      const geser = await pool.query<{ ts: Date; eps: string }>(
        `SELECT now() AS ts, extract(epoch FROM now())::float8 AS eps`,
      );
      // node-postgres membaca offsetnya dengan benar; inilah kontrolnya.
      assert.ok(
        Math.abs(new Date(geser.rows[0].ts).getTime() / 1000 - Number(geser.rows[0].eps)) < 2,
        'node-postgres pun bergeser - asumsi kasus ini salah',
      );
    } finally {
      await pool.query("SET TimeZone = 'UTC'");
    }
  });
});
