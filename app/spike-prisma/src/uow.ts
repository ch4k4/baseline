import type { PrismaClient } from './db';
import type { Prisma } from '../generated/prisma/client';

/**
 * Unit of work di atas Prisma interactive transaction (ADR-001 sec.3.9,
 * Infrastructure SSOT sec.8.7.2). Padanan api/src/database/unit-of-work.ts.
 *
 * Satu-satunya tempat yang boleh memanggil set_config('app.*') dan
 * $transaction (ditegakkan scripts/lint-guc.mjs).
 *
 * Yang diterima fn adalah TRANSACTION CLIENT, bukan PrismaClient. Query lewat
 * client global berjalan di koneksi lain - koneksi yang tidak pernah menerima
 * set_config - sehingga RLS mengembalikan 0 baris. Itu gagal-aman, tapi juga
 * bug yang diam; karenanya client global tidak diekspor ke repository.
 */

export type Tx = Prisma.TransactionClient;

export interface UowOptions {
  /** Batas total satu transaksi (ms). Prisma membatalkan dan me-rollback setelahnya. */
  timeoutMs?: number;
  /** Batas menunggu koneksi dari pool (ms). */
  maxWaitMs?: number;
  /**
   * statement_timeout PostgreSQL untuk transaksi ini (ms). Default = timeoutMs.
   * 0 = mati (hanya untuk tes yang mengukur perilaku Prisma tanpa penjaga ini).
   *
   * Kenapa perlu selain timeoutMs: temuan spike DEMO-0100 - timeout transaksi
   * Prisma TIDAK menghentikan query yang sedang berjalan. Transaksi 300 ms dengan
   * query 1 detik baru ditolak setelah query itu selesai (~1000 ms), dan selama
   * itu koneksi tetap terpakai. Query yang menunggu lock tanpa batas akan
   * memegang koneksi tanpa batas pula. statement_timeout membuat database
   * sendiri yang membatalkannya.
   */
  statementTimeoutMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PrismaUnitOfWork {
  private readonly timeout: number;
  private readonly maxWait: number;
  private readonly statementTimeout: number;

  constructor(
    private readonly prisma: PrismaClient,
    opts: UowOptions = {},
  ) {
    this.timeout = opts.timeoutMs ?? 5000;
    this.maxWait = opts.maxWaitMs ?? 2000;
    this.statementTimeout = opts.statementTimeoutMs ?? this.timeout;
  }

  withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    // Validasi di sini, bukan di database: nilai sampah yang lolos ke
    // set_config baru gagal saat cast ::uuid di policy - pesan yang jauh dari
    // sebabnya.
    if (!UUID.test(tenantId)) return Promise.reject(new Error('tenantId bukan UUID'));
    return this.run(tenantId, fn);
  }

  /** Jalur pre-context: HANYA untuk memanggil fungsi auth.* (Opsi A). */
  withoutTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run('', fn);
  }

  private run<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        // Statement pertama, selalu. Parameter ketiga true = transaction-local:
        // hilang saat COMMIT/ROLLBACK, jadi tidak terbawa ke pemakai koneksi
        // berikutnya di pool.
        await tx.$queryRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true),
                                  set_config('statement_timeout', ${String(this.statementTimeout)}, true)`;
        return fn(tx);
      },
      { timeout: this.timeout, maxWait: this.maxWait },
    );
  }
}
