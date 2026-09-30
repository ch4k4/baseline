import { Injectable, NotFoundException } from '@nestjs/common';
import { UnitOfWork } from '../database/unit-of-work.js';

/**
 * Notifikasi keamanan tenant (DEMO-0313, ADR-003 sec.2.4).
 *
 * Tenant membaca kesaksian tentang platform: kapan sebuah support session dibuka
 * ke tenantnya, dan kapan berakhir. Tenant tidak dapat MEMBUATNYA - app_user
 * tidak punya grant INSERT sama sekali, dan satu-satunya jalan masuk adalah F-15
 * yang dipanggil dari context platform (migrasi 0019).
 *
 * BATAS YANG PERLU DIULANG: support session baru ada di DEMO-0312, jadi sampai
 * itu daftar ini selalu kosong dalam pemakaian normal. Yang sudah nyata di sini
 * adalah isolasi tenant, larangan menulis, dan syarat permission.
 */

export interface SecurityNotification {
  id: string;
  type: string;
  ref_id: string;
  created_at: Date;
  read_at: Date | null;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Yang belum dibaca lebih dulu, lalu terbaru; RLS yang membatasi ke tenant ini. */
  async list(tenantId: string, limit = 50): Promise<SecurityNotification[]> {
    return this.uow.withTenant(tenantId, (tx) =>
      tx.query<SecurityNotification>(
        `SELECT id, type, ref_id, created_at, read_at
         FROM tenant_notifications
         ORDER BY (read_at IS NOT NULL), created_at DESC
         LIMIT $1`,
        [limit],
      ),
    );
  }

  async unreadCount(tenantId: string): Promise<number> {
    const [row] = await this.uow.withTenant(tenantId, (tx) =>
      tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tenant_notifications WHERE read_at IS NULL`,
      ),
    );
    return row?.n ?? 0;
  }

  /**
   * Menandai terbaca. Tidak dapat dibatalkan: policy UPDATE hanya menerima baris
   * yang belum terbaca, jadi jejak "siapa melihat ini" tidak dapat dibersihkan.
   * Menandai dua kali bukan kesalahan - hasilnya sama - sehingga tombol yang
   * diklik dua kali tidak menghasilkan pesan gagal yang membingungkan.
   */
  async markRead(
    tenantId: string,
    membershipId: string,
    id: string,
  ): Promise<{ status: 'READ' | 'ALREADY_READ' }> {
    return this.uow.withTenant(tenantId, async (tx) => {
      const updated = await tx.query<{ id: string }>(
        `UPDATE tenant_notifications
         SET read_at = now(), read_by_membership_id = $2
         WHERE id = $1 AND read_at IS NULL
         RETURNING id`,
        [id, membershipId],
      );
      if (updated.length === 1) return { status: 'READ' as const };

      // Nol baris punya dua sebab yang harus dibedakan untuk pemanggil, tetapi
      // tidak untuk tenant lain: baris tenant lain tidak terlihat sama sekali,
      // jadi jawabannya "tidak ditemukan" - bukan "milik orang lain".
      const ada = await tx.query<{ id: string }>(
        `SELECT id FROM tenant_notifications WHERE id = $1`,
        [id],
      );
      if (ada.length === 0) throw new NotFoundException('Notifikasi tidak ditemukan.');
      return { status: 'ALREADY_READ' as const };
    });
  }
}
