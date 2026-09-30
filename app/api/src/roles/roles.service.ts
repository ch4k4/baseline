import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UnitOfWork, Tx } from '../database/unit-of-work.js';
import { AuditService } from '../auth/audit.service.js';
import { AuditEventType } from '../auth/audit-events.js';
import { ResolvedSession } from '../auth/pre-context.repository.js';
import { assertTenantStaysAdministrable, assertWithin, lockTenant, sqlState, STALE } from '../admin/admin-rules.js';

export interface RoleView {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  archived: boolean;
  version: number;
  permissions: string[];
  active_members: number;
}

const ROLE_SELECT = `
  SELECT r.id, r.code, r.name, r.is_system, r.archived_at IS NOT NULL AS archived, r.version,
         COALESCE((SELECT array_agg(rp.permission_code ORDER BY rp.permission_code)
                   FROM role_permissions rp WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id), '{}') AS permissions,
         (SELECT count(*)::int FROM user_role_assignments a
          WHERE a.tenant_id = r.tenant_id AND a.role_id = r.id AND a.ended_at IS NULL) AS active_members
  FROM roles r`;

const CODE_RE = /^[a-z][a-z0-9_]{1,63}$/;

/**
 * Nama role adalah LABEL, bukan tempat data pribadi (D-26). Dua bentuk yang
 * pasti salah tempat ditolak: alamat email, dan deretan 8 digit atau lebih
 * (NIK, telepon, nomor KK, NPWP).
 *
 * Aturannya sengaja sempit. Regex tidak dapat membedakan nama orang dari nama
 * jabatan, dan aturan yang menebak akan menolak "Manajer Gudang Budi" sambil
 * meloloskan hal lain - lalu orang belajar mengakalinya. Sisanya dijaga
 * peringatan di layar, dan penjaga terakhirnya CHECK di tabel (migrasi 0017):
 * pemeriksaan di sini hanya supaya pesannya dapat dibaca manusia.
 */
const EMAIL_DI_NAMA = /@/;
const DERET_ANGKA = /[0-9]{8}/;

function assertNamaLabel(name: string): void {
  if (EMAIL_DI_NAMA.test(name)) {
    throw new BadRequestException('Nama role tidak boleh memuat alamat email. Nama role adalah label, bukan data orang.');
  }
  if (DERET_ANGKA.test(name)) {
    throw new BadRequestException('Nama role tidak boleh memuat deretan 8 angka atau lebih (NIK, telepon, NPWP). Nama role adalah label, bukan data orang.');
  }
}

/**
 * Administrasi role (DEMO-0306). Role sistem (dari seed) tidak dapat diubah
 * tenant: dijaga policy database (0013) dan dijelaskan di sini dengan 409.
 */
@Injectable()
export class RolesService {
  constructor(private readonly uow: UnitOfWork, private readonly audit: AuditService) {}

  list(tenantId: string): Promise<RoleView[]> {
    return this.uow.withTenant(tenantId, (tx) => tx.query<RoleView>(`${ROLE_SELECT} ORDER BY r.is_system DESC, r.code`));
  }

  async detail(tenantId: string, roleId: string): Promise<RoleView> {
    const rows = await this.uow.withTenant(tenantId, (tx) => tx.query<RoleView>(`${ROLE_SELECT} WHERE r.id = $1`, [roleId]));
    if (rows.length === 0) throw new NotFoundException('Role tidak ditemukan.');
    return rows[0];
  }

  async create(session: ResolvedSession, code: string, name: string): Promise<RoleView> {
    const tenantId = session.tenant_id as string;
    if (!CODE_RE.test(code)) throw new BadRequestException('code: huruf kecil, angka, garis bawah; 2-64 karakter, diawali huruf.');
    const cleanName = name.normalize('NFC').trim();
    if (!cleanName || cleanName.length > 100) throw new BadRequestException('name wajib diisi (maksimal 100 karakter).');
    assertNamaLabel(cleanName);
    const id = randomUUID();
    try {
      await this.uow.withTenant(tenantId, (tx) =>
        tx.query('INSERT INTO roles (id, tenant_id, code, name) VALUES ($1, $2, $3, $4)', [id, tenantId, code, cleanName]));
    } catch (error: any) {
      if (sqlState(error) === '23505' || String(error?.message).includes('23505')) {
        throw new ConflictException('Kode role sudah dipakai di tenant ini.');
      }
      throw error;
    }
    await this.record(session, 'role.created', id, { code });
    return this.detail(tenantId, id);
  }

  async rename(session: ResolvedSession, roleId: string, name: string, version: number): Promise<RoleView> {
    const tenantId = session.tenant_id as string;
    const cleanName = name.normalize('NFC').trim();
    if (!cleanName || cleanName.length > 100) throw new BadRequestException('name wajib diisi (maksimal 100 karakter).');
    assertNamaLabel(cleanName);
    await this.uow.withTenant(tenantId, async (tx) => {
      const rows = await tx.query(
        `UPDATE roles SET name = $2, version = version + 1, updated_at = now()
         WHERE id = $1 AND version = $3 AND archived_at IS NULL RETURNING id`,
        [roleId, cleanName, version]);
      if (rows.length === 0) await this.explainNoRow(tx, roleId);
    });
    await this.record(session, 'role.updated', roleId, {});
    return this.detail(tenantId, roleId);
  }

  async archive(session: ResolvedSession, actor: Set<string>, roleId: string, version: number): Promise<RoleView> {
    const tenantId = session.tenant_id as string;
    await this.uow.withTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      // Mengarsipkan = mencabut isi role dari semua pemegangnya: harus dalam jangkauan pelaku.
      assertWithin(actor, await this.permissionsOf(tx, roleId));
      const rows = await tx.query(
        `UPDATE roles SET archived_at = now(), version = version + 1, updated_at = now()
         WHERE id = $1 AND version = $2 AND archived_at IS NULL RETURNING id`,
        [roleId, version]);
      if (rows.length === 0) await this.explainNoRow(tx, roleId);
      await assertTenantStaysAdministrable(tx);
    });
    await this.record(session, 'role.archived', roleId, {});
    return this.detail(tenantId, roleId);
  }

  /**
   * Mengganti seluruh isi permission role. Satu transaksi; permintaan yang
   * setara (himpunan sama) tidak mengubah apa pun, termasuk versi.
   */
  async replacePermissions(
    session: ResolvedSession, actor: Set<string>, roleId: string, requested: string[], version: number,
  ): Promise<RoleView> {
    const tenantId = session.tenant_id as string;
    const change = await this.uow.withTenant(tenantId, async (tx) => {
      await lockTenant(tx, tenantId);
      const catalog = new Set((await tx.query<{ code: string }>(
        `SELECT code FROM permissions WHERE scope = 'TENANT' AND retired_at IS NULL`)).map((r) => r.code));
      const unknown = requested.filter((p) => !catalog.has(p));
      // Permission platform, pensiun, atau salah ketik: satu pesan, 400.
      if (unknown.length) throw new BadRequestException(`Permission tidak dapat dipasang: ${unknown.join(', ')}`);

      const current = await this.permissionsOf(tx, roleId);
      const added = requested.filter((p) => !current.includes(p));
      const removed = current.filter((p) => !requested.includes(p));
      assertWithin(actor, [...added, ...removed]);

      const rows = await tx.query(
        `UPDATE roles SET version = version + CASE WHEN $3 THEN 1 ELSE 0 END, updated_at = now()
         WHERE id = $1 AND version = $2 AND archived_at IS NULL AND is_system = false RETURNING id`,
        [roleId, version, added.length + removed.length > 0]);
      if (rows.length === 0) await this.explainNoRow(tx, roleId);

      if (removed.length) {
        await tx.query('DELETE FROM role_permissions WHERE role_id = $1 AND permission_code = ANY($2::text[])', [roleId, removed]);
      }
      if (added.length) {
        await tx.query(
          `INSERT INTO role_permissions (tenant_id, role_id, permission_code) SELECT $1, $2, unnest($3::text[])`,
          [tenantId, roleId, added]);
      }
      await assertTenantStaysAdministrable(tx);
      return { added, removed };
    });
    if (change.added.length + change.removed.length > 0) {
      await this.record(session, 'role.permissions_replaced', roleId, change);
    }
    return this.detail(tenantId, roleId);
  }

  // ---------------------------------------------------------------- bantuan

  private async permissionsOf(tx: Tx, roleId: string): Promise<string[]> {
    const rows = await tx.query<{ is_system: boolean }>('SELECT is_system FROM roles WHERE id = $1', [roleId]);
    if (rows.length === 0) throw new NotFoundException('Role tidak ditemukan.');
    return (await tx.query<{ permission_code: string }>(
      'SELECT permission_code FROM role_permissions WHERE role_id = $1', [roleId])).map((r) => r.permission_code);
  }

  /** UPDATE tanpa baris: role tidak ada (404), role sistem / diarsipkan / versi basi (409). */
  private async explainNoRow(tx: Tx, roleId: string): Promise<never> {
    const rows = await tx.query<{ is_system: boolean; archived: boolean }>(
      'SELECT is_system, archived_at IS NOT NULL AS archived FROM roles WHERE id = $1', [roleId]);
    if (rows.length === 0) throw new NotFoundException('Role tidak ditemukan.');
    if (rows[0].is_system) throw new ConflictException('Role sistem tidak dapat diubah.');
    if (rows[0].archived) throw new ConflictException('Role sudah diarsipkan.');
    throw new ConflictException(STALE);
  }

  private record(session: ResolvedSession, eventType: AuditEventType, roleId: string, detail: Record<string, unknown>) {
    return this.audit.record({
      eventType, outcome: 'SUCCESS', tenantId: session.tenant_id, actorUserId: session.user_id,
      actorSessionId: session.session_id, subjectType: 'role', subjectId: roleId, detail,
    });
  }
}
