import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { RequirePlatformPermission } from '../authz/access.decorator.js';
import { uuid } from '../admin/admin-rules.js';
import { PlatformActor, PlatformService } from './platform.service.js';

/**
 * Route platform (Demo Foundation sec.11.2, DEMO-0311).
 *
 * Seluruhnya memakai @RequirePlatformPermission, yang menolak session TENANT
 * sebelum permission diperiksa: token tenant tidak dapat menyentuh route ini
 * walau entah bagaimana memegang kode permission platform, dan token platform
 * tidak dapat menyentuh route tenant (ADR-003 sec.2.6 butir 2).
 *
 * Menambah admin memakai user_id, BUKAN email. Sebabnya dua: superadmin tidak
 * membaca identitas global dalam bentuk terbuka (ADR-003 sec.2.1), dan pencarian
 * identitas berdasarkan email akan menjadi permukaan enumerasi baru di tingkat
 * platform. Akibatnya memang tidak nyaman - id harus didapat dari luar aplikasi -
 * dan itu dicatat sebagai utang, bukan dianggap selesai.
 */
@Controller('api/v1/platform/admins')
export class PlatformAdminsController {
  constructor(private readonly platform: PlatformService) {}

  private actor(req: any): PlatformActor {
    return { userId: req.session.user_id, sessionId: req.session.session_id };
  }

  @Get()
  @RequirePlatformPermission('platform.admins.read')
  async list() {
    return { admins: await this.platform.listAdmins() };
  }

  @Post()
  @RequirePlatformPermission('platform.admins.manage')
  async grant(@Req() req: any, @Body() body: any) {
    if (typeof body?.userId !== 'string') throw new BadRequestException('userId wajib diisi.');
    if (body?.reason !== undefined && body?.reason !== null && typeof body.reason !== 'string') {
      throw new BadRequestException('reason harus teks.');
    }
    return this.platform.grant(this.actor(req), uuid(body.userId, 'userId'), body.reason ?? null);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePlatformPermission('platform.admins.manage')
  async revoke(@Req() req: any, @Param('id') id: string) {
    await this.platform.revoke(this.actor(req), uuid(id, 'id'));
    return { status: 'REVOKED' };
  }
}
