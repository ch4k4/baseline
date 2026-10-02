import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePlatformPermission } from '../authz/access.decorator.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';

/**
 * Registry tenant (ADR-003 sec.2.1, Demo Foundation sec.11.2).
 *
 * `POST` di sini adalah satu-satunya jalan membuat tenant tanpa skrip seed: ia
 * memasang kunci enkripsi (D-17) dan role sistem (D-25) sekaligus. Rinciannya dan
 * batas-batasnya ada di TenantProvisioningService.
 *
 * `PATCH /:id/status` mensuspend atau mengaktifkan kembali tenant (D-47). Ia baru
 * berarti sejak F-21 menolak session tenant yang tidak ACTIVE (migrasi 0024) -
 * sebelum itu, status hanya kolom yang tidak dibaca request mana pun.
 */
@Controller('api/v1/platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: TenantProvisioningService) {}

  @Get()
  @RequirePlatformPermission('platform.tenants.read')
  async list() {
    return { tenants: await this.tenants.list() };
  }

  @Post()
  @RequirePlatformPermission('platform.tenants.create')
  async create(@Req() req: any, @Body() body: any) {
    for (const wajib of ['slug', 'name', 'ownerUserId', 'ownerDisplayName', 'ownerContactEmail']) {
      if (typeof body?.[wajib] !== 'string' || body[wajib].trim() === '') {
        throw new BadRequestException(`${wajib} wajib diisi.`);
      }
    }
    return this.tenants.create(
      {
        slug: body.slug,
        name: body.name,
        ownerUserId: body.ownerUserId,
        ownerDisplayName: body.ownerDisplayName,
        ownerContactEmail: body.ownerContactEmail,
      },
      req.session.user_id,
      req.session.session_id,
    );
  }

  @Patch(':id/status')
  @RequirePlatformPermission('platform.tenants.update_status')
  async changeStatus(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.tenants.changeStatus(id, body?.status, req.session.user_id, req.session.session_id);
  }
}
