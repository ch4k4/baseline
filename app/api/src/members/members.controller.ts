import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ResolvedSession } from '../auth/pre-context.repository.js';
import { RequirePermission } from '../authz/access.decorator.js';
import { uuid, uuidList, version } from '../admin/admin-rules.js';
import { MembersService } from './members.service.js';

const STATUSES = new Set(['ACTIVE', 'SUSPENDED', 'ENDED']);

function intParam(raw: unknown, field: string, def: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`${field} harus ${min}..${max}.`);
  return n;
}

/**
 * Administrasi anggota (Demo Foundation sec.11.3). Resource = membership_id,
 * tidak pernah user_id global (ADR-002). Tidak ada jalur ke users/credentials.
 */
@Controller('api/v1/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('members.read')
  async list(@Req() req: any, @Query() q: Record<string, unknown>) {
    const session: ResolvedSession = req.session;
    const tenantId = session.tenant_id as string;
    if (q.status !== undefined && !STATUSES.has(String(q.status))) throw new BadRequestException('status tidak dikenal.');
    const limit = intParam(q.limit, 'limit', 50, 1, 100);
    const offset = intParam(q.offset, 'offset', 0, 0, 100_000);
    const { members, total } = await this.members.list(tenantId, {
      status: q.status as string | undefined,
      roleId: q.roleId === undefined ? undefined : uuid(q.roleId, 'roleId'),
      email: typeof q.email === 'string' && q.email ? q.email : undefined,
      limit, offset,
    });
    // canInvite hanya petunjuk tampilan, dari permission yang sudah dihitung guard.
    const granted: Set<string> = req.permissions ?? new Set();
    return { tenantId, members, page: { limit, offset, total }, canInvite: granted.has('members.invite') };
  }

  @Get(':membershipId')
  @RequirePermission('members.read')
  async detail(@Req() req: any, @Param('membershipId') id: string) {
    return this.members.detail(req.session.tenant_id, uuid(id, 'membershipId'));
  }

  @Patch(':membershipId/profile')
  @RequirePermission('members.update_profile')
  async profile(@Req() req: any, @Param('membershipId') id: string, @Body() body: any) {
    if (typeof body?.displayName !== 'string') throw new BadRequestException('displayName wajib diisi.');
    return this.members.updateProfile(req.session, uuid(id, 'membershipId'), body.displayName, version(body?.version));
  }

  @Post(':membershipId/suspend')
  @HttpCode(200)
  @RequirePermission('members.suspend')
  async suspend(@Req() req: any, @Param('membershipId') id: string, @Body() body: any) {
    return this.members.suspend(req.session, req.permissions, uuid(id, 'membershipId'), version(body?.version));
  }

  @Post(':membershipId/reactivate')
  @HttpCode(200)
  @RequirePermission('members.suspend')
  async reactivate(@Req() req: any, @Param('membershipId') id: string, @Body() body: any) {
    return this.members.reactivate(req.session, req.permissions, uuid(id, 'membershipId'), version(body?.version));
  }

  @Put(':membershipId/roles')
  @RequirePermission('members.assign_role')
  async roles(@Req() req: any, @Param('membershipId') id: string, @Body() body: any) {
    return this.members.replaceRoles(
      req.session, req.permissions, uuid(id, 'membershipId'), uuidList(body?.roleIds, 'roleIds'), version(body?.version));
  }
}
