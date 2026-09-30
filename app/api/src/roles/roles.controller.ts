import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../authz/access.decorator.js';
import { uuid, version } from '../admin/admin-rules.js';
import { RolesService } from './roles.service.js';

/** Demo Foundation sec.11.4. DELETE = arsip, bukan hapus: riwayat assignment tetap. */
@Controller('api/v1/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('roles.read')
  async list(@Req() req: any) {
    return { roles: await this.roles.list(req.session.tenant_id) };
  }

  @Get(':id')
  @RequirePermission('roles.read')
  async detail(@Req() req: any, @Param('id') id: string) {
    return this.roles.detail(req.session.tenant_id, uuid(id, 'id'));
  }

  @Post()
  @RequirePermission('roles.create')
  async create(@Req() req: any, @Body() body: any) {
    if (typeof body?.code !== 'string' || typeof body?.name !== 'string') throw new BadRequestException('code dan name wajib diisi.');
    return this.roles.create(req.session, body.code, body.name);
  }

  @Patch(':id')
  @RequirePermission('roles.update')
  async rename(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    if (typeof body?.name !== 'string') throw new BadRequestException('name wajib diisi.');
    return this.roles.rename(req.session, uuid(id, 'id'), body.name, version(body?.version));
  }

  @Delete(':id')
  @RequirePermission('roles.archive')
  async archive(@Req() req: any, @Param('id') id: string, @Query('version') v: string) {
    return this.roles.archive(req.session, req.permissions, uuid(id, 'id'), version(Number(v)));
  }

  @Put(':id/permissions')
  @RequirePermission('roles.assign_permission')
  async permissions(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const list = body?.permissions;
    if (!Array.isArray(list) || list.length > 100 || list.some((p: unknown) => typeof p !== 'string')) {
      throw new BadRequestException('permissions harus daftar kode permission.');
    }
    return this.roles.replacePermissions(req.session, req.permissions, uuid(id, 'id'), [...new Set<string>(list)], version(body?.version));
  }
}
