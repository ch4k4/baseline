import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Tx, UnitOfWork } from '../database/unit-of-work.js';
import { AuditService } from '../auth/audit.service.js';
import { sqlState } from '../admin/admin-rules.js';

/**
 * Pengelolaan admin platform (DEMO-0311, ADR-003 sec.2.1 dan sec.2.5).
 *
 * Seluruh query berjalan lewat uow.withPlatform: tabel platform_role_assignments
 * hanya terbuka pada context platform (policy 0018). Kalau suatu hari kode ini
 * dipanggil dari jalur tenant, ia tidak akan "berhasil dengan hak lebih" - ia
 * akan melihat nol baris.
 *
 * TIGA ATURAN dari ADR-003:
 *
 *   1. tidak dapat mengubah assignment diri sendiri;
 *   2. superadmin terakhir tidak dapat dicabut;
 *   3. setiap pemberian dan pencabutan tercatat di audit platform.
 *
 * Aturan 2 diperiksa setelah mutasi, di dalam transaksi yang sama, di bawah
 * kunci advisory - pola yang sama dengan assertTenantStaysAdministrable.
 *
 * CATATAN JUJUR tentang aturan 2: dengan aturan 1 berlaku, aturan 2 TIDAK dapat
 * dipicu lewat endpoint ini. Pelaku selalu seorang admin aktif (kalau tidak, ia
 * tidak punya permission untuk sampai ke sini), dan ia tidak boleh mencabut
 * dirinya sendiri; jadi sesudah pencabutan minimal satu admin - pelakunya -
 * selalu tersisa. Aturan ini tetap dipasang sebagai lapis kedua untuk saat
 * penangguhan identitas global (platform.identities.suspend) atau role platform
 * kedua masuk, karena keduanya membuka jalan yang tidak lewat aturan 1. Uji
 * mutasi atas aturan ini LOLOS, dan itu dicatat di AUDIT.md apa adanya.
 */

const ROLE_CODE = 'platform_superadmin';

export interface PlatformAdmin {
  id: string;
  user_id: string;
  role_code: string;
  granted_at: Date;
  granted_by: string | null;
  reason: string | null;
}

export interface PlatformActor {
  userId: string;
  sessionId: string;
}

/** Serialisasi mutasi daftar admin platform sampai transaksi selesai. */
async function lockPlatformAdmins(tx: Tx): Promise<void> {
  // Dibungkus count(*): Prisma tidak dapat membaca kolom bertipe void.
  await tx.query(
    'SELECT count(*)::int AS n FROM (SELECT pg_advisory_xact_lock(hashtextextended($1, 0))) k',
    ['platform-admins'],
  );
}

/**
 * Alasan adalah teks bebas yang diketik manusia dan TIDAK dienkripsi - kolom
 * seperti itu bukan tempat data pribadi (pelajaran D-26). Yang ditolak hanya
 * alamat email. Deretan angka justru sah di sini: nomor tiket dukungan.
 */
function assertReason(reason: string | null): string | null {
  if (reason === null) return null;
  const trimmed = reason.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 200) {
    throw new BadRequestException('Alasan maksimal 200 karakter.');
  }
  if (trimmed.includes('@')) {
    throw new BadRequestException(
      'Alasan bukan tempat data pribadi: alamat email tidak diterima. Sebut nomor tiket atau keputusannya.',
    );
  }
  return trimmed;
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  /**
   * Daftar admin platform aktif. Tanpa email maupun nama: superadmin tidak
   * membaca identitas global dalam bentuk terbuka (ADR-003 sec.2.1), dan daftar
   * ini tidak perlu tahu siapa orangnya untuk menjawab "siapa saja yang
   * berkuasa" - id sudah cukup untuk mencabutnya.
   */
  async listAdmins(): Promise<PlatformAdmin[]> {
    return this.uow.withPlatform((tx) =>
      tx.query<PlatformAdmin>(
        `SELECT id, user_id, role_code, granted_at, granted_by, reason
         FROM platform_role_assignments
         WHERE revoked_at IS NULL
         ORDER BY granted_at, id`,
      ),
    );
  }

  async grant(actor: PlatformActor, userId: string, reason: string | null): Promise<{ id: string }> {
    if (userId === actor.userId) {
      throw new ForbiddenException('Anda tidak dapat mengubah hak platform diri sendiri.');
    }
    const alasan = assertReason(reason);

    const id = await this.uow.withPlatform(async (tx) => {
      await lockPlatformAdmins(tx);
      try {
        const [row] = await tx.query<{ id: string }>(
          `INSERT INTO platform_role_assignments (user_id, role_code, granted_by, reason)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [userId, ROLE_CODE, actor.userId, alasan],
        );
        return row.id;
      } catch (error) {
        const state = sqlState(error);
        // Index unik parsial: sudah memegang hak ini.
        if (state === '23505') {
          throw new ConflictException('Identitas itu sudah menjadi admin platform.');
        }
        // FK ke users: identitas tidak ada. Jawaban sengaja tidak membedakan
        // "tidak ada" dari "tidak boleh" lebih jauh dari ini.
        if (state === '23503') {
          throw new BadRequestException('Identitas tidak dikenal.');
        }
        throw error;
      }
    });

    await this.audit.record({
      eventType: 'platform.admin_granted',
      outcome: 'SUCCESS',
      actorUserId: actor.userId,
      actorSessionId: actor.sessionId,
      subjectType: 'PLATFORM_ROLE_ASSIGNMENT',
      subjectId: id,
      detail: { roleCode: ROLE_CODE, via: 'API' },
    });

    return { id };
  }

  async revoke(actor: PlatformActor, assignmentId: string): Promise<void> {
    await this.uow.withPlatform(async (tx) => {
      await lockPlatformAdmins(tx);

      const [target] = await tx.query<{ user_id: string }>(
        `SELECT user_id FROM platform_role_assignments WHERE id = $1 AND revoked_at IS NULL`,
        [assignmentId],
      );
      if (!target) throw new NotFoundException('Assignment tidak ditemukan.');
      if (target.user_id === actor.userId) {
        throw new ForbiddenException('Anda tidak dapat mengubah hak platform diri sendiri.');
      }

      await tx.query(
        `UPDATE platform_role_assignments
         SET revoked_at = now(), revoked_by = $2
         WHERE id = $1 AND revoked_at IS NULL`,
        [assignmentId, actor.userId],
      );

      // Lapis kedua, diperiksa SESUDAH mutasi di dalam transaksi yang sama.
      const [sisa] = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM platform_role_assignments WHERE revoked_at IS NULL`,
      );
      if (!sisa || sisa.n < 1) {
        throw new ConflictException('Platform tidak boleh kehilangan superadmin terakhir.');
      }
    });

    await this.audit.record({
      eventType: 'platform.admin_revoked',
      outcome: 'SUCCESS',
      actorUserId: actor.userId,
      actorSessionId: actor.sessionId,
      subjectType: 'PLATFORM_ROLE_ASSIGNMENT',
      subjectId: assignmentId,
      detail: { roleCode: ROLE_CODE },
    });
  }
}
