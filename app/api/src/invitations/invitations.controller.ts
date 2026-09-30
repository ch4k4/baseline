import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Public, RequirePermission } from '../authz/access.decorator.js';
import { uuidList } from '../admin/admin-rules.js';
import { ResolvedSession } from '../auth/pre-context.repository.js';
import { InvitationService } from './invitation.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Token = 32 byte acak base64url (43 karakter). Bentuk lain ditolak di tepi.
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function str(value: unknown, field: string, max = 1024): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new BadRequestException(`${field} wajib diisi.`);
  }
  return value;
}

function token(value: unknown): string {
  const t = str(value, 'token', 64);
  if (!TOKEN_RE.test(t)) throw new BadRequestException('token tidak sah.');
  return t;
}

@Controller('api/v1/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationService) {}

  // ---------------------------------------------------------------- admin tenant

  @Post()
  @HttpCode(202)
  @RequirePermission('members.invite')
  async invite(@Req() req: any, @Body() body: unknown) {
    const { email, roleIds } = (body ?? {}) as Record<string, unknown>;
    // roleIds opsional (DEMO-0309); tanpa role = anggota default-deny.
    const roles = roleIds === undefined ? [] : uuidList(roleIds, 'roleIds', 20);
    return this.invitations.invite(req.session as ResolvedSession, str(email, 'email', 320), roles, req.permissions);
  }

  // Demo Foundation sec.11.1a: melihat status undangan cukup members.read.
  // Slice 9-10 memakai members.invite - penyimpangan yang diperbaiki di slice 11.
  @Get()
  @RequirePermission('members.read')
  async list(@Req() req: any) {
    return { invitations: await this.invitations.list(req.session as ResolvedSession) };
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermission('members.invite')
  async revoke(@Req() req: any, @Param('id') id: string) {
    if (!UUID_RE.test(id)) throw new BadRequestException('id bukan UUID yang sah.');
    return this.invitations.revoke(req.session as ResolvedSession, id);
  }

  // ---------------------------------------------------------------- penerima (publik)

  @Post('lookup')
  @HttpCode(200)
  @Public()
  async lookup(@Body() body: unknown) {
    return this.invitations.lookup(token((body as Record<string, unknown> | null)?.token));
  }

  @Post('accept')
  @HttpCode(200)
  @Public()
  async accept(@Body() body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    return this.invitations.accept(token(b.token), str(b.password, 'password', 200), str(b.displayName, 'displayName', 400));
  }
}
