import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/**
 * Rate limiting login, DUA lapis.
 *
 * 1. Per identifier (email) - berbasis audit, bukan penghitung di memori.
 *    Penghitung di memori hilang saat proses dimulai ulang, dan "restart untuk
 *    membuka kunci" bukan sifat yang diinginkan dari rate limit. Karena audit
 *    sudah mencatat setiap kegagalan, penghitungnya diambil dari sana. Biayanya
 *    satu query per percobaan login; itu sebabnya ada index parsial khusus di
 *    0008 yang hanya memuat baris FAILURE.
 *
 * 2. Per IP klien - DI MEMORI, dan itu pengecualian yang disengaja terhadap
 *    alasan di atas. Lapis pertama tidak memperlambat password spraying: satu
 *    password dicoba ke banyak email, dan setiap email hanya mendapat satu
 *    kegagalan. Menyimpan penghitung per IP di database menuntut kolom baru di
 *    audit_logs dan perubahan fungsi auth.* terdaftar (Lampiran A) - keputusan
 *    normatif yang belum diambil. Sampai itu, batasnya dikatakan apa adanya:
 *    hilang saat restart dan TIDAK dibagi antar-instance (DEFERRED.md D-51).
 *    IP tidak pernah disimpan maupun diaudit; ia hanya kunci Map ini.
 */
const WINDOW_SECONDS = Number(process.env.DEMO_LOGIN_WINDOW_SECONDS ?? 300);
const MAX_FAILURES = Number(process.env.DEMO_LOGIN_MAX_FAILURES ?? 5);

/** Dibaca per panggilan supaya tes dapat mengubahnya tanpa memuat ulang modul. */
const ipMaxFailures = () => Number(process.env.DEMO_LOGIN_IP_MAX_FAILURES ?? 30);

/**
 * Batas jumlah IP yang dilacak. Tanpa batas, penyerang yang memutar alamat
 * (IPv6 memberi banyak sekali) mengubah pelindung ini menjadi kebocoran memori.
 * Saat penuh, IP yang paling lama tidak gagal dibuang lebih dulu.
 */
const MAX_TRACKED_IPS = 10_000;

const TERLALU_BANYAK = 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.';

@Injectable()
export class RateLimitService {
  /** IP -> waktu kegagalan (ms), terurut naik. Urutan Map = urutan kegagalan terakhir. */
  private readonly failuresByIp = new Map<string, number[]>();

  constructor(private readonly audit: AuditService) {}

  /**
   * Dipanggil SEBELUM verifikasi password.
   *
   * Pesannya sengaja tidak menyebut apakah akunnya ada, maupun lapis mana yang
   * menolak. Memberi tahu "akun ini terkunci" akan membocorkan keberadaan akun -
   * persis yang dijaga respons generik di jalur login.
   */
  async assertAllowed(identifier: string, clientIp?: string | null): Promise<void> {
    if (clientIp) {
      const ipFailures = this.recentIpFailures(clientIp);
      if (ipFailures >= ipMaxFailures()) {
        await this.audit.record({
          eventType: 'auth.login.throttled',
          outcome: 'FAILURE',
          identifier,
          detail: { scope: 'CLIENT_IP', failures: ipFailures, windowSeconds: WINDOW_SECONDS },
        });
        throw new HttpException(TERLALU_BANYAK, HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const failures = await this.audit.countRecentFailures(identifier, WINDOW_SECONDS);
    if (failures < MAX_FAILURES) return;

    await this.audit.record({
      eventType: 'auth.login.throttled',
      outcome: 'FAILURE',
      identifier,
      detail: { failures, windowSeconds: WINDOW_SECONDS },
    });

    throw new HttpException(TERLALU_BANYAK, HttpStatus.TOO_MANY_REQUESTS);
  }

  /**
   * Dipanggil di setiap jalur kegagalan kredensial - di tempat yang sama dengan
   * audit FAILURE yang menjadi penghitung lapis pertama.
   */
  recordFailure(clientIp?: string | null): void {
    if (!clientIp) return;
    const now = Date.now();
    const list = this.prune(this.failuresByIp.get(clientIp) ?? [], now);
    list.push(now);
    // Hapus lalu set ulang: IP ini pindah ke ujung urutan Map (paling baru).
    this.failuresByIp.delete(clientIp);
    this.failuresByIp.set(clientIp, list);
    while (this.failuresByIp.size > MAX_TRACKED_IPS) {
      const oldest = this.failuresByIp.keys().next().value;
      if (oldest === undefined) break;
      this.failuresByIp.delete(oldest);
    }
  }

  private recentIpFailures(clientIp: string): number {
    const list = this.failuresByIp.get(clientIp);
    if (!list) return 0;
    const kept = this.prune(list, Date.now());
    if (kept.length === 0) this.failuresByIp.delete(clientIp);
    else this.failuresByIp.set(clientIp, kept);
    return kept.length;
  }

  private prune(list: number[], now: number): number[] {
    const from = now - WINDOW_SECONDS * 1000;
    let i = 0;
    while (i < list.length && list[i] <= from) i++;
    return i === 0 ? list : list.slice(i);
  }
}
