import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { RequirePermission, RequirePlatformPermission } from '../authz/access.decorator.js';
import { uuid } from '../admin/admin-rules.js';
import { SupportActor, SupportService } from './support.service.js';

/**
 * Route support session (Demo Foundation sec.11.2, DEMO-0312).
 *
 * Ketiganya memerlukan `platform.support.start_read` - termasuk yang membuka sesi
 * READ_WRITE. Sebabnya bukan kelalaian: guard memeriksa SATU permission per route,
 * sedangkan scope ditentukan isi permintaan. Karena itu `start_write` diperiksa di
 * service, atas permission efektif yang sudah dihitung guard (bukan dihitung ulang).
 * Memecahnya menjadi dua route akan membuat "sesi support" punya dua alamat dan dua
 * jalur audit untuk satu kejadian yang sama.
 *
 * `/end` juga `start_read`: mengakhiri sesi - termasuk sesi superadmin lain - tidak
 * boleh lebih sulit daripada membukanya. Menghentikan akses yang sedang berjalan
 * adalah tindakan yang harus mudah; yang dijaga ketat adalah membukanya.
 */
@Controller('api/v1/platform/support-sessions')
export class SupportSessionsController {
  constructor(private readonly support: SupportService) {}

  private actor(req: any): SupportActor {
    return {
      userId: req.session.user_id,
      sessionId: req.session.session_id,
      permissions: req.permissions ?? new Set<string>(),
    };
  }

  @Get()
  @RequirePlatformPermission('platform.support.start_read')
  async list(@Req() req: any) {
    return this.support.list(this.actor(req));
  }

  @Post()
  @RequirePlatformPermission('platform.support.start_read')
  async start(@Req() req: any, @Body() body: any) {
    if (typeof body?.tenantId !== 'string') throw new BadRequestException('tenantId wajib diisi.');
    if (typeof body?.reasonCode !== 'string') throw new BadRequestException('reasonCode wajib diisi.');
    if (typeof body?.reasonText !== 'string') throw new BadRequestException('reasonText wajib diisi.');
    if (body?.ticketReference !== undefined && body?.ticketReference !== null && typeof body.ticketReference !== 'string') {
      throw new BadRequestException('ticketReference harus teks.');
    }

    return this.support.start(this.actor(req), {
      tenantId: uuid(body.tenantId, 'tenantId'),
      reasonCode: body.reasonCode,
      reasonText: body.reasonText,
      // Bawaan READ_ONLY (ADR-003 sec.2.2 butir 1): permintaan yang tidak menyebut
      // scope TIDAK boleh mendapat hak tulis karena kelalaian pemanggil.
      scope: typeof body?.scope === 'string' ? body.scope : 'READ_ONLY',
      durationMinutes: typeof body?.durationMinutes === 'number' ? body.durationMinutes : 30,
      ticketReference: body.ticketReference ?? null,
    });
  }

  @Post(':id/end')
  @HttpCode(200)
  @RequirePlatformPermission('platform.support.start_read')
  async end(@Req() req: any, @Param('id') id: string) {
    return this.support.end(this.actor(req), uuid(id, 'id'));
  }
}

/**
 * Sisi TENANT dari sesi dukungan (ADR-003 sec.2.4, sec.2.2 butir 7).
 *
 * Route tenant, permission tenant: `audit.read` - orang yang sama yang berhak
 * membaca audit tenant. Tenant tidak dapat membuat, mengubah, maupun mengakhiri
 * sesi support dari sini; ia hanya melihat. Tidak adanya aksi di sini bukan
 * kekurangan yang belum digarap: mengakhiri sesi support adalah tindakan platform,
 * dan memberi tenant tombolnya akan membuat tenant dapat menghalangi penelusuran
 * insiden atas dirinya sendiri.
 */
@Controller('api/v1/support-sessions')
export class TenantSupportSessionsController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @RequirePermission('audit.read')
  async list(@Req() req: any) {
    return this.support.listForTenant(req.session.tenant_id);
  }
}
