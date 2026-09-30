import { Controller, Get, Req } from '@nestjs/common';
import { ResolvedSession } from '../auth/pre-context.repository.js';
import { AuthenticatedWithSupport, RequirePermission } from './access.decorator.js';
import { PermissionService } from './permission.service.js';
import { SupportRequest } from '../database/support-context.js';
import { supportPermissions } from '../support/support-permissions.js';

/**
 * Katalog permission untuk administrasi role tenant (DEMO-0301). Hanya kode dan
 * deskripsi permission TENANT: permission platform tidak dapat dipasang ke role
 * tenant, jadi tidak ada gunanya - dan tidak perlu - diperlihatkan ke tenant.
 */
@Controller('api/v1/permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionService) {}

  @Get()
  @RequirePermission('permissions.read')
  async list(@Req() req: any) {
    const session: ResolvedSession = req.session;
    return { permissions: await this.permissions.tenantCatalog(session.tenant_id as string) };
  }
}

/**
 * Permission efektif milik session ini (DEMO-0303: "hasil dapat dipakai guard
 * dan menu resolver"). Untuk tampilan saja; keputusan tetap di guard.
 */
@Controller('api/v1/me/permissions')
export class MyPermissionsController {
  constructor(private readonly permissions: PermissionService) {}

  @Get()
  @AuthenticatedWithSupport()
  async mine(@Req() req: any) {
    const session: ResolvedSession = req.session;

    // Sesi support (DEMO-0312): hak yang dijawab adalah himpunan TETAP dari kode,
    // bukan permission efektif sebuah membership - sesi ini tidak punya membership.
    // Sisa waktu ikut dikirim karena banner "mode support" harus dapat
    // menampilkannya; sisa waktu yang tidak terlihat sama saja dengan tidak ada
    // batas waktu dari sudut pandang orang yang memakainya.
    if (session.context_kind === 'SUPPORT') {
      const support: SupportRequest = req.support;
      return {
        kind: 'SUPPORT',
        tenantId: support.tenantId,
        permissions: [...supportPermissions(support.scope)].sort(),
        support: {
          sessionId: support.supportSessionId,
          scope: support.scope,
          expiresAt: session.expires_at,
          remainingSeconds: support.remainingSeconds ?? null,
          tenantName: await this.permissions.tenantName(support.tenantId),
        },
      };
    }

    // kind dikembalikan sejak DEMO-0311. Tanpa itu, session PLATFORM mendapat
    // jawaban yang tidak dapat dibedakan dari anggota tenant tanpa hak apa pun -
    // dan web merendernya sebagai kerangka tenant kosong: jalan buntu, bukan
    // penolakan. Hak platform TIDAK dikembalikan di sini; ini jalur tampilan
    // tenant, dan yang memutuskan route platform tetap guard-nya.
    if (session.context_kind !== 'TENANT' || !session.tenant_id || !session.membership_id) {
      return { kind: session.context_kind, tenantId: null, permissions: [] };
    }
    const granted = await this.permissions.effective(session.tenant_id, session.membership_id);
    return { kind: 'TENANT', tenantId: session.tenant_id, permissions: [...granted].sort() };
  }
}
