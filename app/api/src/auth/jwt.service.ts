import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

/**
 * JWT HS256, ditulis langsung di atas node:crypto.
 *
 * Kenapa tanpa pustaka: yang dibutuhkan hanya HMAC-SHA256 dan base64url, dua
 * hal yang sudah ada di Node. Menambah dependensi untuk empat puluh baris kode
 * berarti menambah rantai pasok yang harus diaudit dan diperbarui, demi
 * menghindari kode yang justru lebih mudah dibaca daripada dokumentasinya.
 *
 * Yang TIDAK dilakukan di sini, dan itu disengaja:
 *   - tidak menerima algoritma dari header token (celah "alg: none" dan
 *     kebingungan HS256/RS256). Algoritmanya ditetapkan kode, bukan token.
 *   - tidak mempercayai klaim sebagai bukti session masih hidup. Tanda tangan
 *     membuktikan token tidak diubah, bukan bahwa session belum dicabut.
 *     Pemeriksaan pencabutan tetap ke database - lihat catatan di session.guard.ts.
 */

export interface AccessClaims {
  sub: string; // user_id
  sid: string; // session_id
  tid: string | null; // tenant_id
  ctx: 'TENANT' | 'PLATFORM' | 'SUPPORT';
  mid: string | null; // membership_id
  /**
   * Hanya pada ctx SUPPORT (DEMO-0312): id baris support_sessions dan scope sesi.
   *
   * Keduanya TIDAK dipercaya sebagai bukti apa pun. Token support memakai `sid`
   * session PLATFORM yang membukanya, dan setiap request memeriksa ulang baris
   * support_sessions lewat F-18 (ADR-003 sec.2.3): klaim hanya menunjuk baris mana
   * yang harus dibaca, bukan menyatakan sesi itu masih hidup atau scopenya apa.
   */
  ssid?: string;
  scp?: 'READ_ONLY' | 'READ_WRITE';
  iat: number;
  exp: number;
  jti: string;
}

const ALG = { alg: 'HS256', typ: 'JWT' } as const;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

@Injectable()
export class JwtService {
  private readonly secret: Buffer;
  readonly ttlSeconds: number;

  constructor() {
    const raw = process.env.DEMO_JWT_SECRET;

    if (!raw && process.env.NODE_ENV === 'production') {
      // Gagal saat start, bukan saat token pertama diterbitkan. Rahasia acak
      // yang dibuat otomatis di produksi berarti setiap restart mencabut semua
      // sesi dan setiap instance menolak token instance lain.
      throw new Error('DEMO_JWT_SECRET wajib diisi di produksi.');
    }

    this.secret = Buffer.from(raw ?? 'kunci-pengembangan-lokal-jangan-dipakai-di-produksi', 'utf8');
    this.ttlSeconds = Number(process.env.DEMO_ACCESS_TTL_SECONDS ?? 900);
  }

  /**
   * ttlOverride dipakai token support (DEMO-0312): umurnya adalah sisa umur
   * support session, karena token itu TIDAK dapat diperpanjang (tidak ada refresh
   * token untuknya - ADR-003 sec.2.6 butir 2). Umur access token biasa 15 menit
   * tidak cocok di sini: sesi 60 menit akan mati di tengah jalan tanpa cara
   * memperbaruinya, dan superadmin akan membuka sesi baru berulang kali - yang
   * justru memperbanyak sesi break-glass. Sisi lain dari pilihan ini dicatat apa
   * adanya: token support tidak lagi berumur pendek, jadi yang mencabutnya adalah
   * pemeriksaan baris sesi pada setiap request, bukan kedaluwarsa tokennya.
   */
  sign(payload: Omit<AccessClaims, 'iat' | 'exp' | 'jti'>, ttlOverride?: number): string {
    const iat = Math.floor(Date.now() / 1000);
    const claims: AccessClaims = {
      ...payload,
      iat,
      exp: iat + (ttlOverride ?? this.ttlSeconds),
      jti: randomUUID(),
    };

    const head = b64url(JSON.stringify(ALG));
    const body = b64url(JSON.stringify(claims));
    return `${head}.${body}.${this.signature(`${head}.${body}`)}`;
  }

  /** Mengembalikan klaim bila tanda tangan sah dan belum kedaluwarsa; selain itu null. */
  verify(token: string): AccessClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [head, body, sig] = parts;

    // Header diperiksa terhadap nilai yang KITA tetapkan. Token tidak pernah
    // boleh memilih algoritmanya sendiri.
    let header: unknown;
    try {
      header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    const h = header as Record<string, unknown>;
    if (h?.alg !== ALG.alg || h?.typ !== ALG.typ) return null;

    const expected = Buffer.from(this.signature(`${head}.${body}`), 'utf8');
    const actual = Buffer.from(sig, 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    let claims: AccessClaims;
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessClaims;
    } catch {
      return null;
    }

    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!claims.sub || !claims.sid) return null;

    return claims;
  }

  private signature(data: string): string {
    return createHmac('sha256', this.secret).update(data).digest('base64url');
  }
}
