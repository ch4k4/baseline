import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../authz/access.decorator.js';
import { uuid } from '../admin/admin-rules.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Demo Foundation sec.11.1: GET /notifications/security dan
 * POST /notifications/security/:id/read, keduanya audit.read.
 *
 * audit.read, bukan permission baru: yang dibaca di sini adalah kejadian
 * keamanan tenant - orang yang sama yang berhak membaca audit tenant.
 */
@Controller('api/v1/notifications/security')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission('audit.read')
  async list(@Req() req: any) {
    const tenantId = req.session.tenant_id;
    return {
      notifications: await this.notifications.list(tenantId),
      unread: await this.notifications.unreadCount(tenantId),
    };
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequirePermission('audit.read')
  async read(@Req() req: any, @Param('id') id: string) {
    return this.notifications.markRead(
      req.session.tenant_id,
      req.session.membership_id,
      uuid(id, 'id'),
    );
  }
}
