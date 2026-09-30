import { Injectable } from '@nestjs/common';
import { Tx, UnitOfWork } from '../database/unit-of-work.js';
import { AuditService } from '../auth/audit.service.js';
import { PreContextRepository } from '../auth/pre-context.repository.js';

/**
 * Pengakhiran support session (DEMO-0312) - satu tempat untuk SEMUA cara sesi
 * berakhir (ADR-003 sec.2.2: kedaluwarsa, /end, revoke, logout platform).
 *
 * Kenapa terpisah dari SupportService: jalur logout hidup di AuthService, dan
 * AuthService tidak boleh bergantung pada modul support (modul support sendiri
 * bergantung pada AuthModule - saling-bergantung itu tidak akan pernah terpasang).
 * Kelas ini hanya bergantung pada hal yang sudah ada di AuthModule, sehingga
 * keduanya dapat memakainya.
 *
 * Yang tidak boleh berbeda antar cara berakhir, dan karena itu ada di sini:
 *
 *   1. tenant DIBERI TAHU setiap kali sesi berakhir, bukan hanya saat dimulai.
 *      Notifikasi "dibuka" tanpa notifikasi "ditutup" membuat tenant tidak pernah
 *      tahu apakah akses platform masih terbuka - kabar setengah lebih buruk
 *      daripada tidak ada kabar.
 *   2. audit ditulis DUA kali: satu baris dengan tenant_id (audit tenant) dan satu
 *      tanpa (audit platform). audit_logs punya satu kolom tenant_id, jadi satu
 *      baris hanya dapat berada di salah satu tempat - dan ADR-003 sec.2.2 butir 7
 *      menuntut kejadian ini terlihat di KEDUANYA.
 */
@Injectable()
export class SupportLifecycleService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly preContext: PreContextRepository,
  ) {}

  /**
   * Notifikasi tenant lewat F-15. Kegagalannya TIDAK menggagalkan operasi yang
   * diberitakannya - sama seperti audit - tetapi dicatat ke log proses. Sesi yang
   * gagal ditutup karena notifikasi gagal akan jauh lebih berbahaya daripada
   * notifikasi yang hilang.
   */
  async notify(tenantId: string, type: 'SUPPORT_SESSION_STARTED' | 'SUPPORT_SESSION_ENDED', refId: string): Promise<void> {
    try {
      await this.uow.withoutTenant((tx) =>
        tx.query('SELECT auth.notify_tenant_security_event($1, $2, $3)', [tenantId, type, refId]),
      );
    } catch (error) {
      console.error('[support] gagal menulis notifikasi tenant', type, error);
    }
  }

  /** Audit yang terlihat di dua tempat: tenant dan platform. */
  async auditBoth(
    eventType: 'support.session.started' | 'support.session.ended' | 'support.session.revoked',
    row: { id: string; tenant_id: string },
    actorUserId: string | null,
    actorSessionId: string | null,
    detail: Record<string, unknown>,
  ): Promise<void> {
    for (const tenantId of [row.tenant_id, null]) {
      await this.audit.record({
        eventType,
        outcome: 'SUCCESS',
        tenantId,
        actorUserId,
        actorSessionId,
        subjectType: 'SUPPORT_SESSION',
        subjectId: row.id,
        detail,
      });
    }
  }

  /**
   * Menutup sesi yang sudah lewat waktunya (status masih ACTIVE, expires_at sudah
   * lampau). Dijalankan sebelum membuat sesi baru dan sebelum menampilkan daftar.
   *
   * Tanpa ini, index unik "satu sesi aktif per superadmin" akan menolak sesi baru
   * karena baris yang sebenarnya sudah mati - dan pesannya akan berbunyi "sudah
   * ada sesi aktif" kepada orang yang tidak punya satu pun. Tidak ada job periodik
   * di baseline; pembersihan menempel pada jalur yang memang peduli.
   */
  async sweepExpired(actorSessionId: string | null): Promise<number> {
    const habis = await this.uow.withPlatform((tx) =>
      tx.query<{ id: string; tenant_id: string; superadmin_user_id: string }>(
        `UPDATE support_sessions
         SET status = 'EXPIRED', ended_at = expires_at, end_reason = 'EXPIRED'
         WHERE status = 'ACTIVE' AND expires_at <= now()
         RETURNING id, tenant_id, superadmin_user_id`,
      ),
    );

    for (const row of habis) {
      await this.auditBoth('support.session.ended', row, row.superadmin_user_id, actorSessionId, {
        endReason: 'EXPIRED',
      });
      await this.notify(row.tenant_id, 'SUPPORT_SESSION_ENDED', row.id);
    }
    return habis.length;
  }

  /**
   * Logout atau pencabutan session PLATFORM (ADR-003 sec.2.6 butir 5).
   *
   * Token support sudah mati sejak baris session platform dicabut - guard
   * memeriksa keduanya. Yang dikerjakan di sini adalah menutup barisnya supaya
   * riwayatnya benar dan index "satu sesi aktif" terbebas, serta memberi tahu
   * tenant bahwa aksesnya sudah tertutup.
   */
  async endForPlatformSession(
    platformSessionId: string,
    actorUserId: string | null,
  ): Promise<number> {
    const ended = await this.preContext.endSupportSessionsForPlatformSession(platformSessionId);

    for (const row of ended) {
      await this.auditBoth(
        'support.session.ended',
        { id: row.support_session_id, tenant_id: row.tenant_id },
        actorUserId,
        platformSessionId,
        { endReason: 'PLATFORM_LOGOUT' },
      );
      await this.notify(row.tenant_id, 'SUPPORT_SESSION_ENDED', row.support_session_id);
    }
    return ended.length;
  }

  /** Dipakai SupportService: pengakhiran manual di dalam transaksi platform. */
  async closeInPlatformTx(
    tx: Tx,
    id: string,
    endReason: 'MANUAL' | 'REVOKED',
    actorUserId: string,
  ): Promise<number> {
    const rows = await tx.query<{ id: string }>(
      `UPDATE support_sessions
       SET status = $2, ended_at = now(), ended_by = $3, end_reason = $4
       WHERE id = $1 AND status = 'ACTIVE'
       RETURNING id`,
      [id, endReason === 'MANUAL' ? 'ENDED' : 'REVOKED', actorUserId, endReason],
    );
    return rows.length;
  }
}
