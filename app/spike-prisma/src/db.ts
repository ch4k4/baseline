import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Satu-satunya tempat PrismaClient dibuat (ditegakkan scripts/lint-guc.mjs).
 *
 * Pool pg dibuat SENDIRI lalu diserahkan ke adapter, bukan connection string.
 * Akibatnya: (1) pool yang sama dapat dipakai bersama kode `pg` lama selama
 * migrasi bertahap; (2) ukuran pool dan role koneksi (app_user) dikendalikan di
 * sini, bukan tersebar di konfigurasi Prisma.
 */
export function createPool(max = Number(process.env.DEMO_DB_POOL_MAX ?? 5)): Pool {
  return new Pool({
    host: process.env.DEMO_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DEMO_DB_PORT ?? 5432),
    database: process.env.DEMO_DB_NAME ?? 'saas_demo',
    user: 'app_user',
    password: process.env.DEMO_DB_USER_PASSWORD ?? 'devuser',
    max,
  });
}

export function createPrisma(pool: Pool): PrismaClient {
  // disposeExternalPool=false: pool milik pemanggil, bukan milik Prisma.
  return new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: false }) });
}

export type { PrismaClient };
