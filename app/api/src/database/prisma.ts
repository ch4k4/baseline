import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export const PRISMA = Symbol('PRISMA');

/**
 * Satu-satunya tempat PrismaClient dibuat (ditegakkan scripts/lint-guc.mjs).
 *
 * Adapter menerima pool pg milik DatabaseModule, bukan connection string:
 * role koneksi (app_user), ukuran pool, dan penutupannya tetap dikendalikan di
 * satu tempat (pool.ts). disposeExternalPool=false karena pool bukan milik
 * Prisma; DatabaseModule yang menutupnya saat shutdown.
 */
export function createPrisma(pool: Pool): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: false }) });
}

export type { PrismaClient };
