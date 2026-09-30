import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UnitOfWork } from '../database/unit-of-work.js';
import { CryptoService } from '../crypto/crypto.module.js';
import { FIELDS } from '../crypto/field-crypto.js';
import { PLATFORM } from '../crypto/key-ring.js';
import { TokenService } from '../auth/token.service.js';
import { sqlState } from '../admin/admin-rules.js';
import { SupportLifecycleService } from './support-lifecycle.service.js';
import {
  MAX_DURATION_MINUTES,
  REASON_CODES,
  ReasonCode,
  SupportScope,
  WRITE_REASON_CODES,
} from './support-permissions.js';

/**
 * Support session break-glass (DEMO-0312, ADR-003 sec.2.2).
 *
 * Yang ditegakkan DI SINI adalah hal-hal yang membutuhkan kalimat untuk pemakainya.
 * Yang ditegakkan DI DATABASE (migrasi 0020) adalah hal-hal yang tidak boleh
 * bergantung pada kode ini sama sekali:
 *
 *   durasi <= 60 menit            -> CHECK support_sessions_duration_ck
 *   READ_WRITE hanya untuk satu alasan -> CHECK support_sessions_write_reason_ck
 *   satu sesi aktif per superadmin -> index unik parsial
 *   sesi tidak dapat diperpanjang  -> expires_at tidak punya grant UPDATE
 *   sesi yang berakhir tidak dapat dihidupkan -> policy UPDATE satu arah
 *
 * Pembagian itu disengaja: pesan yang dapat dibaca datang dari aplikasi, penjaganya
 * dari database. Kalau keduanya berbeda pendapat, database yang menang - dan tes
 * mutasi slice ini menghapus pemeriksaan aplikasi satu per satu untuk membuktikan
 * penjaganya masih ada.
 */

export interface SupportActor {
  userId: string;
  sessionId: string;
  /** Permission platform efektif; diisi AccessGuard, tidak dihitung ulang. */
  permissions: ReadonlySet<string>;
}

export interface StartInput {
  tenantId: string;
  reasonCode: string;
  reasonText: string;
  scope: string;
  durationMinutes: number;
  ticketReference: string | null;
}

export interface SupportSessionRow {
  id: string;
  tenant_id: string;
  superadmin_user_id: string;
  scope: SupportScope;
  reason_code: string;
  ticket_reference: string | null;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
  status: string;
  /** Hanya pada baris yang baru dibuat: sisa umur menurut DATABASE, dalam detik. */
  remaining_seconds?: number;
}

/**
 * Status tenant yang boleh dibuka support session (ADR-003 sec.2.2 butir 10).
 * Allowlist, bukan daftar larangan: status baru (CLOSING, PURGED) akan DITOLAK
 * sampai seseorang memutuskan dan menuliskannya di sini. Demo baseline belum
 * memiliki kedua status itu di CHECK tabel tenants, jadi "PURGED ditolak" benar
 * karena tidak ada di daftar ini - bukan karena ada cabang khusus untuknya.
 */
const TENANT_STATUS_ALLOWED: ReadonlySet<string> = new Set([
  'ACTIVE',
  'PROVISIONING',
  'SUSPENDED',
  'ARCHIVED',
]);

const REASON_MIN = 10;
const REASON_MAX = 500;

@Injectable()
export class SupportService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly lifecycle: SupportLifecycleService,
  ) {}

  async start(actor: SupportActor, input: StartInput) {
    const reasonCode = this.assertReasonCode(input.reasonCode);
    const reasonText = this.assertReasonText(input.reasonText);
    const ticket = this.assertTicket(input.ticketReference);
    const durasi = this.assertDuration(input.durationMinutes);
    const diminta = this.assertScope(input.scope);

    // Sesi yang sudah lewat waktu ditutup lebih dulu, supaya "sudah ada sesi
    // aktif" hanya terdengar saat memang benar.
    await this.lifecycle.sweepExpired(actor.sessionId);

    const tenant = await this.readTenant(input.tenantId);

    // Butir 10: tenant yang tidak ACTIVE tetap boleh disokong - kebutuhan support
    // justru sering muncul saat tenant disuspend - tetapi HANYA membaca. Scope
    // diturunkan, bukan ditolak, dan penurunannya dikembalikan ke pemanggil supaya
    // layar tidak menjanjikan hak yang tidak ada.
    const dipaksaReadOnly = tenant.status !== 'ACTIVE';
    const scope: SupportScope = dipaksaReadOnly ? 'READ_ONLY' : diminta;

    if (scope === 'READ_WRITE') {
      // Dua syarat terpisah, keduanya wajib (butir 1): permission tersendiri DAN
      // alasan yang mengizinkan perubahan.
      if (!actor.permissions.has('platform.support.start_write')) {
        throw new ForbiddenException('Anda tidak berhak membuka sesi support READ_WRITE.');
      }
      if (!WRITE_REASON_CODES.has(reasonCode)) {
        throw new BadRequestException(
          'Scope READ_WRITE hanya untuk alasan DATA_CORRECTION_REQUESTED_BY_TENANT.',
        );
      }
    }

    // id dibuat di sini karena ia masuk ke AAD ciphertext (scope|tabel|kolom|id).
    // Ciphertext karena itu terikat pada BARIS ini: dipindahkan ke baris lain, ia
    // tidak dapat dibuka.
    const id = randomUUID();
    const sealed = await this.crypto.encrypt(FIELDS.supportReason, PLATFORM, id, reasonText);

    const row = await this.uow.withPlatform(async (tx) => {
      try {
        const [created] = await tx.query<SupportSessionRow>(
          `INSERT INTO support_sessions
             (id, tenant_id, superadmin_user_id, platform_session_id, scope,
              reason_code, reason_text_ciphertext, reason_text_key_version, ticket_reference,
              expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(mins => $10::int))
           RETURNING id, tenant_id, superadmin_user_id, scope, reason_code,
                     ticket_reference, started_at, expires_at, ended_at, end_reason, status,
                     greatest(1, extract(epoch FROM (expires_at - now()))::int) AS remaining_seconds`,
          [
            id,
            input.tenantId,
            actor.userId,
            actor.sessionId,
            scope,
            reasonCode,
            sealed.ciphertext,
            sealed.keyVersion,
            ticket,
            durasi,
          ],
        );
        return created;
      } catch (error) {
        // Index unik parsial: satu sesi aktif per superadmin (butir 6).
        if (sqlState(error) === '23505') {
          throw new ConflictException(
            'Anda masih memiliki sesi support yang aktif. Akhiri sesi itu lebih dulu.',
          );
        }
        throw error;
      }
    });

    await this.lifecycle.auditBoth('support.session.started', row, actor.userId, actor.sessionId, {
      scope: row.scope,
      reasonCode: row.reason_code,
      // Kunci bernama 'ticket' DITOLAK F-14 (daftar kunci terlarang audit), jadi
      // namanya 'ticketReference'. Bukan penyelundupan: yang dilarang F-14 adalah
      // token tiket pemilihan context, bukan nomor tiket dukungan - tetapi
      // pemeriksanya hanya melihat nama kunci, dan nama yang lebih jelas lebih baik
      // daripada berdebat dengannya.
      ticketReference: row.ticket_reference,
      expiresAt: row.expires_at,
      forcedReadOnly: dipaksaReadOnly,
    });
    await this.lifecycle.notify(row.tenant_id, 'SUPPORT_SESSION_STARTED', row.id);

    // Umur token = sisa umur sesi MENURUT DATABASE (detik), bukan hasil
    // pengurangan dua tanggal di aplikasi. Lihat komentar di migrasi 0020 dan di
    // unit of work: satu mesin target sudah pernah membuktikan bahwa menafsirkan
    // teks waktu adalah tempat yang salah untuk menaruh kepercayaan.
    const token = this.tokens.issueSupport({
      superadminUserId: actor.userId,
      platformSessionId: actor.sessionId,
      tenantId: row.tenant_id,
      supportSessionId: row.id,
      scope: row.scope,
      ttlSeconds: row.remaining_seconds ?? 60,
    });

    return {
      session: this.view(row),
      forcedReadOnly: dipaksaReadOnly,
      supportToken: token.accessToken,
      expiresIn: token.expiresIn,
    };
  }

  /**
   * Daftar sesi. Milik sendiri lebih dulu, lalu riwayat platform: superadmin
   * melihat sesi superadmin lain juga, dan itu disengaja (ADR-003 sec.2.5 -
   * review daftar berkala hanya mungkin bila daftarnya terlihat).
   *
   * reason_text TIDAK dikembalikan di daftar. Alasan bebas dapat menyebut orang,
   * dan daftar adalah tempat yang paling mudah bocor ke layar, log, atau tangkapan
   * layar. Membukanya per sesi adalah aksi tersendiri (belum ada di baseline; D-37).
   */
  async list(actor: SupportActor): Promise<{ sessions: ReturnType<SupportService['view']>[] }> {
    await this.lifecycle.sweepExpired(actor.sessionId);

    const rows = await this.uow.withPlatform((tx) =>
      tx.query<SupportSessionRow>(
        `SELECT id, tenant_id, superadmin_user_id, scope, reason_code, ticket_reference,
                started_at, expires_at, ended_at, end_reason, status
         FROM support_sessions
         ORDER BY (status = 'ACTIVE') DESC, started_at DESC
         LIMIT 50`,
      ),
    );
    return { sessions: rows.map((r) => this.view(r)) };
  }

  /**
   * Daftar sesi support MILIK SEBUAH TENANT, dibaca dari context tenant itu
   * sendiri (ADR-003 sec.2.4: "context tenant: tenant owner/auditor dengan
   * audit.read membaca baris tenant_id = current").
   *
   * Ini sisi transparansi yang tidak boleh hanya berupa notifikasi: notifikasi
   * memberi tahu bahwa sesuatu terjadi, daftar ini memberi tahu APA - scope,
   * alasan, kapan mulai, kapan berakhir. Teks alasan tidak termasuk: kuncinya
   * milik platform (lihat migrasi 0020), jadi yang tenant lihat adalah kode alasan.
   *
   * Dipanggil dari context tenant DAN - tanpa cabang tambahan - dari context
   * support, tempat policy hanya memperlihatkan baris sesi yang sedang berjalan.
   * Sesi support karena itu melihat dirinya sendiri di sini dan tidak lebih, dan
   * itulah yang membuktikan GUC sesi memang ditulis: kalau tidak, ia akan melihat
   * seluruh riwayat tenant.
   */
  async listForTenant(tenantId: string) {
    const rows = await this.uow.withTenant(tenantId, (tx) =>
      tx.query<SupportSessionRow>(
        `SELECT id, tenant_id, superadmin_user_id, scope, reason_code, ticket_reference,
                started_at, expires_at, ended_at, end_reason, status
         FROM support_sessions
         ORDER BY (status = 'ACTIVE') DESC, started_at DESC
         LIMIT 50`,
      ),
    );
    return { sessions: rows.map((r) => this.view(r)) };
  }

  /**
   * Mengakhiri sesi. Sesi sendiri = MANUAL; sesi superadmin lain = REVOKED, dengan
   * nama event audit sendiri. Perbedaan itu bukan kosmetik: "saya selesai" dan
   * "saya menghentikan orang lain" adalah dua kejadian yang harus dapat dicari
   * terpisah saat menelusuri penyalahgunaan.
   */
  async end(actor: SupportActor, id: string) {
    const row = await this.uow.withPlatform(async (tx) => {
      const [target] = await tx.query<{ id: string; tenant_id: string; superadmin_user_id: string; status: string }>(
        `SELECT id, tenant_id, superadmin_user_id, status FROM support_sessions WHERE id = $1`,
        [id],
      );
      if (!target) throw new NotFoundException('Sesi support tidak ditemukan.');
      if (target.status !== 'ACTIVE') {
        throw new ConflictException('Sesi support itu sudah berakhir.');
      }

      const sendiri = target.superadmin_user_id === actor.userId;
      const jumlah = await this.lifecycle.closeInPlatformTx(
        tx,
        id,
        sendiri ? 'MANUAL' : 'REVOKED',
        actor.userId,
      );
      if (jumlah !== 1) throw new ConflictException('Sesi support itu sudah berakhir.');
      return { ...target, sendiri };
    });

    await this.lifecycle.auditBoth(
      row.sendiri ? 'support.session.ended' : 'support.session.revoked',
      row,
      actor.userId,
      actor.sessionId,
      { endReason: row.sendiri ? 'MANUAL' : 'REVOKED', subjectUserId: row.superadmin_user_id },
    );
    await this.lifecycle.notify(row.tenant_id, 'SUPPORT_SESSION_ENDED', row.id);

    return { status: row.sendiri ? 'ENDED' : 'REVOKED' };
  }

  // ------------------------------------------------------------------ bantu

  private view(row: SupportSessionRow) {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      superadmin_user_id: row.superadmin_user_id,
      scope: row.scope,
      reason_code: row.reason_code,
      ticket_reference: row.ticket_reference,
      started_at: row.started_at,
      expires_at: row.expires_at,
      ended_at: row.ended_at,
      end_reason: row.end_reason,
      status: row.status,
    };
  }

  /**
   * Status tenant dibaca di context platform. Policy platform pada tabel tenants
   * ditambahkan migrasi 0020: tenants adalah tabel CONTROL-PLANE (Demo Foundation
   * sec.7.2), bukan data tenant - membacanya bukan pelanggaran ADR-003 sec.2.1,
   * dan tanpanya aturan "tenant tidak ACTIVE hanya READ_ONLY" tidak dapat ditegakkan
   * sama sekali.
   */
  private async readTenant(tenantId: string): Promise<{ id: string; status: string }> {
    const [tenant] = await this.uow.withPlatform((tx) =>
      tx.query<{ id: string; status: string }>('SELECT id, status FROM tenants WHERE id = $1', [
        tenantId,
      ]),
    );
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan.');
    if (!TENANT_STATUS_ALLOWED.has(tenant.status)) {
      throw new ForbiddenException('Tenant dengan status itu tidak dapat dibuka sesi support.');
    }
    return tenant;
  }

  private assertReasonCode(value: string): ReasonCode {
    if (!REASON_CODES.includes(value as ReasonCode)) {
      throw new BadRequestException(`reasonCode harus salah satu dari: ${REASON_CODES.join(', ')}.`);
    }
    return value as ReasonCode;
  }

  /**
   * Alasan bebas WAJIB dan tidak boleh sekadar formalitas: sepuluh karakter adalah
   * batas yang rendah, tetapi cukup untuk menolak "." dan "asdf". Yang membuat
   * break-glass dapat dipertanggungjawabkan adalah alasannya, bukan keberadaan
   * kolomnya.
   *
   * Isinya TIDAK disaring dari data pribadi (berbeda dari reason pada admin
   * platform): kolom ini dienkripsi justru karena alasan sungguhan dapat menyebut
   * orang ("akun Budi tidak dapat masuk"). Menolak email di sini akan memaksa
   * penulisnya menyamarkan kasusnya, dan alasan yang disamarkan tidak berguna saat
   * ditelusuri.
   */
  private assertReasonText(value: string): string {
    const teks = (value ?? '').trim();
    if (teks.length < REASON_MIN) {
      throw new BadRequestException(`Alasan minimal ${REASON_MIN} karakter dan harus bermakna.`);
    }
    if (teks.length > REASON_MAX) {
      throw new BadRequestException(`Alasan maksimal ${REASON_MAX} karakter.`);
    }
    return teks;
  }

  /** Nomor tiket TIDAK dienkripsi, jadi pelajaran D-26 berlaku: bukan tempat email. */
  private assertTicket(value: string | null): string | null {
    if (value === null) return null;
    const teks = value.trim();
    if (teks.length === 0) return null;
    if (teks.length > 64) throw new BadRequestException('ticketReference maksimal 64 karakter.');
    if (teks.includes('@')) {
      throw new BadRequestException('ticketReference bukan tempat alamat email.');
    }
    return teks;
  }

  private assertDuration(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > MAX_DURATION_MINUTES) {
      throw new BadRequestException(
        `durationMinutes harus bilangan bulat 1..${MAX_DURATION_MINUTES}.`,
      );
    }
    return value;
  }

  private assertScope(value: string): SupportScope {
    if (value !== 'READ_ONLY' && value !== 'READ_WRITE') {
      throw new BadRequestException('scope harus READ_ONLY atau READ_WRITE.');
    }
    return value;
  }
}
