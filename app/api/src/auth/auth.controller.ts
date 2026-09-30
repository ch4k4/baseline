import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import { AuthService, LoginResult } from './auth.service.js';
import { Authenticated, Public } from '../authz/access.decorator.js';
import { ResolvedSession } from './pre-context.repository.js';
import { clientIpOf } from './client-ip.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException(`${field} wajib diisi.`);
  }
  return value;
}

function requireUuid(value: unknown, field: string): string {
  const s = requireString(value, field);
  // Bentuk diperiksa di tepi, bukan di dalam. Nilai sampah yang sampai ke database
  // menjadi error tipe, dan error tipe menjadi 500 - dan 500 membocorkan lebih
  // banyak daripada 400.
  if (!UUID_RE.test(s)) throw new BadRequestException(`${field} bukan UUID yang sah.`);
  return s;
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  async login(@Req() req: any, @Body() body: unknown): Promise<LoginResult> {
    const { email, password } = (body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new BadRequestException('email dan password wajib diisi.');
    }
    return this.auth.login(email, password, clientIpOf(req));
  }

  /**
   * `kind` boleh tidak dikirim dan berarti TENANT: bentuk permintaan sebelum
   * DEMO-0311 tetap berlaku. PLATFORM tidak membawa tenantId - kalau dikirim,
   * ditolak, karena permintaan yang isinya bertentangan lebih baik gagal
   * daripada ditafsirkan.
   */
  @Post('select-context')
  @Public()
  async selectContext(@Body() body: unknown) {
    const { ticket, tenantId, kind } = (body ?? {}) as Record<string, unknown>;
    const t = requireString(ticket, 'ticket');

    if (kind !== undefined && kind !== 'TENANT' && kind !== 'PLATFORM') {
      throw new BadRequestException('kind harus TENANT atau PLATFORM.');
    }
    if (kind === 'PLATFORM') {
      if (tenantId !== undefined && tenantId !== null) {
        throw new BadRequestException('context PLATFORM tidak membawa tenantId.');
      }
      return this.auth.selectContext(t, { kind: 'PLATFORM' });
    }
    return this.auth.selectContext(t, {
      kind: 'TENANT',
      tenantId: requireUuid(tenantId, 'tenantId'),
    });
  }

  @Post('refresh')
  @Public()
  async refresh(@Body() body: unknown) {
    const { refreshToken } = (body ?? {}) as Record<string, unknown>;
    return this.auth.refresh(requireString(refreshToken, 'refreshToken'));
  }

  @Post('logout')
  @Authenticated()
  async logout(@Req() req: any): Promise<{ status: string }> {
    const session: ResolvedSession = req.session;
    await this.auth.logout(session.session_id, session.user_id, session.tenant_id);
    return { status: 'OK' };
  }
}

@Controller('api/v1/me')
@Authenticated()
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get('contexts')
  async contexts(@Req() req: any) {
    const session: ResolvedSession = req.session;
    return { contexts: await this.auth.listContexts(session.user_id) };
  }

  @Post('context-switch')
  async switch(@Req() req: any, @Body() body: unknown) {
    const session: ResolvedSession = req.session;
    const { tenantId } = (body ?? {}) as Record<string, unknown>;
    return this.auth.switchContext(
      session.session_id,
      session.user_id,
      requireUuid(tenantId, 'tenantId'),
    );
  }
}
