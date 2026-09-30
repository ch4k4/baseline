import { Pool } from 'pg';

export const PG_POOL = Symbol('PG_POOL');

/**
 * Aplikasi SELALU terhubung sebagai app_user: tanpa BYPASSRLS, bukan pemilik tabel,
 * tanpa grant ke users/credentials. app_owner hanya dipakai migrasi.
 *
 * max sengaja kecil supaya koneksi benar-benar dipakai ulang lintas request —
 * kondisi yang dibutuhkan test kebocoran context.
 */
export function createPool(): Pool {
  return new Pool({
    host: process.env.DEMO_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DEMO_DB_PORT ?? 5432),
    database: process.env.DEMO_DB_NAME ?? 'saas_demo',
    user: 'app_user',
    password: process.env.DEMO_DB_USER_PASSWORD ?? 'devuser',
    max: Number(process.env.DEMO_DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
}
