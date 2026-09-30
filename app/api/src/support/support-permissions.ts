/**
 * Permission set support session (ADR-003 sec.2.2 butir 2, sec.6 keputusan yang
 * ditutup di DEMO-0312).
 *
 * KENAPA HIMPUNAN TETAP DI KODE, bukan role di database: sesi support tidak
 * mewarisi hak siapa pun. Kalau ia memakai role tenant (tenant_owner misalnya),
 * isi role itu dapat diubah tenant - dan tenant yang mengubah isi role-nya sendiri
 * akan diam-diam mengubah apa yang boleh dilakukan platform di dalam tenantnya.
 * Arah itu salah di kedua sisi: platform bisa kehilangan akses yang dibutuhkannya,
 * atau mendapat lebih dari yang disetujui. Himpunan di bawah hanya berubah lewat
 * commit yang terlihat di review, dan tes membandingkan isinya dengan katalog.
 *
 * Yang TIDAK ada di sini adalah intinya (ADR-003 sec.2.2 butir 4): tidak ada
 * members.assign_role, roles.*, members.invite, members.suspend, owners.manage.
 * Support tidak dapat mengubah keamanan tenant - itu jalur tenant owner atau
 * jalur platform, bukan jalur support.
 */

/**
 * Hak baca. profile.read dan profile.update TIDAK termasuk walau berbentuk read:
 * keduanya berarti "profil MILIK SENDIRI", dan sesi support tidak punya
 * membership - tidak ada profil miliknya di tenant itu.
 */
export const SUPPORT_READ_SET: ReadonlySet<string> = new Set([
  'members.read',
  'roles.read',
  'permissions.read',
  'menus.read',
  'audit.read',
]);

/**
 * Satu-satunya mutasi yang boleh dilakukan sesi support, dan hanya dengan scope
 * READ_WRITE: memperbaiki profil anggota atas permintaan tenant. Itulah arti
 * reason_code DATA_CORRECTION_REQUESTED_BY_TENANT, dan database menolak scope
 * READ_WRITE untuk alasan lain (CHECK di migrasi 0020).
 */
export const SUPPORT_MUTATION_SET: ReadonlySet<string> = new Set(['members.update_profile']);

export const SUPPORT_WRITE_SET: ReadonlySet<string> = new Set([
  ...SUPPORT_READ_SET,
  ...SUPPORT_MUTATION_SET,
]);

export type SupportScope = 'READ_ONLY' | 'READ_WRITE';

export function supportPermissions(scope: SupportScope): ReadonlySet<string> {
  return scope === 'READ_WRITE' ? SUPPORT_WRITE_SET : SUPPORT_READ_SET;
}

/**
 * Alasan yang sah, dan mana yang mengizinkan perubahan data. Sumber yang sama
 * ditegakkan CHECK di database; daftar di sini ada supaya pemanggil mendapat
 * pesan yang dapat dibaca, bukan `check_violation`.
 */
export const REASON_CODES = [
  'TENANT_REPORTED_BUG',
  'DATA_INVESTIGATION',
  'SECURITY_INCIDENT',
  'DATA_CORRECTION_REQUESTED_BY_TENANT',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export const WRITE_REASON_CODES: ReadonlySet<string> = new Set([
  'DATA_CORRECTION_REQUESTED_BY_TENANT',
]);

/** Batas durasi. Ditegakkan CHECK di database; di sini untuk pesan yang jelas. */
export const MAX_DURATION_MINUTES = 60;

/**
 * Metode HTTP yang mengubah keadaan. Dipakai AccessGuard: dalam sesi support,
 * permintaan yang mengubah keadaan ditolak kecuali permissionnya ada di
 * SUPPORT_MUTATION_SET.
 *
 * Kenapa metode, bukan hanya permission: POST /notifications/security/:id/read
 * memerlukan audit.read - permission BACA yang dipakai route TULIS. Tanpa
 * pemeriksaan metode, sesi support dapat menandai notifikasi "sesi support
 * dimulai" sebagai sudah dibaca, yaitu menghapus peringatan tentang dirinya
 * sendiri dari layar tenant. Lubang itu ditemukan saat menulis slice ini, bukan
 * oleh tes.
 */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isMutatingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}
