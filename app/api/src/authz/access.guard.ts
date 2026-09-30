import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionGuard } from '../auth/session.guard.js';
import { AuditService } from '../auth/audit.service.js';
import { ResolvedSession } from '../auth/pre-context.repository.js';
import { ACCESS_KEY, Access } from './access.decorator.js';
import { PermissionService } from './permission.service.js';
import { SupportRequest } from '../database/support-context.js';
import {
  SUPPORT_MUTATION_SET,
  isMutatingMethod,
  supportPermissions,
} from '../support/support-permissions.js';

/**
 * Guard global (APP_GUARD) untuk SEMUA route. Menggantikan @UseGuards(SessionGuard)
 * per controller: memeriksa session dan permission di satu tempat, sehingga tidak
 * ada controller yang dapat "lupa" dipasangi guard.
 *
 * Urutan: deklarasi akses -> session -> context TENANT -> permission efektif.
 * Permission efektif disimpan di req.permissions untuk dipakai handler (misalnya
 * petunjuk tampilan canInvite), bukan dihitung ulang.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionGuard,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<Access | undefined>(ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!access) {
      // Deny-by-default. Ini kesalahan pengembang, bukan pengguna: dicatat keras.
      console.error(`[authz] route tanpa deklarasi akses: ${context.getClass().name}.${context.getHandler().name}`);
      throw new ForbiddenException('Akses ditolak.');
    }
    if (access.kind === 'public') return true;

    await this.sessions.canActivate(context);

    const req = context.switchToHttp().getRequest<any>();
    const session: ResolvedSession = req.session;

    if (access.kind === 'identity') {
      // Route identitas (keluar, data diri sendiri, ganti context) TIDAK terbuka
      // untuk sesi support. Sesi support bukan "sebuah identitas yang sedang
      // masuk di tenant ini": ia tidak punya membership, tidak punya profil, dan
      // tidak boleh dapat memakai POST /me/context-switch untuk menukar dirinya
      // menjadi session tenant biasa. Pengecualiannya satu, dideklarasikan
      // eksplisit: /me/permissions, yang dipakai layar untuk menampilkan banner
      // mode support.
      if (session.context_kind === 'SUPPORT' && !access.supportAllowed) {
        throw new ForbiddenException('Route ini tidak tersedia di dalam sesi support.');
      }
      return true;
    }

    // Context diperiksa SEBELUM permission, dan tidak ada jalur yang menerima
    // keduanya. Token PLATFORM di route tenant ditolak di sini, begitu pula
    // sebaliknya (ADR-003 sec.2.6 butir 2) - bukan karena permission-nya kurang,
    // melainkan karena session itu bukan untuk tempat ini.
    if (access.kind === 'platform') {
      if (session.context_kind !== 'PLATFORM' || session.tenant_id) {
        throw new ForbiddenException('Session ini bukan context platform.');
      }
      return this.decide(
        req,
        session,
        access.permission,
        await this.permissions.platformEffective(session.user_id),
      );
    }

    // Sesi support memakai route tenant biasa, dengan permission set TETAP dari
    // kode - bukan role tenant mana pun (ADR-003 sec.2.2 butir 2).
    if (session.context_kind === 'SUPPORT') {
      const support: SupportRequest = req.support;

      // Permintaan yang MENGUBAH keadaan hanya lolos untuk permission yang
      // memang disetujui untuk diubah support. Pemeriksaan ini terpisah dari
      // himpunan permission, dan itu bukan kelebihan: POST
      // /notifications/security/:id/read memerlukan audit.read - permission BACA
      // di route TULIS. Tanpa pemeriksaan metode, sesi support dapat menandai
      // notifikasi tentang dirinya sendiri sebagai sudah dibaca, yaitu menghapus
      // peringatan dari layar tenant yang justru menjadi alasan break-glass dapat
      // diterima.
      const mengubah = isMutatingMethod(req.method);
      if (mengubah && !SUPPORT_MUTATION_SET.has(access.permission)) {
        return this.tolak(req, session, access.permission, 'SUPPORT_READ_ONLY_ROUTE');
      }

      const boleh = await this.decide(req, session, access.permission, supportPermissions(support.scope));

      // Satu nama event untuk "support mengubah sesuatu", supaya penelusuran tidak
      // perlu tahu lebih dulu service mana yang menulisnya. Yang dicatat di sini
      // adalah permintaan yang DIIZINKAN; akibatnya dicatat service masing-masing
      // (yang sejak slice ini ikut membawa supportSessionId). Permintaan yang
      // diizinkan lalu gagal karena itu tampak sebagai support.mutation tanpa
      // perubahan - dikatakan apa adanya, bukan disembunyikan.
      if (mengubah) {
        await this.audit.record({
          eventType: 'support.mutation',
          outcome: 'SUCCESS',
          tenantId: session.tenant_id,
          actorUserId: session.user_id,
          actorSessionId: session.session_id,
          subjectType: 'SUPPORT_SESSION',
          subjectId: support.supportSessionId,
          detail: { permission: access.permission, method: req.method, route: req.route?.path ?? null },
        });
      }
      return boleh;
    }

    if (session.context_kind !== 'TENANT' || !session.tenant_id || !session.membership_id) {
      throw new ForbiddenException('Session ini bukan context tenant.');
    }

    return this.decide(
      req,
      session,
      access.permission,
      await this.permissions.effective(session.tenant_id, session.membership_id),
    );
  }

  /**
   * Keputusan terakhir, sama untuk tenant dan platform: permission efektif
   * disimpan di req.permissions (dipakai handler sebagai petunjuk tampilan,
   * bukan dihitung ulang), lalu diterima atau ditolak.
   */
  private async decide(
    req: any,
    session: ResolvedSession,
    permission: string,
    granted: ReadonlySet<string>,
  ): Promise<boolean> {
    req.permissions = granted;
    if (granted.has(permission)) return true;
    return this.tolak(req, session, permission, 'MISSING_PERMISSION');
  }

  /**
   * Penolakan dicatat tanpa data pribadi: permission dan POLA route (bukan URL
   * dengan id), pelaku berupa id. Respons 403 tidak menyebut permission apa yang
   * kurang - itu peta hak akses bagi penyerang.
   *
   * `reason` membedakan sebab penolakan di AUDIT, bukan di respons. Tanpa itu,
   * penolakan sesi support atas route yang mengubah keadaan tidak dapat dibedakan
   * dari permission yang kurang saat ditelusuri.
   */
  private async tolak(
    req: any,
    session: ResolvedSession,
    permission: string,
    reason: string,
  ): Promise<never> {
    await this.audit.record({
      eventType: 'authz.denied',
      outcome: 'FAILURE',
      tenantId: session.tenant_id,
      actorUserId: session.user_id,
      actorSessionId: session.session_id,
      detail: {
        permission,
        method: req.method,
        route: req.route?.path ?? null,
        reason,
        ...(req.support ? { supportSessionId: req.support.supportSessionId } : {}),
      },
    });
    throw new ForbiddenException('Anda tidak punya akses ke fitur ini.');
  }
}
