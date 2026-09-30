import { SetMetadata } from '@nestjs/common';

/**
 * Deklarasi akses per route (DEMO-0304). SETIAP route wajib memakai tepat satu:
 *
 *   @Public()                 tanpa session (login, refresh, terima undangan)
 *   @Authenticated()          session sah, tanpa permission (keluar, data diri sendiri)
 *   @RequirePermission('x.y') session TENANT + permission x.y efektif
 *   @RequirePlatformPermission('platform.x.y')
 *                             session PLATFORM + permission platform (DEMO-0311)
 *
 * Dua jenis permission TIDAK dapat saling menggantikan, dan itu ditegakkan
 * keduanya: guard menolak session dengan context yang salah, dan database
 * menolak permission platform di role tenant lewat foreign key (code, scope).
 *
 * Route tanpa deklarasi DITOLAK oleh AccessGuard (deny-by-default), dan tes
 * slice 10 menolak build yang memuat route semacam itu. Lupa menulis dekorator
 * menghasilkan 403, bukan endpoint terbuka.
 *
 * Yang diperiksa selalu KODE PERMISSION, tidak pernah nama role (Demo
 * Foundation sec.5-6).
 */

export const ACCESS_KEY = 'saas:access';

export type Access =
  | { kind: 'public' }
  | { kind: 'identity'; supportAllowed?: boolean }
  | { kind: 'permission'; permission: string }
  | { kind: 'platform'; permission: string };

export const Public = () => SetMetadata(ACCESS_KEY, { kind: 'public' } satisfies Access);
export const Authenticated = () => SetMetadata(ACCESS_KEY, { kind: 'identity' } satisfies Access);

/**
 * Route identitas yang juga boleh diakses sesi support (DEMO-0312).
 *
 * Dibuat sebagai deklarasi TERSENDIRI, bukan sebagai nilai bawaan @Authenticated:
 * sesi support tidak punya membership, jadi sebagian besar route "data diri
 * sendiri" tidak punya arti untuknya - dan satu di antaranya,
 * POST /me/context-switch, akan menjadi jalan menukar sesi support menjadi session
 * tenant biasa. Karena itu bawaannya DITOLAK, dan pengecualian ditulis satu per
 * satu di tempat yang terlihat saat review.
 */
export const AuthenticatedWithSupport = () =>
  SetMetadata(ACCESS_KEY, { kind: 'identity', supportAllowed: true } satisfies Access);
export const RequirePermission = (permission: string) =>
  SetMetadata(ACCESS_KEY, { kind: 'permission', permission } satisfies Access);
export const RequirePlatformPermission = (permission: string) =>
  SetMetadata(ACCESS_KEY, { kind: 'platform', permission } satisfies Access);
