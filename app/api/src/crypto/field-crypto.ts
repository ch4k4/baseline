import { AadParts, aadString, blindIndex, DecryptionError, open, seal } from './envelope.js';
import { KeyRing, PLATFORM, Purpose } from './key-ring.js';
import { normalizeEmail } from './normalize.js';

/**
 * Katalog field terenkripsi. Setiap field punya SATU definisi: tabel, kolom,
 * purpose kunci, dan domain blind index-nya. Penulis (seed) dan pembaca
 * (API) mengambil definisi dari sini, sehingga keduanya tidak mungkin
 * memakai AAD atau domain yang berbeda.
 *
 * Harus sejalan dengan db/data-field-register.json; tes register memeriksanya.
 */
export const FIELDS = {
  userEmail: {
    table: 'users',
    field: 'email',
    purpose: 'platform_identity' as Purpose,
    blindIndexPurpose: 'platform_identity_blind_index' as Purpose,
    domain: 'users.email',
  },
  profileDisplayName: {
    table: 'tenant_member_profiles',
    field: 'display_name',
    purpose: 'identity' as Purpose,
  },
  profileContactEmail: {
    table: 'tenant_member_profiles',
    field: 'contact_email',
    purpose: 'identity' as Purpose,
    blindIndexPurpose: 'identity_blind_index' as Purpose,
    domain: 'tenant_member_profiles.contact_email',
  },
  /**
   * Alasan support session (DEMO-0312). Satu-satunya field terenkripsi dengan
   * purpose PLATFORM yang isinya diketik manusia, dan satu-satunya yang tidak
   * punya blind index: ia tidak pernah dicari, hanya dibaca kembali oleh platform.
   */
  supportReason: {
    table: 'support_sessions',
    field: 'reason_text',
    purpose: 'platform_support_reason' as Purpose,
  },
  invitationEmail: {
    table: 'user_invitations',
    field: 'email',
    purpose: 'identity' as Purpose,
    blindIndexPurpose: 'identity_blind_index' as Purpose,
    domain: 'user_invitations.email',
  },
} as const;

export type FieldDef = { table: string; field: string; purpose: Purpose };

/**
 * Kunci tenant yang baru dicetak, dipakai sekali saat provisioning. Bukan pengganti
 * jalur biasa: sesudah tenant ACTIVE, seluruh enkripsi memakai `encrypt`/`decrypt`
 * yang membaca kunci dari database lewat F-24/F-25.
 */
export interface TenantProvisioningKeys {
  wrapped: { purpose: Purpose; version: number; wrapped: Buffer }[];
  seal(def: FieldDef, recordId: string, plaintext: string): Sealed;
  contactEmailIndex(rawEmail: string): Buffer;
}

export interface Sealed {
  ciphertext: Buffer;
  keyVersion: number;
}

/**
 * Layanan kriptografi field. Kode lain TIDAK memanggil envelope.ts langsung
 * (SSOT sec.10: enkripsi hanya di adapter khusus, bukan tersebar di controller
 * atau repository).
 */
export class FieldCrypto {
  constructor(private readonly ring: KeyRing) {}

  private aad(def: FieldDef, scope: string, recordId: string): AadParts {
    return { scope, table: def.table, field: def.field, recordId };
  }

  async encrypt(def: FieldDef, scope: string, recordId: string, plaintext: string): Promise<Sealed> {
    const { version, key } = await this.ring.active(def.purpose, scope);
    const aad = this.aad(def, scope, recordId);
    return {
      ciphertext: seal(key, Buffer.from(plaintext, 'utf8'), aadOf(aad)),
      keyVersion: version,
    };
  }

  async decrypt(
    def: FieldDef,
    scope: string,
    recordId: string,
    ciphertext: Buffer,
    keyVersion: number,
  ): Promise<string> {
    const key = await this.ring.byVersion(def.purpose, scope, keyVersion);
    try {
      return open(key, ciphertext, aadOf(this.aad(def, scope, recordId))).toString('utf8');
    } catch (error) {
      if (error instanceof DecryptionError) {
        // Telemetri keamanan TANPA data: tabel, kolom, versi kunci, dan scope.
        // Bukan ciphertext, bukan AAD lengkap, bukan record id.
        console.error(
          '[crypto] dekripsi ditolak',
          JSON.stringify({ table: def.table, field: def.field, keyVersion, scope: scope === PLATFORM ? PLATFORM : 'tenant' }),
        );
      }
      throw error;
    }
  }

  /**
   * Kunci untuk tenant yang SEDANG dibuat, beserta cara memakainya.
   *
   * Ada karena satu sifat yang tidak dapat dihindari: kunci tenant baru belum
   * ter-commit ketika nama dan email owner harus disegel, sehingga pembaca kunci
   * biasa (`ring.active`, yang membuka transaksi sendiri lewat F-24) tidak
   * melihatnya. Dua jalan keluar yang lebih buruk sudah ditolak: memecah
   * provisioning menjadi dua transaksi meninggalkan tenant separuh jadi yang tidak
   * dapat diperbaiki lewat endpoint mana pun, dan menyegel di luar adapter ini
   * memindahkan penyusunan AAD ke pemanggil - tempat ia akan berbeda cepat atau
   * lambat.
   *
   * DEK mentah hanya hidup di dalam objek ini, selama satu permintaan provisioning.
   * Yang keluar untuk disimpan hanyalah bentuk terbungkusnya (F-26).
   */
  newTenantKeys(tenantId: string): TenantProvisioningKeys {
    const identitas = this.ring.mintDek('identity', tenantId);
    const index = this.ring.mintDek('identity_blind_index', tenantId);
    return {
      wrapped: [
        { purpose: 'identity' as Purpose, version: identitas.version, wrapped: identitas.wrapped },
        { purpose: 'identity_blind_index' as Purpose, version: index.version, wrapped: index.wrapped },
      ],
      seal: (def: FieldDef, recordId: string, plaintext: string): Sealed => ({
        ciphertext: seal(
          identitas.dek,
          Buffer.from(plaintext, 'utf8'),
          aadString({ scope: tenantId, table: def.table, field: def.field, recordId }),
        ),
        keyVersion: identitas.version,
      }),
      contactEmailIndex: (rawEmail: string): Buffer =>
        blindIndex(
          index.dek,
          `${FIELDS.profileContactEmail.domain}|${tenantId}`,
          normalizeEmail(rawEmail),
        ),
    };
  }

  /** Blind index email global - untuk login, sebelum tenant diketahui (SSOT sec.9.1). */
  async userEmailIndex(rawEmail: string): Promise<Buffer> {
    const { key } = await this.ring.active(FIELDS.userEmail.blindIndexPurpose, PLATFORM);
    return blindIndex(key, FIELDS.userEmail.domain, normalizeEmail(rawEmail));
  }

  /**
   * Blind index email kontak per tenant. tenantId ikut masuk ke input selain
   * menentukan kuncinya (SSOT sec.8.2): kalau suatu saat dua tenant keliru
   * berbagi kunci, nilai mereka tetap berbeda.
   */
  async contactEmailIndex(tenantId: string, rawEmail: string): Promise<Buffer> {
    const { key } = await this.ring.active(FIELDS.profileContactEmail.blindIndexPurpose, tenantId);
    return blindIndex(key, `${FIELDS.profileContactEmail.domain}|${tenantId}`, normalizeEmail(rawEmail));
  }

  /**
   * Blind index email undangan per tenant (deduplikasi undangan PENDING).
   * Domain berbeda dari email kontak: undangan dan profil tidak dapat di-join
   * lewat nilai ini.
   */
  async invitationEmailIndex(tenantId: string, rawEmail: string): Promise<Buffer> {
    const { key } = await this.ring.active(FIELDS.invitationEmail.blindIndexPurpose, tenantId);
    return blindIndex(key, `${FIELDS.invitationEmail.domain}|${tenantId}`, normalizeEmail(rawEmail));
  }

  /**
   * Pseudonim identifier untuk audit dan rate limit. Kuncinya SENGAJA berbeda
   * dari blind index users.email: kalau sama, setiap baris audit dapat di-join
   * langsung ke users oleh siapa pun yang hanya memegang database.
   */
  async auditIdentifier(rawIdentifier: string): Promise<Buffer> {
    const { key } = await this.ring.active('platform_audit_identifier', PLATFORM);
    return blindIndex(key, 'audit_logs.actor_identifier', normalizeEmail(rawIdentifier));
  }
}

const aadOf = aadString;
