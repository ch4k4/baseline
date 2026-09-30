import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UnitOfWork } from '../database/unit-of-work.js';
import { AuditService } from '../auth/audit.service.js';
import { FIELDS } from '../crypto/field-crypto.js';
import { CryptoService } from '../crypto/crypto.module.js';
import { sqlState } from '../admin/admin-rules.js';
import { normalizeEmail } from '../crypto/normalize.js';

/**
 * Provisioning tenant (D-17 dan D-25).
 *
 * Sebelum ini, tenant hanya dapat lahir dari skrip seed: kunci enkripsinya dibuat
 * skrip yang memegang KEK, dan role sistemnya ditulis skrip yang sama. Artinya
 * membuat tenant saat runtime mustahil - syarat paling dasar bagi produk apa pun,
 * dan itulah kenapa ini langkah fondasi, bukan hiasan konsol.
 *
 * URUTANNYA BUKAN SELERA. Tenant lahir `PROVISIONING`, dan status itu yang
 * mengizinkan F-27/F-28 bekerja; begitu `ACTIVE`, keduanya menolak. Jadi urutan
 * tenant -> kunci -> role -> owner -> ACTIVE bukan sekadar rapi: langkah terakhir
 * MENUTUP pintu yang dipakai langkah-langkah sebelumnya.
 *
 * SATU TRANSAKSI untuk seluruh rangkaian. Tenant yang punya kunci tetapi tanpa role,
 * atau punya role tetapi tanpa owner, adalah keadaan yang tidak dapat dipakai dan
 * tidak dapat diperbaiki lewat endpoint mana pun (F-28 menolak tenant yang sudah
 * ACTIVE, dan tenant PROVISIONING tidak terlihat di jalur tenant). Kalau satu langkah
 * gagal, tidak ada tenant yang tertinggal separuh jadi.
 *
 * YANG HARUS DIKATAKAN TERUS TERANG tentang owner: membuat membership owner LANGSUNG
 * dari platform adalah pengecualian terhadap ADR-002 sec.2.2 (invitation-only), dan
 * pengecualian itu memberi platform kewenangan menempelkan identitas ke tenant.
 * Batasnya ditegakkan DATABASE (F-28): hanya tenant `PROVISIONING`, hanya bila belum
 * ada satu anggota pun, hanya satu membership, hanya role `tenant_owner`, dan
 * identitasnya harus sudah ada - platform tidak membuat identitas. Kode ini tidak
 * dapat melonggarkan satu pun di antaranya.
 */

interface PermintaanTenant {
  slug: string;
  name: string;
  ownerUserId: string;
  ownerDisplayName: string;
  ownerContactEmail: string;
}

export interface HasilProvisioning {
  tenantId: string;
  slug: string;
  name: string;
  status: string;
  ownerMembershipId: string;
  roleCount: number;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

@Injectable()
export class TenantProvisioningService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  async list(): Promise<
    { id: string; slug: string; name: string; status: string; created_at: string }[]
  > {
    return this.uow.withPlatform((tx) =>
      tx.query(`SELECT id, slug, name, status, created_at FROM tenants ORDER BY created_at, slug`),
    );
  }

  async create(
    permintaan: PermintaanTenant,
    actorUserId: string,
    actorSessionId: string,
  ): Promise<HasilProvisioning> {
    const slug = permintaan.slug?.trim().toLowerCase() ?? '';
    const name = permintaan.name?.trim() ?? '';
    const displayName = permintaan.ownerDisplayName?.trim() ?? '';
    const email = permintaan.ownerContactEmail?.trim() ?? '';

    if (!SLUG.test(slug)) {
      throw new BadRequestException('slug hanya huruf kecil, angka, dan tanda hubung (2-63)');
    }
    if (name.length < 2 || name.length > 255) throw new BadRequestException('nama tenant 2-255 huruf');
    if (displayName.length < 2) throw new BadRequestException('nama owner minimal 2 huruf');
    if (!email.includes('@')) throw new BadRequestException('email owner tidak sah');
    if (!/^[0-9a-f-]{36}$/.test(permintaan.ownerUserId)) {
      throw new BadRequestException('ownerUserId harus UUID identitas yang sudah ada');
    }

    const tenantId = randomUUID();
    const profileId = randomUUID();

    // Kunci dicetak DI LUAR transaksi karena pencetakannya tidak menyentuh database:
    // yang masuk ke transaksi hanya bentuk terbungkusnya. KEK tidak pernah menjadi
    // bagian dari query, dan DEK mentahnya hidup hanya selama permintaan ini -
    // dipakai menyegel nama dan email owner, yang tidak dapat menunggu kunci itu
    // ter-commit.
    const kunci = this.crypto.newTenantKeys(tenantId);

    const hasil = await this.uow.withPlatform(async (tx) => {
      // 1. Tenant lahir PROVISIONING (policy platform_insert menuntutnya).
      try {
        await tx.query(
          `INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'PROVISIONING')`,
          [tenantId, slug, name],
        );
      } catch (error) {
        // 23505 = slug sudah dipakai. Ini satu-satunya bentrokan yang mungkin di sini,
        // dan ia bukan kesalahan server.
        if (sqlState(error) === '23505') throw new ConflictException(`slug "${slug}" sudah dipakai`);
        throw error;
      }

      // 2. Kunci enkripsi tenant (F-26). Tanpa ini, langkah 4 tidak dapat menyimpan
      //    nama dan email owner - dan tenant tanpa kunci adalah tenant yang gagal
      //    pada permintaan pertamanya, bukan saat dibuat.
      for (const k of kunci.wrapped) {
        const [{ ok }] = await tx.query<{ ok: boolean }>(
          `SELECT auth.create_tenant_key($1, $2, $3, $4) AS ok`,
          [tenantId, k.purpose, k.version, k.wrapped],
        );
        if (!ok) throw new Error(`F-26 menolak kunci ${k.purpose} untuk tenant ${tenantId}`);
      }

      // 3. Role sistem dari template (F-27).
      const [{ n }] = await tx.query<{ n: number }>(
        `SELECT auth.provision_tenant_roles($1) AS n`,
        [tenantId],
      );
      if (n === -1) throw new Error('F-27 menolak: tenant bukan PROVISIONING');
      if (n === -2) throw new Error('F-27 menolak: tenant sudah punya role');
      if (n <= 0) throw new Error(`F-27 tidak membuat role apa pun (${n}) - template kosong?`);

      // 4. Owner pertama (F-28). Nama dan email disegel dengan kunci tenant YANG BARU
      //    dibuat, dan AAD-nya memuat tenant serta id profil - ciphertext dari tenant
      //    lain karena itu tidak dapat dipindahkan ke sini.
      const nama = kunci.seal(FIELDS.profileDisplayName, profileId, displayName);
      const kontak = kunci.seal(FIELDS.profileContactEmail, profileId, normalizeEmail(email));
      const blindIndex = kunci.contactEmailIndex(email);

      const [{ membership }] = await tx.query<{ membership: string | null }>(
        `SELECT auth.provision_tenant_owner($1,$2,$3,$4,$5,$6,$7,$8) AS membership`,
        [
          tenantId,
          permintaan.ownerUserId,
          profileId,
          nama.ciphertext,
          nama.keyVersion,
          kontak.ciphertext,
          kontak.keyVersion,
          blindIndex,
        ],
      );
      if (!membership) {
        // F-28 mengembalikan NULL untuk SEMUA penolakan, tanpa membedakan sebabnya:
        // membedakannya akan memberi tahu pemanggil apakah sebuah identitas ada.
        throw new BadRequestException(
          'owner tidak dapat dibuat: identitas tidak ada/tidak aktif, atau tenant sudah punya anggota',
        );
      }

      // 5. Menutup pintu: sesudah ACTIVE, F-27 dan F-28 menolak tenant ini.
      await tx.query(`UPDATE tenants SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [
        tenantId,
      ]);

      return { roleCount: n, ownerMembershipId: membership };
    });

    // Audit ditulis DI LUAR transaksi lewat F-14, dua kali per kejadian - satu baris
    // tanpa tenant (audit platform) dan satu dengan tenant (audit tenant). Pola yang
    // sama dengan support session: tenant harus dapat melihat bahwa anggota
    // pertamanya dibuat platform, bukan hanya platform yang mencatatnya sendiri.
    for (const tenantIdAudit of [null, tenantId]) {
      await this.audit.record({
        eventType: 'tenant.created',
        outcome: 'SUCCESS',
        tenantId: tenantIdAudit,
        actorUserId,
        actorSessionId,
        subjectType: 'tenant',
        subjectId: tenantId,
        detail: { slug, roleCount: hasil.roleCount },
      });
      await this.audit.record({
        eventType: 'tenant.owner_provisioned',
        outcome: 'SUCCESS',
        tenantId: tenantIdAudit,
        actorUserId,
        actorSessionId,
        subjectType: 'membership',
        subjectId: hasil.ownerMembershipId,
        // TIDAK memuat nama maupun email owner: keduanya data pribadi, dan audit
        // bukan tempatnya (Demo Foundation sec.15). Yang dicatat adalah identitas
        // global yang ditunjuk, karena itulah keputusan yang perlu dapat ditinjau.
        detail: { ownerUserId: permintaan.ownerUserId, via: 'platform-provisioning' },
      });
    }

    return { tenantId, slug, name, status: 'ACTIVE', ...hasil };
  }
}
