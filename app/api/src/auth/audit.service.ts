import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../database/unit-of-work.js';
import { CryptoService } from '../crypto/crypto.module.js';
import { AuditEventType } from './audit-events.js';
import { supportContext } from '../database/support-context.js';

/**
 * Penulis audit. Satu-satunya jalan kode aplikasi menulis ke audit_logs.
 *
 * Aturan yang tidak boleh dilanggar: TIDAK ADA email, password, token, atau
 * tiket yang masuk ke sini. Yang boleh hanyalah hash identifier. Database
 * menolak detail yang memuat kunci-kunci itu (F-14), jadi pelanggaran menjadi
 * error yang terlihat - bukan data pribadi yang diam-diam tersimpan 12 bulan.
 *
 * Kegagalan menulis audit TIDAK menggagalkan operasi yang diauditnya. Alasannya
 * praktis: kalau audit down membuat login mati, audit berubah menjadi titik
 * kegagalan tunggal. Tapi kegagalannya dicatat ke log proses supaya tidak senyap.
 */

export interface AuditEvent {
  // Hanya nama yang terdaftar (audit-events.ts + katalog 0016). Nama di luar
  // daftar ditolak compiler; kalau toh lolos, foreign key menolaknya.
  eventType: AuditEventType;
  outcome: 'SUCCESS' | 'FAILURE';
  tenantId?: string | null;
  actorUserId?: string | null;
  actorSessionId?: string | null;
  identifier?: string | null; // akan di-hash, tidak pernah disimpan apa adanya
  subjectType?: string | null;
  subjectId?: string | null;
  detail?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Pseudonim identifier (mis. email) untuk penghitungan tanpa menyimpan nilainya.
   *
   * Sebelum D-01 ini SHA-256 TANPA kunci. Pseudonim tanpa kunci dapat dibalik
   * oleh siapa pun yang memegang daftar email: hash setiap kandidat, cocokkan.
   * Audit disimpan 12 bulan, jadi kelemahan itu berumur 12 bulan juga. Sekarang
   * HMAC dengan kunci purpose tersendiri (platform_audit_identifier).
   */
  hashIdentifier(value: string): Promise<Buffer> {
    return this.crypto.auditIdentifier(value);
  }

  /**
   * Di dalam support session, SETIAP baris audit yang ditulis dari permintaan itu
   * ikut membawa support_session_id dan actor_type (ADR-003 sec.2.3).
   *
   * Dipasang di sini, bukan di setiap pemanggil: pemanggilnya adalah service tenant
   * biasa (members, roles, notifications) yang tidak tahu - dan tidak perlu tahu -
   * bahwa ia sedang melayani sesi support. Satu tempat berarti tidak ada baris yang
   * lupa membawanya, dan itulah bedanya antara jejak yang dapat ditelusuri dan
   * jejak yang hampir lengkap.
   */
  private enrich(detail: Record<string, unknown>): Record<string, unknown> {
    const support = supportContext();
    if (!support) return detail;
    return {
      ...detail,
      actorType: 'PLATFORM_SUPPORT',
      supportSessionId: support.supportSessionId,
      supportScope: support.scope,
    };
  }

  async record(event: AuditEvent): Promise<void> {
    try {
      const identifierHash = event.identifier ? await this.hashIdentifier(event.identifier) : null;
      await this.uow.withoutTenant((tx) =>
        tx.query('SELECT auth.write_audit_event($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
          event.eventType,
          event.outcome,
          event.tenantId ?? null,
          event.actorUserId ?? null,
          event.actorSessionId ?? null,
          identifierHash,
          event.subjectType ?? null,
          event.subjectId ?? null,
          JSON.stringify(this.enrich(event.detail ?? {})),
        ]),
      );
    } catch (error) {
      console.error('[audit] gagal menulis kejadian', event.eventType, error);
    }
  }

  async countRecentFailures(identifier: string, windowSeconds: number): Promise<number> {
    const hash = await this.hashIdentifier(identifier);
    const rows = await this.uow.withoutTenant((tx) =>
      tx.query<{ count_recent_failures: number }>(
        'SELECT auth.count_recent_failures($1,$2) AS count_recent_failures',
        [hash, windowSeconds],
      ),
    );
    return rows[0]?.count_recent_failures ?? 0;
  }
}
