import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PreContextRepository, ResolvedSession } from './pre-context.repository.js';
import { AccessClaims, JwtService } from './jwt.service.js';
import { markSupportRequest } from '../database/support-context.js';

export interface RequestWithSession extends Request {
  session?: ResolvedSession;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Access token adalah JWT bertanda tangan (D-03 lunas di slice 7).
 *
 * DUA PEMERIKSAAN, DAN KEDUANYA TETAP ADA:
 *
 *   1. tanda tangan  - membuktikan token tidak diubah, tanpa menyentuh database;
 *   2. session       - membuktikan session masih hidup, dan itu HANYA diketahui
 *                      database.
 *
 * Menghapus yang kedua adalah godaan yang wajar ("kan sudah ada klaimnya") dan
 * itulah cara logout berhenti bekerja: token yang sudah terbit tetap sah sampai
 * kedaluwarsa, sehingga "keluar" hanya berarti browser lupa. Yang membuat biaya
 * pemeriksaan ini masuk akal adalah umur token yang pendek - bukan menghapusnya.
 *
 * Klaim di dalam token TIDAK dipakai sebagai sumber tenant. Tenant diambil dari
 * baris session, lalu dicocokkan dengan klaim. Kalau keduanya berbeda, token itu
 * sah tapi sudah tidak menggambarkan keadaan - dan yang benar adalah database.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly preContext: PreContextRepository,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<any>();
    const header: string | undefined = req.headers?.authorization;

    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    const token = header.slice('Bearer '.length).trim();

    // Verifikasi tanda tangan lebih dulu: token sampah tidak perlu menjadi
    // query. Ini juga yang menahan session id mentah - bentuk token sebelum
    // slice 7 - dari tetap diterima diam-diam.
    const claims = this.jwt.verify(token);
    if (!claims) throw new UnauthorizedException();

    // Bentuk sid disaring walau tanda tangannya sah: nilai bukan-UUID yang
    // sampai ke database menjadi error tipe, dan error tipe menjadi 500 - dan
    // 500 membocorkan lebih banyak daripada 401.
    if (!UUID_RE.test(claims.sid)) throw new UnauthorizedException();

    // Token support (DEMO-0312) punya jalurnya sendiri: `sid` di dalamnya adalah
    // session PLATFORM yang membukanya, dan yang menentukan berlakunya adalah
    // baris support_sessions - diperiksa ulang SETIAP request.
    if (claims.ctx === 'SUPPORT') return this.aktifkanSupport(req, claims);

    const session = await this.preContext.findSession(claims.sid);
    if (!session) throw new UnauthorizedException();

    // context_kind ikut dibandingkan sejak DEMO-0311. Tanpa itu, token yang sah
    // milik session PLATFORM dapat mengaku TENANT (atau sebaliknya) dan guard
    // route hanya melihat klaim - padahal yang berlaku adalah baris session.
    if (
      session.user_id !== claims.sub ||
      session.tenant_id !== claims.tid ||
      session.context_kind !== claims.ctx
    ) {
      throw new UnauthorizedException();
    }

    req.session = session;
    return true;
  }

  /**
   * Sesi support: DUA baris database yang harus keduanya hidup.
   *
   *   1. session PLATFORM (`sid`) - begitu dicabut atau kedaluwarsa, token support
   *      ikut mati. Inilah ADR-003 sec.2.6 butir 5, dan ia bekerja tanpa kode
   *      pembersih: yang mengakhiri sesi adalah ketiadaan baris, bukan sebuah job.
   *   2. baris support_sessions ACTIVE yang belum kedaluwarsa (F-18).
   *
   * Scope diambil dari BARIS, bukan dari klaim. Klaim memang bertanda tangan,
   * tetapi ia adalah salinan keadaan saat token terbit; yang berlaku adalah
   * database. Klaim yang tidak cocok dengan baris ditolak - bukan diperbaiki
   * diam-diam - karena satu-satunya cara itu terjadi adalah sesuatu yang tidak
   * dipahami kode ini.
   */
  private async aktifkanSupport(req: any, claims: AccessClaims): Promise<boolean> {
    if (!claims.ssid || !UUID_RE.test(claims.ssid) || !claims.tid) throw new UnauthorizedException();

    const platform = await this.preContext.findSession(claims.sid);
    if (
      !platform ||
      platform.context_kind !== 'PLATFORM' ||
      platform.tenant_id !== null ||
      platform.user_id !== claims.sub
    ) {
      throw new UnauthorizedException();
    }

    const support = await this.preContext.findSupportSession(claims.ssid);
    if (
      !support ||
      support.superadmin_user_id !== claims.sub ||
      support.tenant_id !== claims.tid ||
      support.platform_session_id !== claims.sid ||
      support.scope !== claims.scp
    ) {
      throw new UnauthorizedException();
    }

    const konteks = {
      remainingSeconds: support.remaining_seconds,
      supportSessionId: support.id,
      tenantId: support.tenant_id,
      scope: support.scope,
      superadminUserId: support.superadmin_user_id,
      platformSessionId: support.platform_session_id,
    };
    // Menandai permintaan SEBELUM handler berjalan: sejak titik ini setiap
    // withTenant() di dalam permintaan ini menjadi transaksi support (context
    // 'support', app.support_session_id terisi, READ ONLY bila perlu).
    markSupportRequest(konteks);

    req.support = konteks;
    req.session = {
      session_id: support.platform_session_id,
      context_kind: 'SUPPORT',
      tenant_id: support.tenant_id,
      user_id: support.superadmin_user_id,
      membership_id: null,
      expires_at: support.expires_at,
    } satisfies ResolvedSession;
    return true;
  }
}
