import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Tiket pemilihan context.
 *
 * Yang dikirim ke klien adalah token acak; yang disimpan database adalah
 * hash-nya. Konsekuensinya: isi tabel tiket yang bocor tidak dapat dipakai
 * masuk, karena hash tidak bisa dikembalikan menjadi token.
 *
 * SHA-256 tanpa salt sudah memadai DI SINI, dan hanya di sini: masukannya 32
 * byte acak dari CSPRNG, bukan password yang bisa ditebak. Untuk password,
 * pemilihan itu akan salah - lihat PasswordService yang memakai scrypt.
 */
@Injectable()
export class TicketService {
  /** Token mentah untuk klien, aman dipakai di URL dan form. */
  issue(): { token: string; hash: Buffer } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): Buffer {
    return createHash('sha256').update(token, 'utf8').digest();
  }

  /** Perbandingan waktu-tetap; dipakai bila nanti ada pencocokan hash di aplikasi. */
  matches(a: Buffer, b: Buffer): boolean {
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
