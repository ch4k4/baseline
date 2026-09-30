import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Primitif kriptografi field-level. Satu-satunya berkas yang memanggil cipher.
 *
 * Tidak ada kriptografi buatan sendiri di sini (SSOT sec.8.1): AES-256-GCM dan
 * HMAC-SHA-256 berasal dari node:crypto (OpenSSL). Yang ditulis di sini hanyalah
 * FORMAT penyimpanan dan aturan AAD - dan justru dua hal itu yang paling sering
 * salah, karena cipher-nya sendiri jarang yang keliru.
 *
 * Format envelope (BYTEA):
 *   [0]      versi format = 0x01
 *   [1..12]  nonce 96-bit, acak per operasi
 *   [13..-17] ciphertext
 *   [-16..]  tag GCM 128-bit
 *
 * Versi KUNCI tidak ada di dalam envelope, melainkan di kolom *_key_version di
 * sebelahnya: kolom itu dapat di-query untuk rotasi ("baris mana yang masih
 * memakai kunci v1") tanpa membuka satu pun ciphertext.
 */

export const FORMAT_V1 = 0x01;
const NONCE = 12;
const TAG = 16;

export class DecryptionError extends Error {
  // Pesan sengaja tidak memuat ciphertext, AAD, atau apa pun yang berasal dari
  // data. Error ini akan sampai ke log; log bukan tempat data pribadi.
  constructor(reason: string) {
    super(`dekripsi ditolak: ${reason}`);
    this.name = 'DecryptionError';
  }
}

/**
 * AAD mengikat ciphertext ke tempatnya. Ciphertext email milik user A yang
 * disalin ke baris user B gagal dibuka, begitu pula yang disalin ke kolom lain
 * atau ke tenant lain. Tanpa AAD, enkripsi hanya melindungi dari pembaca -
 * bukan dari orang yang memindah-mindahkan ciphertext.
 */
export interface AadParts {
  scope: string; // 'platform' atau tenant_id (SSOT sec.8.1, sec.9.1)
  table: string;
  field: string;
  recordId: string;
  schemaVersion?: number;
}

export function aadString(a: AadParts): string {
  for (const part of [a.scope, a.table, a.field, a.recordId]) {
    // Pemisah '|' tidak boleh muncul di bagian mana pun; kalau boleh, dua
    // kombinasi berbeda dapat menghasilkan string AAD yang sama.
    if (!part || part.includes('|')) throw new Error('bagian AAD tidak sah');
  }
  return `${a.scope}|${a.table}|${a.field}|${a.recordId}|v${a.schemaVersion ?? 1}`;
}

export function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  if (key.length !== 32) throw new Error('kunci harus 32 byte');
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_V1]), nonce, body, cipher.getAuthTag()]);
}

export function open(key: Buffer, envelope: Buffer, aad: string): Buffer {
  if (key.length !== 32) throw new Error('kunci harus 32 byte');
  if (envelope.length < 1 + NONCE + TAG) throw new DecryptionError('envelope terlalu pendek');
  if (envelope[0] !== FORMAT_V1) throw new DecryptionError('versi format tidak dikenal');

  const nonce = envelope.subarray(1, 1 + NONCE);
  const tag = envelope.subarray(envelope.length - TAG);
  const body = envelope.subarray(1 + NONCE, envelope.length - TAG);

  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // Kunci salah, AAD salah, dan ciphertext diubah menghasilkan kegagalan yang
    // SAMA. Itu bukan kekurangan: membedakannya memberi penyerang oracle.
    throw new DecryptionError('autentikasi gagal');
  }
}

/**
 * Blind index: HMAC-SHA-256 berkunci atas nilai yang sudah dinormalisasi.
 *
 * `domain` memisahkan penggunaan. Email yang sama menghasilkan blind index
 * berbeda untuk users.email dan tenant_member_profiles.contact_email walau
 * kuncinya (secara hipotetis) sama - jadi dua kolom tidak dapat di-join.
 */
export function blindIndex(key: Buffer, domain: string, normalized: string): Buffer {
  if (key.length !== 32) throw new Error('kunci harus 32 byte');
  return createHmac('sha256', key).update(`${domain}\u0000${normalized}`, 'utf8').digest();
}

// ---------------------------------------------------------------- DEK <-> KEK
// DEK dibungkus dengan skema envelope yang sama, dengan AAD yang mengikatnya ke
// scope, purpose, dan versinya. DEK tenant A yang disalin ke baris tenant B
// tidak dapat dibuka - membungkus bukan hanya menyembunyikan, tapi juga mengikat.

export function dekAad(scope: string, purpose: string, version: number): string {
  return `dek|${scope}|${purpose}|v${version}`;
}

export function wrapDek(kek: Buffer, dek: Buffer, scope: string, purpose: string, version: number): Buffer {
  if (dek.length !== 32) throw new Error('DEK harus 32 byte');
  return seal(kek, dek, dekAad(scope, purpose, version));
}

export function unwrapDek(kek: Buffer, wrapped: Buffer, scope: string, purpose: string, version: number): Buffer {
  const dek = open(kek, wrapped, dekAad(scope, purpose, version));
  if (dek.length !== 32) throw new DecryptionError('DEK berukuran salah');
  return dek;
}

export function newDek(): Buffer {
  return randomBytes(32);
}
