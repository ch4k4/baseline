import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt (RFC 7914) dari node:crypto — adaptive hash tanpa dependensi native.
 * Dipilih untuk fase lokal supaya tidak ada langkah kompilasi yang bisa gagal
 * dan menyamarkan bug lain. Keputusan argon2id untuk produksi dicatat di
 * app/DEFERRED.md dan harus ditinjau Security sebelum data nyata.
 *
 * Format simpan: scrypt$N$r$p$<salt-base64>$<hash-base64>
 */
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

@Injectable()
export class PasswordService {
  /** Hash palsu berbiaya sama, dipakai saat identitas tidak ditemukan. */
  private dummyHash: string | null = null;

  async hash(plain: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scryptAsync(plain, salt, KEYLEN, PARAMS);
    return [
      'scrypt',
      PARAMS.N,
      PARAMS.r,
      PARAMS.p,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, n, r, p, saltB64, hashB64] = parts;
    let expected: Buffer;
    try {
      expected = Buffer.from(hashB64, 'base64');
      const derived = await scryptAsync(plain, Buffer.from(saltB64, 'base64'), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: PARAMS.maxmem,
      });
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  /**
   * Constant-work path: dipanggil saat email tidak ditemukan supaya waktu respons
   * tidak membocorkan keberadaan akun. Tanpa ini, "email tidak terdaftar" dapat
   * dibedakan dari "password salah" hanya dengan stopwatch.
   */
  async burnEquivalentWork(plain: string): Promise<void> {
    this.dummyHash ??= await this.hash('constant-work-placeholder');
    await this.verify(plain, this.dummyHash);
  }
}
