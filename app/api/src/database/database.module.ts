import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL, createPool } from './pool.js';
import { PRISMA, createPrisma, type PrismaClient } from './prisma.js';
import { UnitOfWork, UOW_OPTIONS, uowOptionsFromEnv } from './unit-of-work.js';

@Global()
@Module({
  providers: [
    { provide: PG_POOL, useFactory: createPool },
    { provide: PRISMA, useFactory: createPrisma, inject: [PG_POOL] },
    { provide: UOW_OPTIONS, useFactory: uowOptionsFromEnv },
    UnitOfWork,
  ],
  // PRISMA sengaja TIDAK diekspor: repository hanya boleh menyentuh database lewat
  // UnitOfWork. Client global berjalan di koneksi tanpa set_config.
  exports: [PG_POOL, UnitOfWork],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
    await this.pool.end();
  }
}
