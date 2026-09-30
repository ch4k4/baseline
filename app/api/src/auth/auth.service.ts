import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PreContextRepository, LoginContext } from './pre-context.repository.js';
import { PasswordService } from './password.service.js';
import { TicketService } from './ticket.service.js';
import { AuditService } from './audit.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { TokenService, TokenPair } from './token.service.js';
import { CryptoService } from '../crypto/crypto.module.js';
import { SupportLifecycleService } from '../support/support-lifecycle.service.js';

/**
 * Ringkasan satu context yang boleh dimasuki. `kind` ada sejak DEMO-0311:
 * superadmin dapat memasuki context PLATFORM, yang tidak punya tenant.
 */
export interface ContextSummary {
  kind: 'TENANT' | 'PLATFORM';
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
}

export type LoginResult =
  | ({
      status: 'SESSION';
      context: ContextSummary & { membershipId: string | null };
    } & TokenPair)
  | {
      status: 'CONTEXT_REQUIRED';
      ticket: string;
      contexts: ContextSummary[];
    };

/**
 * Semua kegagalan login menghasilkan pengecualian yang SAMA. Tidak ada cabang
 * "email tidak ditemukan" yang dapat dibedakan dari "password salah" - tidak lewat
 * status, tidak lewat body, dan (karena burnEquivalentWork) tidak lewat waktu.
 */
const GENERIC_FAILURE = 'Email atau password salah.';
const TICKET_FAILURE = 'Tiket pemilihan tenant tidak berlaku. Silakan masuk lagi.';
const REFRESH_FAILURE = 'Sesi tidak dapat diperpanjang. Silakan masuk lagi.';

@Injectable()
export class AuthService {
  constructor(
    private readonly preContext: PreContextRepository,
    private readonly passwords: PasswordService,
    private readonly tickets: TicketService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
    private readonly supportLifecycle: SupportLifecycleService,
  ) {}

  /** Satu-satunya tempat session berubah menjadi pasangan token. */
  private async issueFor(
    sessionId: string,
    userId: string,
    tenantId: string,
    membershipId: string,
  ): Promise<TokenPair> {
    return this.tokens.issue({
      sessionId,
      userId,
      tenantId,
      contextKind: 'TENANT',
      membershipId,
    });
  }

  /**
   * Jalur platform. Dipisah dari issueFor supaya tidak ada satu fungsi yang
   * menerima tenantId yang "boleh null": nilai yang boleh kosong pada akhirnya
   * kosong di tempat yang tidak diduga.
   */
  private async issuePlatform(sessionId: string, userId: string): Promise<TokenPair> {
    return this.tokens.issue({
      sessionId,
      userId,
      tenantId: null,
      contextKind: 'PLATFORM',
      membershipId: null,
    });
  }

  /** Session + token untuk satu baris context apa pun, tenant maupun platform. */
  private async enter(userId: string, context: LoginContext) {
    if (context.context_kind === 'PLATFORM') {
      const sessionId = await this.preContext.createPlatformSession(userId);
      return {
        sessionId,
        pair: await this.issuePlatform(sessionId, userId),
        membershipId: null as string | null,
      };
    }

    const sessionId = await this.preContext.createTenantSession(
      userId,
      context.tenant_id!,
      context.membership_id!,
    );
    return {
      sessionId,
      pair: await this.issueFor(sessionId, userId, context.tenant_id!, context.membership_id!),
      membershipId: context.membership_id,
    };
  }

  async login(email: string, password: string, clientIp: string | null = null): Promise<LoginResult> {
    // Pemeriksaan batas percobaan terjadi SEBELUM verifikasi password, supaya
    // penyerang tidak bisa memakai waktu verifikasi sebagai kanal informasi.
    await this.rateLimit.assertAllowed(email, clientIp);

    const identity = await this.preContext.findIdentityForLogin(
      await this.crypto.userEmailIndex(email),
    );

    if (!identity) {
      await this.passwords.burnEquivalentWork(password);
      await this.audit.record({
        eventType: 'auth.login',
        outcome: 'FAILURE',
        identifier: email,
        detail: { reason: 'IDENTITY_NOT_FOUND' },
      });
      this.rateLimit.recordFailure(clientIp);
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    const passwordOk = await this.passwords.verify(password, identity.password_hash);
    if (!passwordOk || identity.user_status !== 'ACTIVE') {
      await this.audit.record({
        eventType: 'auth.login',
        outcome: 'FAILURE',
        actorUserId: identity.user_id,
        identifier: email,
        detail: { reason: passwordOk ? 'IDENTITY_NOT_ACTIVE' : 'BAD_PASSWORD' },
      });
      this.rateLimit.recordFailure(clientIp);
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    const contexts: LoginContext[] = await this.preContext.listLoginContexts(identity.user_id);

    // Nol context = identitas valid tapi tidak punya akses ke mana pun.
    // Tetap gagal generik: jangan beri tahu bahwa password-nya benar.
    if (contexts.length === 0) {
      await this.audit.record({
        eventType: 'auth.login',
        outcome: 'FAILURE',
        actorUserId: identity.user_id,
        identifier: email,
        detail: { reason: 'NO_ACTIVE_CONTEXT' },
      });
      this.rateLimit.recordFailure(clientIp);
      throw new UnauthorizedException(GENERIC_FAILURE);
    }

    if (contexts.length > 1) {
      // Bukti kepemilikan password sudah ada, tapi tenant belum dipilih. Tiket
      // membawa bukti itu tanpa memberi akses ke data tenant mana pun: ia hanya
      // dapat ditukar dengan session pada tenant yang memang milik identitas ini.
      const { token, hash } = this.tickets.issue();
      await this.preContext.createSelectionTicket(identity.user_id, hash);

      await this.audit.record({
        eventType: 'auth.login.context_required',
        outcome: 'SUCCESS',
        actorUserId: identity.user_id,
        identifier: email,
        detail: { contextCount: contexts.length },
      });

      return {
        status: 'CONTEXT_REQUIRED',
        ticket: token,
        contexts: contexts.map(toSummary),
      };
    }

    const only = contexts[0];
    const { sessionId, pair, membershipId } = await this.enter(identity.user_id, only);

    await this.audit.record({
      eventType: 'auth.login',
      outcome: 'SUCCESS',
      tenantId: only.tenant_id,
      actorUserId: identity.user_id,
      actorSessionId: sessionId,
      identifier: email,
      detail: { contextCount: 1, contextKind: only.context_kind },
    });

    return {
      status: 'SESSION',
      ...pair,
      context: { ...toSummary(only), membershipId },
    };
  }

  /**
   * Menukar tiket dengan session pada tenant pilihan.
   *
   * Dua pemeriksaan yang tidak boleh digabung:
   *   1. tiket sah dan belum terpakai  -> membuktikan SIAPA;
   *   2. identitas itu anggota tenant   -> membuktikan BOLEH KE MANA.
   * Tanpa yang kedua, tiket yang sah dapat dipakai menunjuk tenant orang lain.
   */
  async selectContext(ticket: string, target: { kind: 'TENANT' | 'PLATFORM'; tenantId?: string }) {
    const userId = await this.preContext.consumeSelectionTicket(this.tickets.hash(ticket));
    if (!userId) {
      await this.audit.record({
        eventType: 'auth.select_context',
        outcome: 'FAILURE',
        detail: { reason: 'TICKET_INVALID' },
      });
      throw new UnauthorizedException(TICKET_FAILURE);
    }

    // Tiket sudah terpakai pada titik ini, dan itu disengaja: percobaan menunjuk
    // context yang bukan haknya membakar tiket, bukan memberi kesempatan mencoba
    // lagi. Berlaku sama untuk tenant yang bukan miliknya dan untuk context
    // platform tanpa role platform.
    let context: LoginContext;

    if (target.kind === 'PLATFORM') {
      const roles = await this.preContext.getPlatformRoles(userId);
      if (roles.length === 0) {
        await this.audit.record({
          eventType: 'auth.select_context',
          outcome: 'FAILURE',
          actorUserId: userId,
          detail: { reason: 'NOT_A_PLATFORM_ADMIN' },
        });
        throw new UnauthorizedException(TICKET_FAILURE);
      }
      context = {
        context_kind: 'PLATFORM',
        tenant_id: null,
        tenant_slug: null,
        tenant_name: null,
        membership_id: null,
      };
    } else {
      const membership = await this.preContext.findMembership(userId, target.tenantId!);
      if (!membership) {
        await this.audit.record({
          eventType: 'auth.select_context',
          outcome: 'FAILURE',
          actorUserId: userId,
          detail: { reason: 'NOT_A_MEMBER', requestedTenantId: target.tenantId },
        });
        throw new UnauthorizedException(TICKET_FAILURE);
      }
      context = {
        context_kind: 'TENANT',
        tenant_id: target.tenantId!,
        tenant_slug: membership.tenant_slug,
        tenant_name: membership.tenant_name,
        membership_id: membership.membership_id,
      };
    }

    const { sessionId, pair, membershipId } = await this.enter(userId, context);

    await this.audit.record({
      eventType: 'auth.select_context',
      outcome: 'SUCCESS',
      tenantId: context.tenant_id,
      actorUserId: userId,
      actorSessionId: sessionId,
      detail: { contextKind: context.context_kind },
    });

    return {
      status: 'SESSION' as const,
      ...pair,
      context: { ...toSummary(context), membershipId },
    };
  }

  /**
   * Berpindah tenant tanpa memasukkan password lagi.
   *
   * Urutannya penting: session baru dibuat DULU, session lama dicabut SETELAHNYA.
   * Kalau dibalik dan pembuatan gagal, pengguna kehilangan kedua-duanya dan
   * terlempar keluar tanpa alasan yang terlihat.
   */
  async switchContext(currentSessionId: string, userId: string, tenantId: string) {
    const membership = await this.preContext.findMembership(userId, tenantId);
    if (!membership) {
      await this.audit.record({
        eventType: 'auth.context_switch',
        outcome: 'FAILURE',
        actorUserId: userId,
        actorSessionId: currentSessionId,
        detail: { reason: 'NOT_A_MEMBER', requestedTenantId: tenantId },
      });
      throw new UnauthorizedException('Anda bukan anggota aktif tenant tersebut.');
    }

    const sessionId = await this.preContext.createTenantSession(
      userId,
      tenantId,
      membership.membership_id,
    );
    const pair = await this.issueFor(sessionId, userId, tenantId, membership.membership_id);

    // Session lama dicabut setelah yang baru siap. Refresh token lamanya ikut
    // mati karena rotasi menolak session yang sudah tidak hidup (SESSION_GONE),
    // jadi tidak ada jalan memutar kembali ke tenant sebelumnya lewat refresh.
    await this.preContext.revokeSession(currentSessionId, 'CONTEXT_SWITCH');
    // Session lama bisa saja session PLATFORM (saat perpindahan platform -> tenant
    // ada). Alasannya sama dengan di logout: yang dicabut adalah session, dan sesi
    // support yang menggantung padanya tidak boleh tertinggal berstatus ACTIVE.
    await this.supportLifecycle.endForPlatformSession(currentSessionId, userId);

    await this.audit.record({
      eventType: 'auth.context_switch',
      outcome: 'SUCCESS',
      tenantId,
      actorUserId: userId,
      actorSessionId: sessionId,
      detail: { previousSessionRevoked: true },
    });

    return {
      status: 'SESSION' as const,
      ...pair,
      context: {
        // Berpindah ke context PLATFORM dari session tenant belum ada
        // (tercatat sebagai utang): pemilihan platform terjadi saat login.
        kind: 'TENANT' as const,
        tenantId,
        tenantSlug: membership.tenant_slug,
        tenantName: membership.tenant_name,
        membershipId: membership.membership_id,
      },
    };
  }

  /**
   * Menukar refresh token dengan pasangan baru.
   *
   * Semua kegagalan menghasilkan pesan yang sama, karena membedakan "token ini
   * tidak dikenal" dari "token ini sudah dipakai" memberi tahu penyerang apakah
   * nilai yang dipegangnya pernah sah - itu petunjuk yang tidak perlu diberikan.
   * Perbedaannya tetap tercatat di audit, tempat yang memang untuk itu.
   */
  async refresh(presented: string): Promise<TokenPair> {
    const result = await this.tokens.rotate(presented);

    if (result.status !== 'ROTATED') {
      await this.audit.record({
        // Nama tersendiri untuk REUSE (Demo Foundation sec.15): pemantauan dapat
        // memasang alarm atas satu nama event, tanpa membaca isi detail.
        eventType: result.status === 'REUSE' ? 'auth.refresh.reuse_detected' : 'auth.refresh',
        outcome: 'FAILURE',
        tenantId: result.tenantId,
        actorSessionId: result.sessionId,
        // REUSE berarti seluruh family baru saja dicabut oleh database. Kejadian
        // inilah yang layak membangunkan orang, bukan INVALID yang biasa terjadi
        // karena cookie basi.
        detail: { reason: result.status },
      });
      throw new UnauthorizedException(REFRESH_FAILURE);
    }

    await this.audit.record({
      eventType: 'auth.refresh',
      outcome: 'SUCCESS',
      tenantId: result.tenantId,
      actorSessionId: result.sessionId,
    });

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    };
  }

  async listContexts(userId: string): Promise<ContextSummary[]> {
    return (await this.preContext.listLoginContexts(userId)).map(toSummary);
  }

  async logout(sessionId: string, userId?: string, tenantId?: string | null): Promise<void> {
    await this.preContext.revokeSession(sessionId, 'LOGOUT');

    // ADR-003 sec.2.6 butir 5: session PLATFORM yang berakhir mengakhiri support
    // session yang dibuka darinya. Dipanggil untuk SETIAP logout, bukan hanya yang
    // context-nya platform: memutuskan berdasarkan context di sini berarti dua
    // sumber kebenaran tentang session yang sama, dan yang menentukan adalah baris
    // support_sessions - tidak ada baris, tidak ada yang terjadi.
    await this.supportLifecycle.endForPlatformSession(sessionId, userId ?? null);
    await this.audit.record({
      eventType: 'auth.logout',
      outcome: 'SUCCESS',
      tenantId: tenantId ?? null,
      actorUserId: userId ?? null,
      actorSessionId: sessionId,
    });
  }
}

function toSummary(c: LoginContext): ContextSummary {
  return {
    kind: c.context_kind,
    tenantId: c.tenant_id,
    tenantSlug: c.tenant_slug,
    tenantName: c.tenant_name,
  };
}
