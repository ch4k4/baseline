import { Client } from 'pg';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

/**
 * Membersihkan anggota yang ditambahkan tes undangan (slice 9, API dan browser).
 *
 * Kenapa perlu: tes slice 3, 5, dan 8 memeriksa daftar anggota Alpha dan Beta
 * SECARA PERSIS. Itu disengaja - daftar persis menangkap nama tenant lain yang
 * bocor. Anggota yang ditinggalkan tes undangan akan membuat tes-tes itu gagal
 * pada run berikutnya tanpa `reset`.
 *
 * Yang dihapus:
 *   - semua undangan kecuali undangan seed (e1e1...0001);
 *   - membership + profil yang dibuat LEWAT undangan itu, beserta session,
 *     refresh token, dan penugasan role-nya;
 *   - role NON-sistem (buatan tes slice 10) beserta isi dan penugasannya.
 *     Role sistem (seed) dan penugasan milik anggota seed tidak disentuh;
 * Yang TIDAK dihapus:
 *   - membership milik identitas seed (UUID berpola ...-0000-0000-0000-...),
 *     bahkan bila undangan menunjuk ke sana (F-12 memakai ulang membership aktif);
 *   - baris users/credentials yang dibuat tes: audit_logs merujuk users, dan
 *     audit tidak dihapus. Identitas itu tertinggal tanpa tenant, tidak terlihat
 *     di daftar anggota mana pun.
 *
 * Berjalan sebagai SUPERUSER (melewati RLS), sama seperti seed. Ini alat tes,
 * bukan jalur aplikasi, dan hanya menyentuh database demo.
 */

export const SEED_INVITATION = 'e1e1e1e1-0000-0000-0000-000000000001';

export async function cleanupInvitationArtifacts(db: Client): Promise<{ memberships: number; invitations: number }> {
  await db.query('BEGIN');
  try {
    const { rows } = await db.query<{ id: string }>(
      `SELECT m.id FROM tenant_memberships m
       JOIN user_invitations i ON i.accepted_membership_id = m.id
       WHERE i.id <> $1 AND m.user_id::text NOT LIKE '%-0000-0000-0000-%'`,
      [SEED_INVITATION],
    );
    const ids = rows.map((r) => r.id);
    await db.query(
      `DELETE FROM refresh_tokens WHERE session_id IN (SELECT id FROM sessions WHERE membership_id = ANY($1::uuid[]))`,
      [ids],
    );
    await db.query('DELETE FROM sessions WHERE membership_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM user_role_assignments WHERE membership_id = ANY($1::uuid[])', [ids]);
    // Penugasan yang DIBERIKAN oleh anggota tes kepada orang lain tetap ada; hanya
    // rujukan pemberinya yang dilepas (kolomnya opsional).
    await db.query(
      'UPDATE user_role_assignments SET assigned_by_membership_id = NULL WHERE assigned_by_membership_id = ANY($1::uuid[])',
      [ids]);
    await db.query('DELETE FROM invitation_roles WHERE invitation_id <> $1', [SEED_INVITATION]);
    await db.query(
      `DELETE FROM invitation_roles WHERE role_id IN (SELECT id FROM roles WHERE NOT is_system)`);
    await db.query(
      `DELETE FROM user_role_assignments WHERE role_id IN (SELECT id FROM roles WHERE NOT is_system)`);
    await db.query(
      `DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE NOT is_system)`);
    await db.query('DELETE FROM roles WHERE NOT is_system');
    const inv = await db.query('DELETE FROM user_invitations WHERE id <> $1', [SEED_INVITATION]);
    await db.query('DELETE FROM tenant_member_profiles WHERE membership_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM tenant_memberships WHERE id = ANY($1::uuid[])', [ids]);
    await db.query('COMMIT');
    return { memberships: ids.length, invitations: inv.rowCount ?? 0 };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

export function superClient(): Client {
  const password = process.env.DEMO_DB_SUPER_PASSWORD;
  if (!password) {
    throw new Error('Set dulu DEMO_DB_SUPER_PASSWORD (password superuser PostgreSQL) di jendela ini.');
  }
  return new Client({
    host: process.env.DEMO_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DEMO_DB_PORT ?? 5432),
    database: process.env.DEMO_DB_NAME ?? 'saas_demo',
    user: process.env.DEMO_DB_SUPER ?? 'postgres',
    password,
  });
}

function dijalankanLangsung(): boolean {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (dijalankanLangsung()) {
  const db = superClient();
  db.connect()
    .then(() => cleanupInvitationArtifacts(db))
    .then((r) => {
      console.log(`bersih: ${r.memberships} membership, ${r.invitations} undangan`);
      return db.end();
    })
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await db.end().catch(() => {});
      process.exit(1);
    });
}
