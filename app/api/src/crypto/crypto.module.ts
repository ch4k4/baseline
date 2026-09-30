import { Global, Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { UnitOfWork } from '../database/unit-of-work.js';
import { FieldCrypto } from './field-crypto.js';
import { loadKek } from './kek-source.js';
import { KeyRing, PLATFORM, PLATFORM_PURPOSES, Purpose, WrappedKeyLoader, WrappedKeyRow } from './key-ring.js';

/**
 * Loader DEK lewat fungsi definer.
 *
 * Kunci TENANT diambil DI DALAM context tenant yang sama (withTenant), karena
 * auth.get_active_key menolak memberikan kunci tenant lain dari luar
 * context-nya. Kunci platform diambil tanpa context.
 */
class DbKeyLoader implements WrappedKeyLoader {
  constructor(private readonly uow: UnitOfWork) {}

  private run<T>(tenantId: string | null, fn: (tx: any) => Promise<T>): Promise<T> {
    return tenantId ? this.uow.withTenant(tenantId, fn) : this.uow.withoutTenant(fn);
  }

  async active(purpose: Purpose, tenantId: string | null): Promise<WrappedKeyRow | null> {
    const rows = await this.run(tenantId, (tx) =>
      tx.query('SELECT * FROM auth.get_active_key($1, $2)', [purpose, tenantId]),
    );
    return (rows as WrappedKeyRow[])[0] ?? null;
  }

  async version(purpose: Purpose, tenantId: string | null, version: number): Promise<WrappedKeyRow | null> {
    const rows = await this.run(tenantId, (tx) =>
      tx.query('SELECT * FROM auth.get_key_version($1, $2, $3)', [purpose, tenantId, version]),
    );
    return (rows as WrappedKeyRow[])[0] ?? null;
  }
}

export const KEY_RING = Symbol('KEY_RING');

@Injectable()
export class CryptoService extends FieldCrypto implements OnModuleInit {
  constructor(@Inject(KEY_RING) private readonly keyRing: KeyRing) {
    super(keyRing);
  }

  /**
   * Kunci platform dimuat saat start, bukan saat login pertama. KEK yang hilang
   * atau tidak cocok harus menghentikan proses dengan pesan yang jelas - bukan
   * membuat setiap login gagal "Email atau password salah" tanpa sebab terlihat.
   */
  async onModuleInit(): Promise<void> {
    for (const purpose of PLATFORM_PURPOSES) await this.keyRing.active(purpose, PLATFORM);
  }

}

@Global()
@Module({
  providers: [
    {
      provide: KEY_RING,
      inject: [UnitOfWork],
      useFactory: (uow: UnitOfWork) => new KeyRing(loadKek(), new DbKeyLoader(uow)),
    },
    CryptoService,
  ],
  exports: [CryptoService],
})
export class CryptoModule {}
