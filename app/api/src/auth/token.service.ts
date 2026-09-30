import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { JwtService } from './jwt.service.js';
import { PreContextRepository, RotationStatus } from './pre-context.repository.js';

/**
 * Penerbitan dan penukaran pasangan token.
 *
 * DUA JENIS TOKEN, DUA SIFAT YANG BERBEDA:
 *
 *   access token  - JWT bertanda tangan, berumur pendek (menit), TIDAK disimpan
 *                   di database. Diverifikasi dengan kunci, bukan dengan query.
 *   refresh token - nilai acak buram, berumur panjang (hari), disimpan sebagai
 *                   HASH. Setiap pemakaian menukarnya dengan yang baru.
 *
 * Kenapa bukan satu saja: access token yang berumur panjang tidak dapat dicabut
 * tanpa query setiap permintaan, dan refresh token yang berumur pendek
 * menghapus gunanya. Yang berumur pendek boleh dipercaya tanpa database; yang
 * berumur panjang tidak pernah dipercaya tanpa database.
 *
 * Refresh token TIDAK bertanda tangan, dan itu disengaja. Tanda tangan hanya
 * membuktikan token tidak diubah - sedangkan yang perlu dibuktikan di sini
 * adalah token belum pernah dipakai, dan itu hanya diketahui database.
 */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionIdentity {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  contextKind: 'TENANT' | 'PLATFORM';
  membershipId: string | null;
}

export type RotationOutcome =
  | ({ status: 'ROTATED' } & TokenPair & { sessionId: string; tenantId: string | null })
  | { status: Exclude<RotationStatus, 'ROTATED'>; sessionId: string | null; tenantId: string | null };

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly preContext: PreContextRepository,
  ) {}

  private hash(token: string): Buffer {
    // SHA-256 tanpa salt memadai di sini karena masukannya 32 byte acak dari
    // CSPRNG, bukan rahasia yang dapat ditebak. Untuk password pilihan ini salah.
    return createHash('sha256').update(token, 'utf8').digest();
  }

  async issue(identity: SessionIdentity): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('base64url');

    await this.preContext.createRefreshToken(
      identity.sessionId,
      identity.tenantId,
      identity.contextKind,
      this.hash(refreshToken),
    );

    const accessToken = this.jwt.sign({
      sub: identity.userId,
      sid: identity.sessionId,
      tid: identity.tenantId,
      ctx: identity.contextKind,
      mid: identity.membershipId,
    });

    return { accessToken, refreshToken, expiresIn: this.jwt.ttlSeconds };
  }

  /**
   * Token support session (DEMO-0312, ADR-003 sec.2.2).
   *
   * TIGA HAL YANG SENGAJA BERBEDA dari token biasa:
   *
   *   1. TIDAK ada refresh token. Sesi break-glass tidak boleh dapat diperpanjang
   *      diam-diam; sesi baru menuntut alasan baru (sec.2.2 butir 5).
   *   2. `sid` adalah session PLATFORM yang membukanya, bukan session baru. Itulah
   *      yang membuat logout platform mematikan token ini seketika - guard menolak
   *      begitu baris session platform dicabut, tanpa kode tambahan.
   *   3. umurnya = sisa umur sesi support, sehingga exp tidak pernah melebihi
   *      expires_at baris sesi.
   */
  issueSupport(input: {
    superadminUserId: string;
    platformSessionId: string;
    tenantId: string;
    supportSessionId: string;
    scope: 'READ_ONLY' | 'READ_WRITE';
    /** Sisa umur sesi dalam DETIK, dihitung database - bukan dua tanggal yang dikurangkan di sini. */
    ttlSeconds: number;
  }): { accessToken: string; expiresIn: number } {
    const sisa = Math.max(1, Math.floor(input.ttlSeconds));
    const accessToken = this.jwt.sign(
      {
        sub: input.superadminUserId,
        sid: input.platformSessionId,
        tid: input.tenantId,
        ctx: 'SUPPORT',
        mid: null,
        ssid: input.supportSessionId,
        scp: input.scope,
      },
      sisa,
    );
    return { accessToken, expiresIn: sisa };
  }

  /**
   * Menukar refresh token dengan pasangan baru.
   *
   * Token baru dibuat SEBELUM penukaran dicatat, karena nilainya harus masuk ke
   * baris yang sama dalam satu pernyataan - kalau dipisah, ada jeda saat token
   * lama sudah mati dan penggantinya belum ada.
   */
  async rotate(presented: string): Promise<RotationOutcome> {
    const next = randomBytes(32).toString('base64url');
    const result = await this.preContext.rotateRefreshToken(this.hash(presented), this.hash(next));

    if (result.status !== 'ROTATED') {
      return {
        status: result.status,
        sessionId: result.session_id,
        tenantId: result.tenant_id,
      };
    }

    // Klaim tidak disalin dari token lama: token lama dikendalikan klien.
    // Isinya diambil ulang dari database supaya pencabutan dan perubahan
    // keanggotaan terbaca, bukan yang tersimpan saat token pertama terbit.
    const session = await this.preContext.findSession(result.session_id!);
    if (!session) {
      return { status: 'SESSION_GONE', sessionId: result.session_id, tenantId: result.tenant_id };
    }

    const accessToken = this.jwt.sign({
      sub: session.user_id,
      sid: session.session_id,
      tid: session.tenant_id,
      ctx: session.context_kind,
      mid: session.membership_id,
    });

    return {
      status: 'ROTATED',
      accessToken,
      refreshToken: next,
      expiresIn: this.jwt.ttlSeconds,
      sessionId: session.session_id,
      tenantId: session.tenant_id,
    };
  }
}
