/**
 * Nama event audit yang dipakai kode ini (Demo Foundation sec.15).
 *
 * Katalognya ada di database (migrasi 0016) dan ditegakkan foreign key dari
 * audit_logs. Daftar di sini adalah bagian yang SUDAH terpakai; katalog juga
 * memuat nama untuk fitur yang belum dibuat (tenant, platform, support, menu).
 *
 * Kenapa perlu daftar bertipe di sisi kode: AuditService sengaja menelan
 * kegagalan menulis audit (audit tidak boleh menjadi titik kegagalan tunggal),
 * jadi nama yang salah ketik tidak akan terlihat saat runtime - barisnya hanya
 * tidak pernah ada. TypeScript menolaknya sebelum itu terjadi, dan tes slice 6
 * membandingkan daftar ini dengan katalog di database.
 *
 * Konvensi: <domain>.<aksi>. Hasil ada di kolom outcome, bukan di nama. Alasan
 * kegagalan adalah reason code di detail. Pengecualian yang disengaja:
 * auth.refresh.reuse_detected punya nama sendiri supaya dapat dipasangi alarm.
 */
export const AUDIT_EVENTS = [
  'auth.login',
  'auth.login.context_required',
  'auth.login.throttled',
  'auth.select_context',
  'auth.context_switch',
  'auth.refresh',
  'auth.refresh.reuse_detected',
  'auth.logout',
  'identity.created',
  'invitation.created',
  'invitation.revoked',
  'invitation.accepted',
  'member.profile_updated',
  'member.suspended',
  'member.reactivated',
  'member.roles_replaced',
  'role.created',
  'role.updated',
  'role.archived',
  'role.permissions_replaced',
  'authz.denied',
  'platform.admin_granted',
  'platform.admin_revoked',
  'support.session.started',
  'support.session.ended',
  'support.session.revoked',
  // Satu baris per permintaan yang MENGUBAH keadaan di dalam support session.
  // 'support.data_revealed' ada di katalog database tetapi TIDAK di sini: membuka
  // masker DP-1 belum dibuat (D-37), dan nama yang tidak pernah ditulis tidak boleh
  // terlihat seperti sudah dipakai.
  'support.mutation',
  // Provisioning tenant (D-17, D-25). 'tenant.owner_provisioned' lahir bersama
  // keputusan bahwa owner pertama dibuat platform, bukan lewat undangan: tenant harus
  // dapat MELIHAT bahwa anggota pertamanya datang dari luar dirinya.
  'tenant.created',
  'tenant.owner_provisioned',
  // Suspend/reactivate (D-47). Detail hanya status asal dan tujuan.
  'tenant.status_changed',
] as const;

export type AuditEventType = (typeof AUDIT_EVENTS)[number];
