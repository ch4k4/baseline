import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../database/unit-of-work.js';

/**
 * Resolver permission efektif (DEMO-0303).
 *
 * Perhitungannya ada di view effective_permissions (0013): membership aktif,
 * assignment aktif, role tidak diarsipkan, permission tenant yang belum pensiun.
 * View itu berjalan dengan hak pemanggil (security_invoker), jadi RLS tenant
 * yang sama berlaku - resolver tidak dapat membaca permission tenant lain walau
 * diberi membership_id tenant lain.
 *
 * Tidak ada cache. Mencabut role berlaku pada permintaan berikutnya; cache
 * menukar itu dengan satu query per permintaan, dan pertukaran itu belum perlu.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly uow: UnitOfWork) {}

  async effective(tenantId: string, membershipId: string): Promise<Set<string>> {
    const rows = await this.uow.withTenant(tenantId, (tx) =>
      tx.query<{ permission_code: string }>(
        'SELECT permission_code FROM effective_permissions WHERE membership_id = $1',
        [membershipId],
      ),
    );
    return new Set(rows.map((r) => r.permission_code));
  }

  /**
   * Permission efektif pada context PLATFORM (DEMO-0311).
   *
   * Dihitung dari dua tabel, bukan dari nama role: assignment yang belum dicabut
   * x pemetaan role platform -> permission. Keduanya hanya terbaca pada context
   * platform (policy 0018), sehingga session tenant tidak dapat memanggil ini
   * dan diam-diam mendapat hak platform - ia akan mendapat himpunan kosong.
   *
   * Permission yang sudah pensiun dilewati, sama seperti jalur tenant.
   */
  async platformEffective(userId: string): Promise<Set<string>> {
    const rows = await this.uow.withPlatform((tx) =>
      tx.query<{ permission_code: string }>(
        `SELECT DISTINCT rp.permission_code
         FROM platform_role_assignments a
         JOIN platform_role_permissions rp ON rp.role_code = a.role_code
         JOIN permissions p ON p.code = rp.permission_code AND p.scope = 'PLATFORM'
         WHERE a.user_id = $1
           AND a.revoked_at IS NULL
           AND p.retired_at IS NULL`,
        [userId],
      ),
    );
    return new Set(rows.map((r) => r.permission_code));
  }

  /**
   * Nama tenant aktif, dibaca DI DALAM context tenant (atau support) yang sedang
   * berjalan. Dipakai banner mode support: banner tanpa nama tenant memaksa orang
   * mencocokkan UUID sendiri, dan orang yang salah membaca UUID akan menyokong
   * tenant yang salah tanpa sadar.
   */
  async tenantName(tenantId: string): Promise<string | null> {
    const rows = await this.uow.withTenant(tenantId, (tx) =>
      tx.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenantId]),
    );
    return rows[0]?.name ?? null;
  }

  /** Katalog permission yang dapat dipasang ke role tenant (tanpa platform, tanpa yang pensiun). */
  async tenantCatalog(tenantId: string): Promise<Array<{ code: string; description: string }>> {
    return this.uow.withTenant(tenantId, (tx) =>
      tx.query<{ code: string; description: string }>(
        `SELECT code, description FROM permissions
         WHERE scope = 'TENANT' AND retired_at IS NULL ORDER BY code`,
      ),
    );
  }
}
