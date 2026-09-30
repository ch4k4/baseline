import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UnitOfWork, Tx } from '../database/unit-of-work.js';
import { supportContext } from '../database/support-context.js';
import { CryptoService } from '../crypto/crypto.module.js';
import { FIELDS } from '../crypto/field-crypto.js';
import { DecryptionError } from '../crypto/envelope.js';
import { maskEmail, maskName, normalizeEmail } from '../crypto/normalize.js';
import { AuditService } from '../auth/audit.service.js';
import { AuditEventType } from '../auth/audit-events.js';
import { ResolvedSession } from '../auth/pre-context.repository.js';
import {
  assertNotSelf,
  assertTenantStaysAdministrable,
  assertWithin,
  lockTenant,
  permissionsOfRoles,
  STALE,
} from '../admin/admin-rules.js';

export interface RoleRef { id: string; code: string; name: string; archived: boolean }

export interface MemberView {
  membership_id: string;
  display_name: string;
  // Hanya versi ber-masker yang pernah keluar dari endpoint anggota (SSOT sec.11).
  contact_email_masked: string;
  status: string;
  version: number;
  roles: RoleRef[];
}

interface MemberRow {
  profile_id: string;
  membership_id: string;
  display_name_ciphertext: Buffer;
  display_name_key_version: number;
  contact_email_ciphertext: Buffer;
  contact_email_key_version: number;
  status: string;
  version: number;
  roles: RoleRef[];
  total: number;
}

export interface ListFilter { status?: string; roleId?: string; email?: string; limit: number; offset: number }

const MEMBER_SELECT = `
  SELECT p.id AS profile_id, p.membership_id,
         p.display_name_ciphertext, p.display_name_key_version,
         p.contact_email_ciphertext, p.contact_email_key_version,
         m.status, m.version,
         COALESCE((SELECT json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name,
                                                     'archived', r.archived_at IS NOT NULL) ORDER BY r.code)
                   FROM user_role_assignments a JOIN roles r ON r.tenant_id = a.tenant_id AND r.id = a.role_id
                   WHERE a.membership_id = m.id AND a.ended_at IS NULL), '[]'::json) AS roles,
         count(*) OVER ()::int AS total
  FROM tenant_member_profiles p
  JOIN tenant_memberships m ON m.tenant_id = p.tenant_id AND m.id = p.membership_id`;

/**
 * Administrasi anggota (DEMO-0305). Setiap query tanpa WHERE tenant_id: RLS yang
 * menyaring. Anggota tenant lain tidak "ditolak", tetapi memang tidak ada (404).
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, f: ListFilter): Promise<{ members: MemberView[]; total: number }> {
    const emailBi = f.email ? await this.crypto.contactEmailIndex(tenantId, normalizeEmail(f.email)) : null;
    const rows = await this.uow.withTenant(tenantId, (tx) =>
      // Halaman ditentukan urutan keanggotaan (stabil, bukan ciphertext). Nama
      // diurutkan SETELAH dekripsi, di dalam halaman (SSOT sec.8.4).
      tx.query<MemberRow>(
        `${MEMBER_SELECT}
         WHERE ($1::text IS NULL OR m.status = $1)
           AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM user_role_assignments a
                                           WHERE a.membership_id = m.id AND a.role_id = $2 AND a.ended_at IS NULL))
           AND ($3::bytea IS NULL OR p.contact_email_blind_index = $3)
         ORDER BY m.created_at, m.id
         LIMIT $4 OFFSET $5`,
        [f.status ?? null, f.roleId ?? null, emailBi, f.limit, f.offset],
      ),
    );
    const members = await this.decrypt(tenantId, rows);
    members.sort((a, b) => a.display_name.localeCompare(b.display_name, 'id'));
    return { members, total: rows[0]?.total ?? 0 };
  }

  async detail(tenantId: string, membershipId: string): Promise<MemberView> {
    const rows = await this.uow.withTenant(tenantId, (tx) =>
      tx.query<MemberRow>(`${MEMBER_SELECT} WHERE m.id = $1`, [membershipId]));
    if (rows.length === 0) throw new NotFoundException('Anggota tidak ditemukan.');
    return (await this.decrypt(tenantId, rows))[0];
  }

  async updateProfile(session: ResolvedSession, membershipId: string, rawName: string, version: number): Promise<MemberView> {
    const tenantId = session.tenant_id as string;
    const displayName = rawName.normalize('NFC').trim();
    if (!displayName || displayName.length > 100) throw new BadRequestException('displayName wajib diisi (maksimal 100 karakter).');

    const profile = await this.uow.withTenant(tenantId, (tx) =>
      tx.query<{ id: string }>('SELECT id FROM tenant_member_profiles WHERE membership_id = $1', [membershipId]));
    if (profile.length === 0) throw new NotFoundException('Anggota tidak ditemukan.');
    const sealed = await this.crypto.encrypt(FIELDS.profileDisplayName, tenantId, profile[0].id, displayName);

    await this.uow.withTenant(tenantId, async (tx) => {
      await this.bumpVersion(tx, membershipId, version);
      await tx.query(
        `UPDATE tenant_member_profiles SET display_name_ciphertext = $2, display_name_key_version = $3, updated_at = now()
         WHERE membership_id = $1`,
        [membershipId, sealed.ciphertext, sealed.keyVersion],
      );
    });
    await this.record(session, 'member.profile_updated', membershipId, {});
    return this.detail(tenantId, membershipId);
  }

  async suspend(session: ResolvedSession, actor: Set<string>, membershipId: string, version: number): Promise<MemberView> {
    const tenantId = session.tenant_id as string;
    assertNotSelf(session.membership_id as string, membershipId, 'menangguhkan');

    const revoked = await this.uow.withTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      // Anti-eskalasi berlaku juga di sini: menangguhkan anggota yang memegang hak
      // lebih tinggi dari pelaku sama dengan mencabut hak yang tidak ia miliki.
      await this.assertCanTouchHolder(tx, actor, membershipId);
      const rows = await tx.query<{ id: string }>(
        `UPDATE tenant_memberships SET status = 'SUSPENDED', version = version + 1
         WHERE id = $1 AND status = 'ACTIVE' AND version = $2 RETURNING id`,
        [membershipId, version],
      );
      if (rows.length === 0) await this.explainNoRow(tx, membershipId, 'Hanya anggota aktif yang dapat ditangguhkan.');
      await assertTenantStaysAdministrable(tx);
      // Session di tenant ini ikut dicabut (keputusan 2026-09-22): anggota yang
      // ditangguhkan tidak sekadar kehilangan permission, ia keluar.
      const s = await tx.query<{ id: string }>(
        `UPDATE sessions SET status = 'REVOKED', revoked_at = now(), revocation_reason = 'MEMBERSHIP_SUSPENDED'
         WHERE membership_id = $1 AND status = 'ACTIVE' RETURNING id`,
        [membershipId],
      );
      return s.length;
    });
    await this.record(session, 'member.suspended', membershipId, { sessionsRevoked: revoked });
    return this.detail(tenantId, membershipId);
  }

  /**
   * Mengaktifkan kembali anggota yang ditangguhkan (D-27). Aturannya cermin
   * penangguhan: tidak untuk diri sendiri, anti-eskalasi atas hak pemegangnya,
   * versi, dan audit. Session lama TIDAK dihidupkan: anggota login ulang.
   */
  async reactivate(session: ResolvedSession, actor: Set<string>, membershipId: string, version: number): Promise<MemberView> {
    const tenantId = session.tenant_id as string;
    assertNotSelf(session.membership_id as string, membershipId, 'mengaktifkan kembali');

    await this.uow.withTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      // Tanpa ini, admin dapat menghidupkan kembali owner yang ditangguhkan owner
      // lain: hak yang kembali adalah hak di luar jangkauan pelaku.
      await this.assertCanTouchHolder(tx, actor, membershipId);
      const rows = await tx.query<{ id: string }>(
        `UPDATE tenant_memberships SET status = 'ACTIVE', version = version + 1
         WHERE id = $1 AND status = 'SUSPENDED' AND version = $2 RETURNING id`,
        [membershipId, version],
      );
      if (rows.length === 0) await this.explainNoRow(tx, membershipId, 'Hanya anggota yang ditangguhkan yang dapat diaktifkan kembali.');
    });
    await this.record(session, 'member.reactivated', membershipId, {});
    return this.detail(tenantId, membershipId);
  }

  async replaceRoles(
    session: ResolvedSession, actor: Set<string>, membershipId: string, roleIds: string[], version: number,
  ): Promise<MemberView> {
    const tenantId = session.tenant_id as string;
    assertNotSelf(session.membership_id as string, membershipId, 'mengubah role');

    const change = await this.uow.withTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const current = (await tx.query<{ role_id: string }>(
        `SELECT role_id FROM user_role_assignments WHERE membership_id = $1 AND ended_at IS NULL`, [membershipId],
      )).map((r) => r.role_id);
      const added = roleIds.filter((r) => !current.includes(r));
      const removed = current.filter((r) => !roleIds.includes(r));

      const info = await permissionsOfRoles(tx, [...added, ...removed]);
      for (const id of added) {
        const role = info.get(id);
        if (!role) throw new BadRequestException('Role tidak dikenal.');
        if (role.archived) throw new BadRequestException('Role yang sudah diarsipkan tidak dapat diberikan.');
      }
      // Yang diberikan maupun yang dicabut: keduanya harus dalam jangkauan pelaku.
      for (const id of [...added, ...removed]) assertWithin(actor, info.get(id)?.perms ?? []);

      const rows = await tx.query<{ id: string }>(
        `UPDATE tenant_memberships SET version = version + CASE WHEN $3 THEN 1 ELSE 0 END
         WHERE id = $1 AND version = $2 RETURNING id`,
        [membershipId, version, added.length + removed.length > 0],
      );
      if (rows.length === 0) await this.explainNoRow(tx, membershipId, STALE);

      if (removed.length) {
        await tx.query(
          `UPDATE user_role_assignments SET ended_at = now()
           WHERE membership_id = $1 AND role_id = ANY($2::uuid[]) AND ended_at IS NULL`,
          [membershipId, removed],
        );
      }
      for (const id of added) {
        await tx.query(
          `INSERT INTO user_role_assignments (tenant_id, membership_id, role_id, assigned_by_membership_id)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, membershipId, id, session.membership_id],
        );
      }
      await assertTenantStaysAdministrable(tx);
      return { added, removed };
    });

    if (change.added.length + change.removed.length > 0) {
      await this.record(session, 'member.roles_replaced', membershipId, change);
    }
    return this.detail(tenantId, membershipId);
  }

  // ---------------------------------------------------------------- bantuan

  /**
   * Hak yang DIPEGANG anggota lewat role-nya, apa pun status membership-nya.
   * Bukan view effective_permissions: view itu hanya menghitung membership
   * ACTIVE, sehingga anggota yang ditangguhkan tampak tanpa hak apa pun dan
   * anti-eskalasi pada reaktivasi lulus untuk siapa saja (D-27).
   */
  private async assertCanTouchHolder(tx: Tx, actor: Set<string>, membershipId: string): Promise<void> {
    const held = await tx.query<{ permission_code: string }>(
      `SELECT DISTINCT rp.permission_code
       FROM user_role_assignments a
       JOIN roles r             ON r.tenant_id = a.tenant_id AND r.id = a.role_id
       JOIN role_permissions rp ON rp.tenant_id = a.tenant_id AND rp.role_id = a.role_id
       JOIN permissions p       ON p.code = rp.permission_code AND p.scope = 'TENANT'
       WHERE a.membership_id = $1 AND a.ended_at IS NULL AND r.archived_at IS NULL AND p.retired_at IS NULL`,
      [membershipId]);
    assertWithin(actor, held.map((h) => h.permission_code));
  }

  private async bumpVersion(tx: Tx, membershipId: string, version: number): Promise<void> {
    const rows = await tx.query<{ id: string }>(
      'UPDATE tenant_memberships SET version = version + 1 WHERE id = $1 AND version = $2 RETURNING id',
      [membershipId, version]);
    if (rows.length === 0) await this.explainNoRow(tx, membershipId, STALE);
  }

  /** UPDATE tanpa baris: anggota tidak ada (404) atau syaratnya tidak terpenuhi (409). */
  private async explainNoRow(tx: Tx, membershipId: string, conflict: string): Promise<never> {
    const exists = await tx.query('SELECT 1 FROM tenant_memberships WHERE id = $1', [membershipId]);
    if (exists.length === 0) throw new NotFoundException('Anggota tidak ditemukan.');
    throw new ConflictException(conflict);
  }

  private async decrypt(tenantId: string, rows: MemberRow[]): Promise<MemberView[]> {
    // Di dalam support session, nama anggota ikut DI-MASKER (ADR-003 sec.2.2 butir
    // 3). Alasannya bukan kerapian: support membaca daftar anggota untuk menolong
    // satu kasus, bukan untuk mengumpulkan daftar nama pelanggan tenant. Membuka
    // masker per field adalah aksi tersendiri dengan alasan dan audit, dan aksi itu
    // belum ada di baseline - dicatat sebagai D-37, bukan dianggap selesai.
    //
    // Email SUDAH ber-masker untuk semua pemanggil sejak slice 8, jadi tidak ada
    // cabang tambahan untuknya di sini.
    const support = supportContext() !== null;

    try {
      return await Promise.all(rows.map(async (r) => ({
        membership_id: r.membership_id,
        // Scope kunci = tenant dari SESSION, tidak pernah dari input (SSOT sec.9).
        display_name: await this.crypto.decrypt(
          FIELDS.profileDisplayName, tenantId, r.profile_id, r.display_name_ciphertext, r.display_name_key_version)
          .then((nama) => (support ? maskName(nama) : nama)),
        contact_email_masked: maskEmail(await this.crypto.decrypt(
          FIELDS.profileContactEmail, tenantId, r.profile_id, r.contact_email_ciphertext, r.contact_email_key_version)),
        status: r.status,
        version: r.version,
        roles: r.roles,
      })));
    } catch (error) {
      // Fail-closed: baris yang tidak dapat dibuka menggagalkan seluruh jawaban.
      if (error instanceof DecryptionError) throw new InternalServerErrorException('Data anggota tidak dapat dibaca.');
      throw error;
    }
  }

  private record(session: ResolvedSession, eventType: AuditEventType, membershipId: string, detail: Record<string, unknown>) {
    return this.audit.record({
      eventType, outcome: 'SUCCESS', tenantId: session.tenant_id, actorUserId: session.user_id,
      actorSessionId: session.session_id, subjectType: 'membership', subjectId: membershipId, detail,
    });
  }
}
