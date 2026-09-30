import { DecryptionError, newDek, unwrapDek, wrapDek } from './envelope.js';

/**
 * Cincin kunci: dari DEK terbungkus di database menjadi DEK siap pakai di memori.
 *
 * Kelas ini tidak tahu cara mengambil baris dari database - itu tugas loader
 * yang disuntikkan. Seed memakai loader superuser; API memakai loader lewat
 * fungsi definer (auth.get_active_key). Logika pembukaan dan cache-nya SAMA,
 * sehingga seed dan API tidak mungkin berbeda pendapat tentang arti sebuah kunci.
 */

export const PLATFORM = 'platform';

export type Purpose =
  | 'platform_identity'
  | 'platform_identity_blind_index'
  | 'platform_audit_identifier'
  | 'platform_support_reason'
  | 'identity'
  | 'identity_blind_index';

export const PLATFORM_PURPOSES: readonly Purpose[] = [
  'platform_identity',
  'platform_identity_blind_index',
  'platform_audit_identifier',
  // DEMO-0312: alasan support session. Kunci PLATFORM, bukan tenant - penulisnya
  // berjalan di context platform, dan kunci tenant hanya diserahkan di dalam
  // context tenant pemiliknya (slice 8). Lihat komentar di migrasi 0020.
  'platform_support_reason',
];
export const TENANT_PURPOSES: readonly Purpose[] = ['identity', 'identity_blind_index'];

export interface WrappedKeyRow {
  key_version: number;
  wrapped_dek: Buffer;
}

export interface WrappedKeyLoader {
  active(purpose: Purpose, tenantId: string | null): Promise<WrappedKeyRow | null>;
  version(purpose: Purpose, tenantId: string | null, version: number): Promise<WrappedKeyRow | null>;
}

export class KeyMissingError extends Error {
  constructor(purpose: string, scope: string, version?: number) {
    // scope boleh disebut: tenant_id adalah UUID opak, bukan data pribadi.
    super(
      `kunci ${purpose} untuk ${scope}${version ? ` v${version}` : ''} tidak tersedia. ` +
        'Seed belum dijalankan untuk scope ini, atau context tenant tidak cocok.',
    );
    this.name = 'KeyMissingError';
  }
}

export class KekMismatchError extends Error {
  constructor() {
    super(
      [
        'KEK di mesin ini tidak dapat membuka kunci di database.',
        '',
        'Biasanya karena berkas KEK dibuat ulang setelah database di-seed, atau',
        'database berasal dari mesin lain. Data demo tidak dapat dipulihkan tanpa',
        'KEK aslinya; bangun ulang:',
        '  cd ..\\db\\scripts',
        '  .\\db.ps1 reset',
      ].join('\n'),
    );
    this.name = 'KekMismatchError';
  }
}

function assertScope(purpose: Purpose, scope: string): void {
  const platform = PLATFORM_PURPOSES.includes(purpose);
  if (platform !== (scope === PLATFORM)) {
    // Kesalahan pemrograman, bukan kondisi data: kunci platform diminta untuk
    // tenant atau sebaliknya. Dihentikan di sini sebelum sampai ke database.
    throw new Error(`purpose ${purpose} tidak berlaku untuk scope ${scope === PLATFORM ? 'platform' : 'tenant'}`);
  }
}

export class KeyRing {
  private readonly keys = new Map<string, Buffer>();
  private readonly activeVersion = new Map<string, number>();

  constructor(
    private readonly kek: Buffer,
    private readonly loader: WrappedKeyLoader,
  ) {}

  private unwrap(row: WrappedKeyRow, purpose: Purpose, scope: string): Buffer {
    try {
      return unwrapDek(this.kek, row.wrapped_dek, scope, purpose, row.key_version);
    } catch (error) {
      if (error instanceof DecryptionError) throw new KekMismatchError();
      throw error;
    }
  }

  /** Kunci aktif untuk MENULIS. */
  async active(purpose: Purpose, scope: string): Promise<{ version: number; key: Buffer }> {
    assertScope(purpose, scope);
    const slot = `${scope}|${purpose}`;
    const known = this.activeVersion.get(slot);
    if (known !== undefined) return { version: known, key: this.keys.get(`${slot}|${known}`)! };

    const row = await this.loader.active(purpose, scope === PLATFORM ? null : scope);
    if (!row) throw new KeyMissingError(purpose, scope);
    const key = this.unwrap(row, purpose, scope);

    // Cache tanpa kedaluwarsa: rotasi kunci menuntut restart proses. Diterima
    // untuk demo; TTL cache kunci adalah keputusan terbuka SSOT sec.20.
    this.keys.set(`${slot}|${row.key_version}`, key);
    this.activeVersion.set(slot, row.key_version);
    return { version: row.key_version, key };
  }

  /**
   * DEK BARU untuk tenant yang sedang dibuat (D-17): yang mentah untuk dipakai
   * seketika, yang terbungkus untuk disimpan lewat fungsi terdaftar F-26.
   *
   * KEK hanya ada di kelas ini, jadi pencetakannya juga. Purpose platform ditolak di
   * DUA tempat - di sini dan di F-26 - karena kunci platform tidak boleh lahir dari
   * jalur tenant.
   *
   * TIDAK di-cache: kunci yang gagal tersimpan tidak boleh pernah terlihat seperti
   * kunci yang ada. Sesudah provisioning, pembacanya adalah `active`/`byVersion`
   * seperti kunci lain.
   */
  mintDek(purpose: Purpose, scope: string): { version: number; dek: Buffer; wrapped: Buffer } {
    assertScope(purpose, scope);
    if (scope === PLATFORM || purpose.startsWith('platform_')) {
      throw new Error(`mintDek menolak purpose platform: ${purpose}`);
    }
    const version = 1;
    const dek = newDek();
    return { version, dek, wrapped: wrapDek(this.kek, dek, scope, purpose, version) };
  }

  /** Kunci versi tertentu untuk MEMBACA (termasuk ciphertext sebelum rotasi). */
  async byVersion(purpose: Purpose, scope: string, version: number): Promise<Buffer> {
    assertScope(purpose, scope);
    const id = `${scope}|${purpose}|${version}`;
    const cached = this.keys.get(id);
    if (cached) return cached;

    const row = await this.loader.version(purpose, scope === PLATFORM ? null : scope, version);
    if (!row) throw new KeyMissingError(purpose, scope, version);
    const key = this.unwrap(row, purpose, scope);
    this.keys.set(id, key);
    return key;
  }
}
