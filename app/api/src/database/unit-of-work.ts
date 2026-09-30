import { Injectable, Inject } from '@nestjs/common';
import { PRISMA, type PrismaClient } from './prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SupportRequest, supportContext } from './support-context.js';

/**
 * Satu-satunya tempat di seluruh kode yang boleh memanggil set_config('app.*')
 * dan $transaction. Aturan ini ditegakkan scripts/lint-guc.mjs, bukan disiplin
 * manual.
 *
 * Sejak D-12 (spike DEMO-0100 GO) transaksi dijalankan Prisma interactive
 * transaction di atas pool pg yang sama. Kontraknya tidak berubah bagi pemanggil:
 * withTenant / withoutTenant, dan fn menerima Tx.
 *
 * Kenapa transaction-local (parameter ketiga set_config = true): koneksi
 * dikembalikan ke pool setelah COMMIT/ROLLBACK, dan GUC transaction-local ikut
 * hilang saat itu juga. Kalau memakai session-local (false), tenant terakhir
 * akan menempel di koneksi dan terbawa ke request tenant lain - kebocoran yang
 * tidak akan pernah muncul di tes berurutan, hanya di bawah beban.
 */

export interface Tx {
  /**
   * SQL mentah berparameter ($1, $2, ...). Dipakai untuk fungsi auth.* (Opsi A)
   * dan query yang belum dipindah ke model. Nilai bytea dikembalikan sebagai
   * Buffer, sama seperti sebelum Prisma (Prisma sendiri memberi Uint8Array).
   */
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<R[]>;
  /** Query bertipe lewat model Prisma, di transaksi dan context yang SAMA. */
  readonly db: Prisma.TransactionClient;
}

export interface UowOptions {
  /** Batas total satu transaksi (ms). */
  timeoutMs?: number;
  /** Batas menunggu koneksi dari pool (ms). */
  maxWaitMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Uint8Array (dari Prisma) -> Buffer, rekursif pada baris hasil query mentah. */
function toBuffers<R>(rows: R[]): R[] {
  for (const row of rows as Record<string, unknown>[]) {
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (v instanceof Uint8Array && !Buffer.isBuffer(v)) {
        row[k] = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
      }
    }
  }
  return rows;
}

function wrap(tx: Prisma.TransactionClient): Tx {
  return {
    db: tx,
    async query<R>(sql: string, params: unknown[] = []) {
      return toBuffers(await tx.$queryRawUnsafe<R[]>(sql, ...params));
    },
  };
}

export function uowOptionsFromEnv(): UowOptions {
  return {
    timeoutMs: Number(process.env.DEMO_DB_TX_TIMEOUT_MS ?? 5000),
    maxWaitMs: Number(process.env.DEMO_DB_TX_MAX_WAIT_MS ?? 5000),
  };
}

export const UOW_OPTIONS = Symbol('UOW_OPTIONS');

@Injectable()
export class UnitOfWork {
  private readonly timeout: number;
  private readonly maxWait: number;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(UOW_OPTIONS) opts: UowOptions,
  ) {
    this.timeout = opts.timeoutMs ?? 5000;
    this.maxWait = opts.maxWaitMs ?? 5000;
  }

  /**
   * Jalur tenant: seluruh query di dalam fn hanya melihat baris tenant ini,
   * ditegakkan RLS di database - bukan oleh klausa WHERE di kode.
   */
  withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    // Nilai sampah yang lolos ke set_config baru gagal saat cast ::uuid di
    // policy - pesan yang jauh dari sebabnya. Ditolak di sini.
    if (!UUID.test(tenantId)) return Promise.reject(new Error('tenantId bukan UUID'));

    // Sejak DEMO-0312 jalur ini melayani dua hal: anggota tenant, dan superadmin
    // yang sedang menyokong tenant itu lewat support session. Yang membedakan
    // bukan pemanggilnya melainkan penanda permintaan - lihat support-context.ts.
    const support = supportContext();
    if (!support) return this.run(tenantId, 'tenant', fn);

    // Sesi support membuka SATU tenant (ADR-003 sec.2.2). Kode di dalamnya tidak
    // dapat membuka context tenant lain, walau keliru: RLS hanya menjaga apa yang
    // ada di GUC, jadi yang harus dijaga adalah apa yang boleh masuk ke GUC.
    if (support.tenantId !== tenantId) {
      return Promise.reject(
        new Error('sesi support hanya membuka tenantnya sendiri; tenant lain ditolak'),
      );
    }
    return this.run(tenantId, 'support', fn, support);
  }

  /**
   * Jalur pre-context: dipakai HANYA untuk memanggil fungsi auth.* yang memang
   * harus berjalan sebelum tenant diketahui. GUC di-set ke string kosong secara
   * eksplisit supaya tidak pernah mewarisi nilai dari transaksi sebelumnya.
   */
  withoutTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run('', 'tenant', fn);
  }

  /**
   * Jalur platform (DEMO-0311): tabel control-plane platform, tanpa tenant.
   *
   * Yang membuka tabel platform bukan permission aplikasi melainkan GUC
   * app.context_kind, dan GUC itu HANYA ditetapkan di sini - sama seperti
   * app.current_tenant_id. Route tenant tidak punya jalan memanggil jalur ini,
   * dan lint:guc menolak set_config di berkas lain (batasnya dijelaskan
   * ADR-001 sec.3.10: ini pertahanan terhadap bug, bukan terhadap aplikasi yang
   * sudah dikompromikan).
   *
   * Tenant tetap kosong: context platform TIDAK membuka tabel tenant-owned,
   * karena policy tenant menuntut tenant_id = app_current_tenant().
   */
  withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    // Sesi support TIDAK boleh membuka tabel platform. Hak yang dibawanya adalah
    // himpunan permission tenant (SUPPORT_READ_SET), bukan hak platform yang
    // dipakai untuk membukanya - dan tanpa penolakan ini satu pemanggilan keliru
    // dari dalam jalur support akan membaca daftar superadmin.
    if (supportContext()) {
      return Promise.reject(new Error('context platform tidak dapat dibuka dari sesi support'));
    }
    return this.run('', 'platform', fn);
  }

  private run<T>(
    tenantId: string,
    contextKind: 'tenant' | 'platform' | 'support',
    fn: (tx: Tx) => Promise<T>,
    support?: SupportRequest,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        // SET TRANSACTION harus mendahului query PERTAMA transaksi - termasuk
        // set_config di bawah, yang juga sebuah query. Karena itu lapisan kedua
        // ADR-003 sec.2.3 dipasang di sini, bukan sesudahnya.
        //
        // Batasnya dikatakan apa adanya di ADR-001 sec.3.10: ini menolak mutasi
        // DI DALAM unit of work, bukan pada kode yang membuka transaksinya
        // sendiri. Lapis pertama tetap permission set di guard.
        if (support?.scope === 'READ_ONLY') {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        }
        // Statement pertama, selalu, transaction-local.
        //
        // statement_timeout ikut di-set di sini (syarat GO spike DEMO-0100):
        // timeout transaksi Prisma TIDAK menghentikan query yang sedang
        // berjalan - di mesin target, batas 300 ms baru ditolak setelah
        // 1013 ms. statement_timeout membuat database sendiri yang memotongnya.
        //
        // app.context_kind ditulis SETIAP transaksi, termasuk saat nilainya
        // 'tenant'. Mengandalkan nilai default berarti mengandalkan sesuatu
        // yang tidak ditulis siapa pun - dan yang tidak ditulis tidak dapat
        // diuji.
        //
        // app.support_session_id juga ditulis setiap transaksi, dan nilai
        // kosongnya penting: tanpa itu, satu transaksi support dapat meninggalkan
        // id sesi di koneksi yang kemudian dipakai request tenant biasa.
        //
        // TimeZone DIPATOK UTC, dan ini bukan kerapian - ini penjaga.
        //
        // Prisma membaca nilai `timestamptz` dari hasil query mentah sebagai jam
        // DINDING sesi database, lalu melabelinya UTC. Di mesin dengan TimeZone
        // server UTC keduanya sama, jadi tidak ada gejala. Di mesin target
        // (PostgreSQL dengan TimeZone Asia/Jakarta) nilai yang sama terbaca
        // TUJUH JAM LEBIH AWAL DARI YANG SEBENARNYA - diukur: node-postgres
        // mengembalikan +30 menit untuk `now() + interval '30 minutes'`,
        // sementara Prisma mengembalikan +450 menit dari nilai yang sama.
        //
        // Akibatnya bukan teoretis: umur token support dihitung dari nilai itu
        // (slice 14 gagal di mesin target karena ini), dan setiap tanggal yang
        // ditampilkan web lewat query mentah ikut bergeser. Memperbaikinya di
        // setiap pemanggil berarti menunggu pemanggil berikutnya lupa; dipatok di
        // sini, seluruh jalur benar sekali untuk selamanya - dan jawabannya sama
        // di mesin mana pun, yang memang tujuan seluruh disiplin ini.
        //
        // Transaction-local, seperti GUC lainnya: koneksi yang kembali ke pool
        // tidak membawa apa pun.
        await tx.$queryRaw`SELECT set_config('TimeZone', 'UTC', true),
                                  set_config('app.current_tenant_id', ${tenantId}, true),
                                  set_config('app.context_kind', ${contextKind}, true),
                                  set_config('app.support_session_id', ${support?.supportSessionId ?? ''}, true),
                                  set_config('statement_timeout', ${String(this.timeout)}, true)`;
        return fn(wrap(tx));
      },
      { timeout: this.timeout, maxWait: this.maxWait },
    );
  }
}
