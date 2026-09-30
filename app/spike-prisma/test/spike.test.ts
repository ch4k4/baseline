import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Pool } from 'pg';
import { createPool, createPrisma, PrismaClient } from '../src/db';
import { PrismaUnitOfWork } from '../src/uow';

/**
 * DEMO-0100 - spike Prisma 7 + RLS + Opsi A + pool reuse.
 *
 * Dijalankan terhadap database demo yang SUDAH ADA (`.\db.ps1 reset`), sebagai
 * app_user, di atas skema asli - bukan tabel contoh. Bukti yang dicari: apakah
 * Prisma dapat menggantikan api/src/database/unit-of-work.ts tanpa melemahkan
 * satu pun jaminan yang sekarang dijaga tes SQL dan API.
 *
 * Semua penulisan terjadi di dalam transaksi yang digagalkan (ROLLBACK), jadi
 * database demo tidak berubah.
 *
 * Nomor kasus = butir acceptance criteria DEMO-0100 (Sprint Plan) yang dibuktikan.
 */

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';
const OWNER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const MULTI = 'cccccccc-0000-0000-0000-000000000001';

class Batal extends Error {}

let pool: Pool;
let prisma: PrismaClient;
let uow: PrismaUnitOfWork;

before(async () => {
  // Pool KECIL dengan sengaja: kebocoran context hanya muncul bila koneksi
  // benar-benar dipakai ulang oleh transaksi lain.
  pool = createPool(3);
  prisma = createPrisma(pool);
  uow = new PrismaUnitOfWork(prisma, { timeoutMs: 5000, maxWaitMs: 10_000 });
});

after(async () => {
  await prisma.$disconnect();
  await pool.end();
});

/** Nilai GUC di koneksi yang diberikan pool - DI LUAR unit of work. */
async function gucDiLuarUow(): Promise<string | null> {
  const r = await prisma.$queryRaw<{ v: string | null }[]>`
    SELECT current_setting('app.current_tenant_id', true) AS v`;
  return r[0].v;
}

describe('DEMO-0100 spike Prisma', () => {
  test('1. skema: setiap tabel RLS ENABLE + FORCE, tidak ada role aplikasi dengan BYPASSRLS', async () => {
    // Prisma tidak melihat RLS; pemeriksaan ini yang menggantikan "drift
    // detection" untuk objek yang tidak dikenal Prisma (lihat SPIKE_RESULT.md).
    const tanpa = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`;
    assert.deepEqual(tanpa.map((r) => r.relname), [], 'tabel tanpa RLS ENABLE + FORCE');

    const jumlah = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    assert.ok(jumlah[0].n >= 10, `hanya ${jumlah[0].n} tabel terlihat - database belum di-reset?`);

    const bypass = await prisma.$queryRaw<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles
      WHERE rolname IN ('app_owner', 'app_user', 'app_auth_definer') AND rolbypassrls`;
    assert.deepEqual(bypass, []);
  });

  test('2. transaksi interaktif: set_config statement pertama, di transaksi yang sama, hanya baris tenant itu', async () => {
    for (const [tenant, n] of [[ALPHA, 3], [BETA, 2]] as const) {
      const hasil = await uow.withTenant(tenant, async (tx) => {
        const [a] = await tx.$queryRaw<{ xid: string; t: string }[]>`
          SELECT txid_current()::text AS xid, current_setting('app.current_tenant_id', true) AS t`;
        const rows = await tx.tenantMembership.findMany();
        const profil = await tx.tenantMemberProfile.findMany();
        const [b] = await tx.$queryRaw<{ xid: string }[]>`SELECT txid_current()::text AS xid`;
        return { a, b, rows, profil };
      });
      assert.equal(hasil.a.t, tenant);
      // Query model Prisma dan raw query berada di transaksi yang SAMA dengan
      // set_config. Kalau Prisma memakai koneksi lain untuk findMany, RLS akan
      // memberi 0 baris - dan pemeriksaan jumlah di bawah menangkapnya.
      assert.equal(hasil.a.xid, hasil.b.xid);
      assert.equal(hasil.rows.length, n);
      assert.ok(hasil.rows.every((r) => r.tenantId === tenant));
      assert.equal(hasil.profil.length, n);
      assert.ok(hasil.profil.every((p) => p.tenantId === tenant));
    }
  });

  test('2b. tenantId yang bukan UUID ditolak sebelum menyentuh database', async () => {
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

  test('3. tanpa context: 0 baris, dan insert ditolak', async () => {
    const rows = await uow.withoutTenant((tx) => tx.tenantMembership.findMany());
    assert.equal(rows.length, 0);

    // Lewat client global (di luar unit of work) hasilnya sama: gagal-aman.
    assert.equal((await prisma.tenantMembership.findMany()).length, 0);

    await assert.rejects(
      uow.withoutTenant((tx) =>
        tx.tenantMembership.create({ data: { id: crypto.randomUUID(), tenantId: BETA, userId: OWNER_A, status: 'ACTIVE' } }),
      ),
      (e: Error) => /row-level security|42501/i.test(String(e.message) + JSON.stringify(e)),
    );
  });

  test('4. tulis: tenant salah ditolak; tenant benar terlihat di transaksinya lalu hilang setelah rollback', async () => {
    const id = crypto.randomUUID();

    await assert.rejects(
      uow.withTenant(ALPHA, (tx) =>
        tx.tenantMembership.create({ data: { id, tenantId: BETA, userId: OWNER_A, status: 'ACTIVE' } }),
      ),
      (e: Error) => /row-level security|42501/i.test(String(e.message) + JSON.stringify(e)),
    );

    let terlihat = 0;
    await assert.rejects(
      uow.withTenant(BETA, async (tx) => {
        await tx.tenantMembership.create({ data: { id, tenantId: BETA, userId: OWNER_A, status: 'ACTIVE' } });
        terlihat = await tx.tenantMembership.count({ where: { id } });
        throw new Batal();
      }),
      Batal,
    );
    assert.equal(terlihat, 1, 'baris baru tidak terlihat di transaksinya sendiri');
    const sisa = await uow.withTenant(BETA, (tx) => tx.tenantMembership.count({ where: { id } }));
    assert.equal(sisa, 0, 'rollback tidak membuang baris');
  });

  test('5. beban: 240 transaksi bergantian Alpha/Beta/tanpa-context pada pool 3 tidak membocorkan context', async () => {
    const tugas = Array.from({ length: 240 }, (_, i) => i % 3);
    const salah: string[] = [];
    let bocorDiLuar = 0;

    await Promise.all(
      tugas.map(async (k, i) => {
        // Jeda acak di DALAM transaksi memaksa transaksi saling tumpang-tindih,
        // sehingga koneksi benar-benar berpindah tangan di pool.
        const jeda = (i * 7) % 5 / 1000;
        if (k === 2) {
          const n = await uow.withoutTenant(async (tx) => {
            await tx.$executeRaw`SELECT pg_sleep(${jeda})`;
            return tx.tenantMembership.count();
          });
          if (n !== 0) salah.push(`#${i} tanpa context melihat ${n} baris`);
        } else {
          const t = k === 0 ? ALPHA : BETA;
          const rows = await uow.withTenant(t, async (tx) => {
            await tx.$executeRaw`SELECT pg_sleep(${jeda})`;
            return tx.tenantMembership.findMany({ select: { tenantId: true } });
          });
          if (rows.length === 0 || rows.some((r) => r.tenantId !== t)) {
            salah.push(`#${i} tenant ${t.slice(0, 4)} melihat ${rows.map((r) => r.tenantId.slice(0, 4)).join(',')}`);
          }
        }
        // Koneksi yang baru dikembalikan ke pool tidak boleh membawa tenant apa pun.
        const v = await gucDiLuarUow();
        if (v) bocorDiLuar++;
      }),
    );

    assert.deepEqual(salah.slice(0, 5), []);
    assert.equal(bocorDiLuar, 0, 'GUC tenant tertinggal di koneksi pool setelah transaksi selesai');
  });

  test('6. multi-langkah (rotasi refresh token) dalam satu unit of work, lalu rollback', async () => {
    // Hash acak per run: nilai tetap membuat tes ini gagal selamanya setelah satu
    // run yang - karena bug - ter-commit (terjadi saat uji mutasi spike).
    const h1 = randomBytes(32);
    const h2 = randomBytes(32);
    let sesi = '';
    const langkah: string[] = [];

    await assert.rejects(
      uow.withoutTenant(async (tx) => {
        const [s] = await tx.$queryRaw<{ id: string }[]>`
          SELECT auth.create_session('TENANT', ${OWNER_A}::uuid, ${ALPHA}::uuid,
                                     'a1a1a1a1-0000-0000-0000-000000000001'::uuid, 15) AS id`;
        sesi = s.id;
        await tx.$queryRaw`SELECT * FROM auth.create_refresh_token(${sesi}::uuid, ${ALPHA}::uuid, 'TENANT', ${h1}, 3600)`;
        const [r1] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM auth.rotate_refresh_token(${h1}, ${h2}, 3600)`;
        const [r2] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM auth.rotate_refresh_token(${h1}, ${h2}, 3600)`;
        langkah.push(r1.status, r2.status);
        throw new Batal();
      }),
      Batal,
    );

    // Langkah kedua melihat hasil langkah pertama: satu transaksi, satu koneksi.
    assert.deepEqual(langkah, ['ROTATED', 'REUSE']);
    const ada = await uow.withoutTenant((tx) =>
      tx.$queryRaw<unknown[]>`SELECT * FROM auth.find_session(${sesi}::uuid)`,
    );
    assert.equal(ada.length, 0, 'session dari transaksi yang di-rollback masih ada');
  });

  test('6b. timeout Prisma saja: ditolak dan tidak ter-commit, TAPI baru setelah query yang berjalan selesai', async () => {
    // statement_timeout dimatikan dengan sengaja: yang diukur di sini perilaku
    // timeout Prisma sendiri, alasan penjaga di 6c ada.
    const pendek = new PrismaUnitOfWork(prisma, { timeoutMs: 300, maxWaitMs: 10_000, statementTimeoutMs: 0 });
    const id = crypto.randomUUID();
    const mulai = Date.now();

    await assert.rejects(
      pendek.withTenant(BETA, async (tx) => {
        await tx.tenantMembership.create({ data: { id, tenantId: BETA, userId: OWNER_A, status: 'ACTIVE' } });
        await tx.$executeRaw`SELECT pg_sleep(1)`;
        await tx.tenantMembership.count(); // tidak boleh sempat berjalan
      }),
      // Penolakan HARUS karena batas waktu. Versi pertama tes ini lulus karena
      // pg_sleep (tipe void) gagal di-deserialisasi $queryRaw - penolakan yang
      // benar dengan alasan yang salah.
      (e: Error & { code?: string }) => {
        console.log(`[spike] timeout -> ${e.code ?? '-'}: ${String(e.message).split('\n').filter(Boolean).pop()}`);
        return e.code === 'P2028' || /transaction.*(expired|timeout|closed)/i.test(e.message);
      },
    );
    const lama = Date.now() - mulai;
    // Dicatat, bukan hanya diuji: SPIKE_RESULT.md memuat angka dari mesin target.
    console.log(`[spike] timeout 300 ms -> ditolak setelah ${lama} ms`);
    assert.ok(lama >= 250, `ditolak setelah ${lama} ms - terlalu cepat untuk sebuah timeout`);
    // Temuan: Prisma tidak memotong query yang sedang berjalan.
    assert.ok(lama >= 900, `ditolak setelah ${lama} ms - Prisma ternyata memotong query; perbarui SPIKE_RESULT.md`);

    // Tunggu sampai pg_sleep di server pasti selesai, lalu pastikan tidak ada
    // yang ter-commit dan koneksi yang dipakai kembali bersih.
    await new Promise((r) => setTimeout(r, 1200));
    const sisa = await uow.withTenant(BETA, (tx) => tx.tenantMembership.count({ where: { id } }));
    assert.equal(sisa, 0, 'transaksi yang habis waktu ter-commit');
    for (let i = 0; i < 6; i++) assert.ok(!(await gucDiLuarUow()));
    assert.equal(await uow.withoutTenant((tx) => tx.tenantMembership.count()), 0);
  });

  test('6c. statement_timeout di unit of work memotong query yang berjalan pada batasnya', async () => {
    const pendek = new PrismaUnitOfWork(prisma, { timeoutMs: 300, maxWaitMs: 10_000 });
    const mulai = Date.now();
    await assert.rejects(
      pendek.withTenant(BETA, async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(1)`;
      }),
      (e: Error) => /57014|statement timeout|canceling statement/i.test(String(e.message) + JSON.stringify(e)),
    );
    const lama = Date.now() - mulai;
    console.log(`[spike] statement_timeout 300 ms -> ditolak setelah ${lama} ms`);
    assert.ok(lama >= 250 && lama < 800, `ditolak setelah ${lama} ms`);

    // statement_timeout transaction-local: tidak tertinggal di koneksi pool.
    for (let i = 0; i < 6; i++) {
      const [r] = await prisma.$queryRaw<{ v: string }[]>`SELECT current_setting('statement_timeout') AS v`;
      assert.equal(r.v, '0', 'statement_timeout tertinggal di koneksi pool');
    }
  });

  test('7. Opsi A lewat Prisma: fungsi definer membaca dua tenant tanpa context, app_user tetap 0 baris', async () => {
    const hasil = await uow.withoutTenant(async (tx) => {
      const ctx = await tx.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM auth.list_login_contexts(${MULTI}::uuid)`;
      const langsung = await tx.tenantMembership.count({ where: { userId: MULTI } });
      return { ctx, langsung };
    });
    assert.deepEqual(hasil.ctx.map((r) => r.tenant_id).sort(), [ALPHA, BETA]);
    assert.equal(hasil.langsung, 0);
  });

  test('8. batas hak: app_user tidak dapat SET ROLE definer; model tanpa grant ditolak, bukan kosong', async () => {
    await assert.rejects(
      uow.withoutTenant((tx) => tx.$executeRaw`SET LOCAL ROLE app_auth_definer`),
      (e: Error) => /permission denied|42501/i.test(String(e.message) + JSON.stringify(e)),
    );
    // Penolakan harus TERLIHAT. Daftar kosong di sini akan tampak seperti
    // "belum ada user", dan bug hak akses tersembunyi di balik hasil yang wajar.
    await assert.rejects(
      uow.withoutTenant((tx) => tx.user.findMany()),
      (e: Error) => /permission denied|42501/i.test(String(e.message) + JSON.stringify(e)),
    );
  });

  test('9. lint: set_config, $transaction, dan new PrismaClient di luar modulnya terdeteksi', () => {
    const skrip = path.resolve(__dirname, '..', '..', 'scripts', 'lint-guc.mjs');
    const src = path.resolve(__dirname, '..', '..', 'src');
    const fixture = path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'lint-violations');

    const bersih = execFileSync(process.execPath, [skrip, src], { encoding: 'utf8' });
    assert.match(bersih, /OK/);

    let keluar = 0;
    let out = '';
    try {
      execFileSync(process.execPath, [skrip, fixture], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const err = e as { status: number; stdout: string };
      keluar = err.status;
      out = err.stdout;
    }
    assert.equal(keluar, 1, 'lint tidak gagal pada berkas pelanggar');
    for (const aturan of ['set_config', '$transaction', 'new PrismaClient', 'SET app.']) {
      assert.ok(out.includes(aturan), `aturan "${aturan}" tidak terdeteksi:\n${out}`);
    }
  });

  test('10. Bytes dari Prisma adalah Uint8Array, bukan Buffer (catatan migrasi crypto adapter)', async () => {
    const [p] = await uow.withTenant(ALPHA, (tx) => tx.tenantMemberProfile.findMany({ take: 1 }));
    assert.ok(p.displayNameCiphertext instanceof Uint8Array);
    // Dicatat apa adanya: kode kripto api/ memakai Buffer (subarray, concat).
    // Kalau baris ini gagal pada versi Prisma lain, catatan migrasinya berubah.
    assert.equal(Buffer.isBuffer(p.displayNameCiphertext), false);
    assert.equal(p.displayNameCiphertext[0], 1, 'byte versi envelope');
  });
});
