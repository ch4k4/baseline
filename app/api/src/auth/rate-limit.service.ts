import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/**
 * Rate limiting login berbasis audit, bukan penghitung di memori.
 *
 * Penghitung di memori hilang saat proses dimulai ulang, dan "restart untuk
 * membuka kunci" bukan sifat yang diinginkan dari rate limit. Karena audit
 * sudah mencatat setiap kegagalan, penghitungnya diambil dari sana.
 *
 * Biayanya satu query per percobaan login. Itu sebabnya ada index parsial
 * khusus di 0008 yang hanya memuat baris FAILURE.
 */
const WINDOW_SECONDS = Number(process.env.DEMO_LOGIN_WINDOW_SECONDS ?? 300);
const MAX_FAILURES = Number(process.env.DEMO_LOGIN_MAX_FAILURES ?? 5);

@Injectable()
export class RateLimitService {
  constructor(private readonly audit: AuditService) {}

  /**
   * Dipanggil SEBELUM verifikasi password.
   *
   * Pesannya sengaja tidak menyebut apakah akunnya ada. Memberi tahu "akun ini
   * terkunci" akan membocorkan keberadaan akun - persis yang dijaga respons
   * generik di jalur login.
   */
  async assertAllowed(identifier: string): Promise<void> {
    const failures = await this.audit.countRecentFailures(identifier, WINDOW_SECONDS);
    if (failures < MAX_FAILURES) return;

    await this.audit.record({
      eventType: 'auth.login.throttled',
      outcome: 'FAILURE',
      identifier,
      detail: { failures, windowSeconds: WINDOW_SECONDS },
    });

    throw new HttpException(
      'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
