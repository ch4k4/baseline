import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { UnitOfWork } from '../database/unit-of-work.js';
import { CryptoService } from '../crypto/crypto.module.js';
import { FIELDS } from '../crypto/field-crypto.js';
import { PLATFORM } from '../crypto/key-ring.js';
import { maskEmail, normalizeEmail } from '../crypto/normalize.js';
import { AuditService } from '../auth/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { PreContextRepository, ResolvedSession } from '../auth/pre-context.repository.js';
import { RateLimitService } from '../auth/rate-limit.service.js';
import { TicketService } from '../auth/ticket.service.js';
import { deliverInvitation } from './outbox.js';
import { assertWithin, permissionsOfRoles } from '../admin/admin-rules.js';

/**
 * Undangan anggota (D-09; ADR-002 sec.2.2, DEMO-0210, DEMO-0212).
 *
 * Tiga jaminan yang membentuk desain ini:
 *
 *   1. NON-ENUMERATION. Mengundang tidak pernah menyentuh identitas global.
 *      Tidak ada cabang "email ini sudah terdaftar", jadi tidak ada yang dapat
 *      dibedakan - bukan karena disembunyikan, tetapi karena memang tidak
 *      pernah ditanyakan.
 *   2. TOKEN = BUKTI KEPEMILIKAN EMAIL. Token hanya dikirim ke email tujuan
 *      (outbox demo), tidak pernah ke pengundang, dan disimpan sebagai hash.
 *   3. IDENTITAS = PEMILIK EMAIL. Penerimaan hanya sah bila blind index global
 *      identitas yang menerima sama dengan blind index email undangan -
 *      diperiksa di aplikasi DAN di F-12/F-16.
 */

const TTL_HOURS = Number(process.env.DEMO_INVITE_TTL_HOURS ?? 72);
const MIN_PASSWORD = 10;
const MAX_DISPLAY_NAME = 100;
// Sederhana dan disengaja: bentuk dasar saja. Kepemilikan email dibuktikan oleh
// token, bukan oleh regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVALID_INVITATION = 'Undangan tidak berlaku atau sudah dipakai.';
const BAD_CREDENTIAL = 'Password salah.';

export interface InvitationView {
  id: string;
  email_masked: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expires_at: string;
  created_at: string;
}

interface Acceptable {
  invitation_id: string;
  tenant_id: string;
  tenant_name: string;
  expires_at: Date;
  identity_hint: Buffer;
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class InvitationService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly preContext: PreContextRepository,
    private readonly rateLimit: RateLimitService,
    private readonly tokens: TicketService,
  ) {}

  // ------------------------------------------------------------------ admin tenant

  /**
   * Hak mengelola undangan diputuskan AccessGuard (permission members.invite,
   * sejak slice 10 / D-21). Di sini hanya context yang dibutuhkan service:
   * pemeriksaan ulang yang murah, supaya service tidak pernah berjalan dengan
   * session non-tenant walau suatu hari dipanggil dari jalur lain.
   */
  private tenantOf(session: ResolvedSession): { tenantId: string; membershipId: string } {
    if (session.context_kind !== 'TENANT' || !session.tenant_id || !session.membership_id) {
      throw new ForbiddenException('Session ini bukan context tenant.');
    }
    return { tenantId: session.tenant_id, membershipId: session.membership_id };
  }

  /**
   * Respons SELALU sama: { status: 'INVITED' }. Email baru, email yang sudah
   * punya akun, email yang sudah diundang, email yang sudah menjadi anggota -
   * semuanya tidak dapat dibedakan dari respons.
   */
  async invite(
    session: ResolvedSession, rawEmail: string, roleIds: string[] = [], actor: Set<string> = new Set(),
  ): Promise<{ status: 'INVITED' }> {
    const { tenantId, membershipId } = this.tenantOf(session);
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_RE.test(email) || email.length > 320) {
      throw new BadRequestException('Alamat email tidak sah.');
    }

    // Semua nilai kriptografi dihitung SEBELUM transaksi dibuka: pengambilan
    // kunci memakai transaksinya sendiri, dan transaksi bersarang pada pool kecil
    // adalah cara klasik membuat deadlock.
    const id = randomUUID();
    const sealed = await this.crypto.encrypt(FIELDS.invitationEmail, tenantId, id, email);
    const tenantBi = await this.crypto.invitationEmailIndex(tenantId, email);
    const hint = await this.crypto.userEmailIndex(email);
    const { token, hash } = this.tokens.issue();

    const result = await this.uow.withTenant(tenantId, async (tx) => {
      // Role undangan (DEMO-0309): harus role tenant ini, belum diarsipkan, dan
      // dalam jangkauan pengundang (anti-eskalasi: mengundang akun kedua dengan
      // role yang lebih tinggi adalah jalan memutar yang sama). Diperiksa sebelum
      // apa pun ditulis, dan tidak bergantung pada email - tidak ada petunjuk
      // keberadaan akun di penolakan ini.
      const roleInfo = await permissionsOfRoles(tx, roleIds);
      for (const id of roleIds) {
        const role = roleInfo.get(id);
        if (!role) throw new BadRequestException('Role tidak dikenal.');
        if (role.archived) throw new BadRequestException('Role yang sudah diarsipkan tidak dapat diberikan.');
        assertWithin(actor, role.perms);
      }

      // Undang ulang email yang masih PENDING memperbarui baris yang sama: token
      // lama mati saat itu juga. Ciphertext lama dipertahankan karena AAD-nya
      // terikat ke id baris lama - email-nya memang sama.
      //
      // Nilai baru diambil dari parameter, BUKAN dari EXCLUDED.*: membaca
      // EXCLUDED.token_hash butuh hak SELECT atas token_hash, dan hak itu memang
      // sengaja tidak dimiliki app_user.
      const rows = await tx.query<{ id: string; expires_at: Date }>(
        `INSERT INTO user_invitations (
           id, tenant_id, email_ciphertext, email_key_version, email_blind_index,
           identity_hint, invited_by_membership_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(hours => $9))
         ON CONFLICT (tenant_id, email_blind_index) WHERE status = 'PENDING'
         DO UPDATE SET token_hash = $8,
                       expires_at = now() + make_interval(hours => $9),
                       invited_by_membership_id = $7,
                       updated_at = now()
         RETURNING id, expires_at`,
        [id, tenantId, sealed.ciphertext, sealed.keyVersion, tenantBi, hint, membershipId, hash, TTL_HOURS],
      );
      const tenant = await tx.db.tenant.findFirst({ select: { name: true } });
      // Undang ulang MENGGANTI daftar role undangan, bukan menambah.
      await tx.query('DELETE FROM invitation_roles WHERE invitation_id = $1', [rows[0].id]);
      if (roleIds.length) {
        await tx.query(
          'INSERT INTO invitation_roles (tenant_id, invitation_id, role_id) SELECT $1, $2, unnest($3::uuid[])',
          [tenantId, rows[0].id, roleIds]);
      }
      return { invitation: rows[0], tenantName: tenant?.name ?? '' };
    });

    deliverInvitation({
      invitationId: result.invitation.id,
      to: email,
      tenantName: result.tenantName,
      token,
      expiresAt: new Date(result.invitation.expires_at),
    });

    await this.audit.record({
      eventType: 'invitation.created',
      outcome: 'SUCCESS',
      tenantId,
      actorUserId: session.user_id,
      actorSessionId: session.session_id,
      subjectType: 'invitation',
      subjectId: result.invitation.id,
    });

    return { status: 'INVITED' };
  }

  async list(session: ResolvedSession): Promise<InvitationView[]> {
    const { tenantId } = this.tenantOf(session);
    const rows = await this.uow.withTenant(tenantId, (tx) =>
      tx.db.userInvitation.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    );
    const now = Date.now();
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        email_masked: maskEmail(
          await this.crypto.decrypt(
            FIELDS.invitationEmail, tenantId, r.id, Buffer.from(r.emailCiphertext), r.emailKeyVersion,
          ),
        ),
        // PENDING yang lewat masa berlaku ditampilkan EXPIRED. Tidak ada job yang
        // mengubah statusnya; F-11/F-12 memang menolak berdasarkan expires_at.
        status: (r.status === 'PENDING' && r.expiresAt.getTime() <= now
          ? 'EXPIRED'
          : r.status) as InvitationView['status'],
        expires_at: r.expiresAt.toISOString(),
        created_at: r.createdAt.toISOString(),
      })),
    );
  }

  async revoke(session: ResolvedSession, invitationId: string): Promise<{ status: 'REVOKED' }> {
    const { tenantId } = this.tenantOf(session);
    // updated_at sengaja tidak disentuh: CHECK TTL membandingkan expires_at
    // dengan updated_at, dan undangan yang sudah lewat masa berlaku tetap harus
    // dapat dicabut.
    const rows = await this.uow.withTenant(tenantId, (tx) =>
      tx.query<{ id: string }>(
        `UPDATE user_invitations SET status = 'REVOKED'
         WHERE id = $1 AND status = 'PENDING' RETURNING id`,
        [invitationId],
      ),
    );
    // Undangan tenant lain, yang sudah diterima, atau yang tidak ada: 404 yang
    // sama. RLS membuat undangan tenant lain memang tidak terlihat.
    if (rows.length === 0) throw new NotFoundException('Undangan tidak ditemukan.');

    await this.audit.record({
      eventType: 'invitation.revoked',
      outcome: 'SUCCESS',
      tenantId,
      actorUserId: session.user_id,
      actorSessionId: session.session_id,
      subjectType: 'invitation',
      subjectId: invitationId,
    });
    return { status: 'REVOKED' };
  }

  // ------------------------------------------------------------------ penerima

  private async findAcceptable(token: string): Promise<Acceptable | null> {
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<Acceptable>('SELECT * FROM auth.find_invitation_for_acceptance($1)', [this.tokens.hash(token)]),
    );
    return rows[0] ?? null;
  }

  /**
   * Untuk halaman terima undangan. hasAccount memberi tahu pemegang token
   * apakah email miliknya sudah punya akun (form "masukkan password" vs "buat
   * password"). Ini diberikan kepada PEMEGANG TOKEN, yaitu pemilik email itu
   * sendiri - bukan kepada tenant yang mengundang.
   */
  async lookup(token: string): Promise<{ tenantName: string; expiresAt: string; hasAccount: boolean }> {
    const inv = await this.findAcceptable(token);
    if (!inv) throw new NotFoundException(INVALID_INVITATION);
    const identity = await this.preContext.findIdentityForLogin(inv.identity_hint);
    return {
      tenantName: inv.tenant_name,
      expiresAt: new Date(inv.expires_at).toISOString(),
      hasAccount: identity !== null,
    };
  }

  async accept(
    token: string,
    password: string,
    rawDisplayName: string,
    clientIp: string | null = null,
  ): Promise<{ status: 'JOINED'; tenantName: string }> {
    const displayName = rawDisplayName.normalize('NFC').trim();
    if (!displayName || displayName.length > MAX_DISPLAY_NAME) {
      throw new BadRequestException(`Nama tampilan wajib diisi (maksimal ${MAX_DISPLAY_NAME} karakter).`);
    }

    const tokenHash = this.tokens.hash(token);
    const inv = await this.findAcceptable(token);
    if (!inv) throw new GoneException(INVALID_INVITATION);
    const tenantId = inv.tenant_id;

    // Email undangan dibaca di context tenant pengundang. Context itu diturunkan
    // dari token yang baru saja dibuktikan sah oleh F-11 - satu-satunya jalur di
    // aplikasi yang memasuki tenant tanpa membership, dan hanya untuk satu baris.
    const { row, rolesSkipped } = await this.uow.withTenant(tenantId, async (tx) => {
      const found = await tx.db.userInvitation.findFirst({
        where: { id: inv.invitation_id },
        select: { emailCiphertext: true, emailKeyVersion: true },
      });
      // Role undangan yang diarsipkan sejak undangan dibuat dilewati F-12
      // (keputusan 2026-09-22). Jumlahnya dicatat di audit supaya pengundang
      // dapat melihat mengapa anggota baru tidak mendapat role yang dimaksud.
      const [skipped] = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM invitation_roles ir
         JOIN roles r ON r.tenant_id = ir.tenant_id AND r.id = ir.role_id
         WHERE ir.invitation_id = $1 AND r.archived_at IS NOT NULL`,
        [inv.invitation_id]);
      return { row: found, rolesSkipped: skipped?.n ?? 0 };
    });
    if (!row) throw new GoneException(INVALID_INVITATION);
    const email = await this.crypto.decrypt(
      FIELDS.invitationEmail, tenantId, inv.invitation_id, Buffer.from(row.emailCiphertext), row.emailKeyVersion,
    );

    const globalBi = await this.crypto.userEmailIndex(email);
    if (!sameBytes(globalBi, inv.identity_hint)) {
      // Email undangan dan petunjuk identitasnya tidak cocok: data rusak, bukan
      // kesalahan pengguna. Gagal tertutup.
      throw new GoneException(INVALID_INVITATION);
    }

    // Satu keranjang percobaan dengan login: menebak password lewat halaman
    // undangan dikunci oleh batas yang sama.
    await this.rateLimit.assertAllowed(email, clientIp);

    const identity = await this.preContext.findIdentityForLogin(globalBi);
    let userId: string;
    let newIdentity: { ciphertext: Buffer; keyVersion: number; passwordHash: string } | null = null;

    if (identity) {
      const ok = await this.passwords.verify(password, identity.password_hash);
      if (!ok || identity.user_status !== 'ACTIVE') {
        await this.audit.record({
          eventType: 'auth.login',
          outcome: 'FAILURE',
          actorUserId: identity.user_id,
          identifier: email,
          detail: { reason: ok ? 'IDENTITY_NOT_ACTIVE' : 'BAD_PASSWORD', via: 'invitation' },
        });
        this.rateLimit.recordFailure(clientIp);
        throw new UnauthorizedException(BAD_CREDENTIAL);
      }
      userId = identity.user_id;
    } else {
      if (password.length < MIN_PASSWORD) {
        throw new BadRequestException(`Password minimal ${MIN_PASSWORD} karakter.`);
      }
      userId = randomUUID();
      const sealed = await this.crypto.encrypt(FIELDS.userEmail, PLATFORM, userId, email);
      newIdentity = { ...sealed, passwordHash: await this.passwords.hash(password) };
    }

    const profileId = randomUUID();
    const name = await this.crypto.encrypt(FIELDS.profileDisplayName, tenantId, profileId, displayName);
    const contact = await this.crypto.encrypt(FIELDS.profileContactEmail, tenantId, profileId, email);
    const contactBi = await this.crypto.contactEmailIndex(tenantId, email);

    // Identitas baru dan penerimaan dalam SATU transaksi: kalau penerimaan gagal,
    // tidak ada identitas yatim tanpa tenant.
    const membershipId = await this.uow.withoutTenant(async (tx) => {
      if (newIdentity) {
        const [c] = await tx.query<{ ok: boolean }>(
          'SELECT auth.create_identity_for_invitation($1, $2, $3, $4, $5, $6) AS ok',
          [tokenHash, userId, globalBi, newIdentity.ciphertext, newIdentity.keyVersion, newIdentity.passwordHash],
        );
        if (!c?.ok) return null;
      }
      const [a] = await tx.query<{ membership_id: string | null }>(
        'SELECT auth.accept_invitation($1, $2, $3, $4, $5, $6, $7, $8) AS membership_id',
        [tokenHash, userId, profileId, name.ciphertext, name.keyVersion, contact.ciphertext, contact.keyVersion, contactBi],
      );
      return a?.membership_id ?? null;
    });

    if (!membershipId) throw new GoneException(INVALID_INVITATION);

    if (newIdentity) {
      // Kejadian platform (tanpa tenant): tenant tidak boleh tahu apakah orang
      // yang diundangnya sudah punya akun sebelumnya.
      await this.audit.record({
        eventType: 'identity.created',
        outcome: 'SUCCESS',
        actorUserId: userId,
        subjectType: 'user',
        subjectId: userId,
        detail: { via: 'invitation' },
      });
    }
    await this.audit.record({
      eventType: 'invitation.accepted',
      outcome: 'SUCCESS',
      tenantId,
      actorUserId: userId,
      subjectType: 'invitation',
      subjectId: inv.invitation_id,
      detail: { membershipId, rolesSkipped },
    });

    return { status: 'JOINED', tenantName: inv.tenant_name };
  }
}
