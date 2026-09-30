import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Tx } from '../database/unit-of-work.js';

/**
 * Aturan administrasi tenant (slice 11; keputusan pemilik proyek 2026-09-22).
 *
 * 1. ANTI-ESKALASI. Pelaku hanya boleh memberi, mencabut, atau mengubah isi role
 *    yang SELURUH permission-nya ia pegang sendiri. Tanpa ini, admin dapat membuat
 *    role berisi hak yang tidak ia punya lalu memberikannya ke akun keduanya.
 * 2. TIDAK MENGUBAH DIRI SENDIRI. Role sendiri dan status sendiri tidak dapat
 *    diubah pelakunya.
 * 3. TIDAK TERKUNCI DARI TENANT. Setelah setiap mutasi, minimal satu anggota
 *    aktif harus memegang members.assign_role. Aturan ini atas PERMISSION, bukan
 *    nama role (Demo Foundation sec.5-6).
 *
 * Aturan 3 diperiksa di dalam transaksi yang sama dengan mutasinya, di bawah kunci
 * advisory per tenant (lockTenant). Tanpa kunci itu dua admin yang saling mencabut
 * pada saat bersamaan masing-masing masih melihat yang lain, lalu keduanya commit
 * dan tenant tidak punya administrator.
 */

const ADMIN_KEY_PERMISSION = 'members.assign_role';

/** Serialisasi mutasi administrasi per tenant, sampai transaksi selesai. */
export async function lockTenant(tx: Tx, tenantId: string): Promise<void> {
  // Dibungkus count(*): Prisma tidak dapat membaca kolom bertipe void.
  await tx.query('SELECT count(*)::int AS n FROM (SELECT pg_advisory_xact_lock(hashtextextended($1, 0))) k', [`tenant-admin:${tenantId}`]);
}

export async function assertTenantStaysAdministrable(tx: Tx): Promise<void> {
  const [row] = await tx.query<{ n: number }>(
    `SELECT count(DISTINCT membership_id)::int AS n FROM effective_permissions WHERE permission_code = $1`,
    [ADMIN_KEY_PERMISSION],
  );
  if (!row || row.n < 1) {
    throw new ConflictException('Perubahan ini akan membuat tenant tanpa anggota yang dapat mengatur role.');
  }
}

export function assertNotSelf(actorMembershipId: string, targetMembershipId: string, what: string): void {
  if (actorMembershipId === targetMembershipId) {
    throw new ForbiddenException(`Anda tidak dapat ${what} diri sendiri.`);
  }
}

export function assertWithin(actor: Set<string>, permissions: Iterable<string>): void {
  for (const p of permissions) {
    if (!actor.has(p)) throw new ForbiddenException('Anda tidak dapat memberikan hak yang tidak Anda miliki.');
  }
}

/** Permission (tenant, aktif) milik setiap role; role yang tidak terlihat (tenant lain) tidak ada di hasil. */
export async function permissionsOfRoles(tx: Tx, roleIds: string[]): Promise<Map<string, { archived: boolean; system: boolean; perms: string[] }>> {
  if (roleIds.length === 0) return new Map();
  const rows = await tx.query<{ id: string; archived: boolean; is_system: boolean; perms: string[] }>(
    `SELECT r.id, r.archived_at IS NOT NULL AS archived, r.is_system,
            COALESCE(array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS perms
     FROM roles r LEFT JOIN role_permissions rp ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
     WHERE r.id = ANY($1::uuid[])
     GROUP BY r.id`,
    [roleIds],
  );
  return new Map(rows.map((r) => [r.id, { archived: r.archived, system: r.is_system, perms: r.perms }]));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new BadRequestException(`${field} bukan UUID yang sah.`);
  return value.toLowerCase();
}

export function uuidList(value: unknown, field: string, max = 50): string[] {
  if (!Array.isArray(value) || value.length > max) throw new BadRequestException(`${field} harus daftar (maksimal ${max}).`);
  return [...new Set(value.map((v) => uuid(v, field)))];
}

export function version(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new BadRequestException('version wajib diisi (bilangan bulat dari data terakhir yang Anda baca).');
  }
  return value as number;
}

/**
 * Kode SQLSTATE dari error query, juga saat dibungkus Prisma.
 *
 * Ditelusuri melalui RANTAI error, bukan lewat satu jalur yang ditebak. Versi
 * sebelumnya memeriksa empat jalur tertentu (`meta.code`, `cause.originalCode`,
 * `driverAdapterError.cause.originalCode`, `code`) dan itu cukup sampai slice 13:
 * pelanggaran foreign key dari INSERT di context platform datang dengan bentuk
 * yang tidak ada di daftar itu, sehingga 400 yang seharusnya menjadi 500. Bentuk
 * error adalah urusan pustaka dan berubah antar versi; yang tetap adalah kodenya.
 *
 * Hanya nilai berbentuk SQLSTATE yang diterima: lima karakter dan diawali angka.
 * Kode Prisma sendiri (`P2010`) diawali huruf, jadi tidak pernah tertukar.
 */
const SQLSTATE_RE = /^[0-9][0-9A-Z]{4}$/;

export function sqlState(error: any): string | undefined {
  const dikunjungi = new Set<unknown>();

  const telusuri = (e: any): string | undefined => {
    if (!e || typeof e !== 'object' || dikunjungi.has(e)) return undefined;
    dikunjungi.add(e);

    for (const kunci of ['originalCode', 'code']) {
      const v = e[kunci];
      if (typeof v === 'string' && SQLSTATE_RE.test(v)) return v;
    }
    for (const kunci of ['meta', 'cause', 'driverAdapterError', 'error']) {
      const ketemu = telusuri(e[kunci]);
      if (ketemu) return ketemu;
    }
    return undefined;
  };

  return telusuri(error);
}

export const STALE = 'Data sudah diubah orang lain. Muat ulang, lalu coba lagi.';
