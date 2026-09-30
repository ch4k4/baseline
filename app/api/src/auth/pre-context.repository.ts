import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../database/unit-of-work.js';

/**
 * Satu-satunya pintu ke fungsi pre-context Lampiran A. Semua pemanggilan berjalan
 * lewat withoutTenant() karena memang harus bekerja sebelum tenant diketahui.
 *
 * Perhatikan yang TIDAK ada di sini: tidak ada satu pun SELECT langsung ke tabel
 * users atau credentials. app_user tidak punya grant ke sana, jadi query semacam
 * itu akan gagal - dan itu memang pengamannya.
 */

export interface IdentityForLogin {
  user_id: string;
  password_hash: string;
  user_status: string;
}

/**
 * Satu baris = satu tempat yang dapat dimasuki identitas ini. Context PLATFORM
 * ikut sebagai BARIS (F-04 sejak DEMO-0311), bukan sebagai flag di samping
 * daftar: superadmin tanpa membership tenant tidak menghasilkan baris tenant
 * satu pun, dan flag pada daftar kosong tidak dapat dibaca siapa pun.
 */
export interface LoginContext {
  context_kind: 'TENANT' | 'PLATFORM';
  tenant_id: string | null;
  tenant_slug: string | null;
  tenant_name: string | null;
  membership_id: string | null;
}

export interface Membership {
  membership_id: string;
  tenant_slug: string;
  tenant_name: string;
}

export type RotationStatus = 'ROTATED' | 'REUSE' | 'EXPIRED' | 'INVALID' | 'SESSION_GONE';

export interface RotationResult {
  status: RotationStatus;
  session_id: string | null;
  tenant_id: string | null;
  context_kind: 'TENANT' | 'PLATFORM' | null;
  family_id: string | null;
}

export interface ResolvedSession {
  /**
   * SUPPORT (sejak DEMO-0312) tidak pernah datang dari tabel sessions: tidak ada
   * baris session dengan context_kind itu. Guard menyusunnya dari session PLATFORM
   * + baris support_sessions, supaya handler tenant yang sudah ada tetap menerima
   * bentuk yang sama - dengan membership_id null, yang memang tidak dimilikinya.
   */
  session_id: string;
  context_kind: 'TENANT' | 'PLATFORM' | 'SUPPORT';
  tenant_id: string | null;
  user_id: string;
  membership_id: string | null;
  expires_at: Date;
}

/** Baris support_sessions yang masih berlaku (F-18). */
export interface ActiveSupportSession {
  id: string;
  tenant_id: string;
  superadmin_user_id: string;
  platform_session_id: string;
  scope: 'READ_ONLY' | 'READ_WRITE';
  expires_at: Date;
  /** Sisa umur sesi, dihitung DATABASE. Durasi tidak pernah diturunkan dari teks waktu. */
  remaining_seconds: number;
}

@Injectable()
export class PreContextRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * Dicari lewat blind index, bukan email. Nilai email tidak pernah dikirim ke
   * database - bahkan sebagai parameter, yang dapat muncul di log query lambat.
   */
  async findIdentityForLogin(emailBlindIndex: Buffer): Promise<IdentityForLogin | null> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<IdentityForLogin>('SELECT * FROM auth.find_identity_for_login($1)', [emailBlindIndex]),
    );
    return rows[0] ?? null;
  }

  async listLoginContexts(userId: string): Promise<LoginContext[]> {
    return this.uow.withoutTenant((tx) =>
      tx.query<LoginContext>('SELECT * FROM auth.list_login_contexts($1)', [userId]),
    );
  }

  async createTenantSession(
    userId: string,
    tenantId: string,
    membershipId: string,
    ttlMinutes = 60,
  ): Promise<string> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<{ create_session: string }>(
        'SELECT auth.create_session($1, $2, $3, $4, $5) AS create_session',
        ['TENANT', userId, tenantId, membershipId, ttlMinutes],
      ),
    );
    return rows[0].create_session;
  }

  /**
   * Session platform. Tidak membawa tenant maupun membership - dan fungsi F-07
   * menolaknya bila user ini tidak benar-benar memegang role platform, sehingga
   * "lupa memeriksa" di aplikasi tidak cukup untuk menerbitkan session platform.
   */
  async createPlatformSession(userId: string, ttlMinutes = 60): Promise<string> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<{ create_session: string }>(
        'SELECT auth.create_session($1, $2, NULL, NULL, $3) AS create_session',
        ['PLATFORM', userId, ttlMinutes],
      ),
    );
    return rows[0].create_session;
  }

  /** F-13. Dipakai guard platform: berjalan sebelum context platform ditetapkan. */
  async getPlatformRoles(userId: string): Promise<string[]> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<{ role_code: string }>('SELECT * FROM auth.get_platform_roles($1)', [userId]),
    );
    return rows.map((r) => r.role_code);
  }

  async createSelectionTicket(userId: string, tokenHash: Buffer, ttlSeconds = 300): Promise<void> {
    await this.uow.withoutTenant((tx) =>
      tx.query('SELECT auth.create_selection_ticket($1, $2, $3)', [userId, tokenHash, ttlSeconds]),
    );
  }

  /** Sekali pakai ditegakkan database; nilai kosong berarti tiket habis/kedaluwarsa/palsu. */
  async consumeSelectionTicket(tokenHash: Buffer): Promise<string | null> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<{ user_id: string }>('SELECT * FROM auth.consume_selection_ticket($1)', [tokenHash]),
    );
    return rows[0]?.user_id ?? null;
  }

  async findMembership(userId: string, tenantId: string): Promise<Membership | null> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<Membership>('SELECT * FROM auth.find_membership($1, $2)', [userId, tenantId]),
    );
    return rows[0] ?? null;
  }

  async revokeSession(sessionId: string, reason = 'CONTEXT_SWITCH'): Promise<boolean> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<{ revoke_session: boolean }>('SELECT auth.revoke_session($1, $2) AS revoke_session', [
        sessionId,
        reason,
      ]),
    );
    return rows[0]?.revoke_session ?? false;
  }

  async createRefreshToken(
    sessionId: string,
    tenantId: string | null,
    contextKind: string,
    tokenHash: Buffer,
    ttlSeconds = 2592000,
  ): Promise<{ token_id: string; family_id: string }> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<{ token_id: string; family_id: string }>(
        'SELECT * FROM auth.create_refresh_token($1, $2, $3, $4, $5)',
        [sessionId, tenantId, contextKind, tokenHash, ttlSeconds],
      ),
    );
    return rows[0];
  }

  /**
   * Penukaran satu-satunya. Status dibawa apa adanya dari database karena
   * database-lah yang memutuskan - pemakaian ulang hanya dapat dikenali di
   * tempat yang bisa mengunci barisnya.
   */
  async rotateRefreshToken(oldHash: Buffer, newHash: Buffer): Promise<RotationResult> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<RotationResult>('SELECT * FROM auth.rotate_refresh_token($1, $2)', [
        oldHash,
        newHash,
      ]),
    );
    return rows[0];
  }

  /**
   * F-18. Dipanggil guard pada SETIAP request sesi support (ADR-003 sec.2.3),
   * bukan hanya saat token diterbitkan. Nol baris = sesi berakhir, dicabut, atau
   * kedaluwarsa; guard tidak membedakan ketiganya kepada pemanggil.
   */
  async findSupportSession(id: string): Promise<ActiveSupportSession | null> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<ActiveSupportSession>('SELECT * FROM auth.find_support_session($1)', [id]),
    );
    return rows[0] ?? null;
  }

  /** F-19. Logout/pencabutan session PLATFORM mengakhiri sesi support yang menempel padanya. */
  async endSupportSessionsForPlatformSession(
    platformSessionId: string,
  ): Promise<Array<{ support_session_id: string; tenant_id: string }>> {
    return this.uow.withoutTenant((tx) =>
      tx.query<{ support_session_id: string; tenant_id: string }>(
        'SELECT * FROM auth.end_support_sessions_for_platform_session($1)',
        [platformSessionId],
      ),
    );
  }

  async findSession(sessionId: string): Promise<ResolvedSession | null> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<ResolvedSession>('SELECT * FROM auth.find_session($1)', [sessionId]),
    );
    return rows[0] ?? null;
  }
}
