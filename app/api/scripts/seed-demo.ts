import { Client } from 'pg';
import { PasswordService } from '../src/auth/password.service.js';
import { failWithExplanation } from '../src/database/preflight.js';
import { ensureKek, kekPath, loadKek } from '../src/crypto/kek-source.js';
import { newDek, wrapDek } from '../src/crypto/envelope.js';
import { FieldCrypto, FIELDS } from '../src/crypto/field-crypto.js';
import { TicketService } from '../src/auth/ticket.service.js';
import { deliverInvitation, outboxDir } from '../src/invitations/outbox.js';
import {
  KeyRing,
  PLATFORM,
  PLATFORM_PURPOSES,
  Purpose,
  TENANT_PURPOSES,
  WrappedKeyLoader,
  WrappedKeyRow,
} from '../src/crypto/key-ring.js';

/**
 * Seed identitas demo (menggantikan set-demo-passwords.ts sejak D-01).
 *
 * Berjalan sebagai SUPERUSER, seperti 0005: seluruh tabel memakai FORCE RLS.
 * Ini jalur provisioning demo, bukan jalur aplikasi.
 *
 * Urutan, dan kenapa urutannya begini:
 *   1. KEK      - dibuat sekali di luar repo bila belum ada (kek-source.ts).
 *   2. DEK      - satu per scope+purpose, dibungkus KEK, disimpan di crypto_keys.
 *   3. identitas - email/nama dienkripsi DI SINI, sebelum menyentuh database.
 *
 * Idempoten: menjalankannya ulang memakai DEK yang sudah ada (tidak membuat
 * versi baru) dan menulis ulang ciphertext dengan nonce baru. Bila KEK di mesin
 * ini tidak dapat membuka DEK yang ada, seed BERHENTI - lebih baik gagal dengan
 * pesan daripada membuat DEK kedua yang membuat data lama tak terbaca.
 *
 * UUID tetap dan sama dengan sebelum D-01: tes SQL dan API merujuknya langsung.
 */

const ALPHA = '11111111-1111-1111-1111-111111111111';
const BETA = '22222222-2222-2222-2222-222222222222';

// Data SINTETIS. Tidak ada data pribadi nyata di repo (Demo Foundation sec.14).
const USERS = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'owner@alpha.demo' },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', email: 'user@alpha.demo' },
  { id: 'bbbbbbbb-0000-0000-0000-000000000001', email: 'admin@beta.demo' },
  { id: 'cccccccc-0000-0000-0000-000000000001', email: 'multi@demo.local' },
];

// URUTAN DAN UUID PROFIL SENGAJA TIDAK SAMA DENGAN URUTAN ABJAD NAMA.
// Nama adalah ciphertext, jadi database tidak dapat mengurutkannya; aplikasi
// yang mengurutkan setelah dekripsi (SSOT sec.8.4). Kalau data seed kebetulan
// sudah urut - seperti versi pertama berkas ini - menghapus pengurutan itu tidak
// membuat satu tes pun gagal (ditemukan mutation test D-01, 2026-09-21).
const MEMBERSHIPS = [
  { id: 'a1a1a1a1-0000-0000-0000-000000000003', tenant: ALPHA, user: USERS[3], profile: 'f1f1f1f1-0000-0000-0000-000000000001', name: 'Multi di Alpha' },
  { id: 'b2b2b2b2-0000-0000-0000-000000000002', tenant: BETA,  user: USERS[3], profile: 'f2f2f2f2-0000-0000-0000-000000000001', name: 'Multi di Beta' },
  { id: 'a1a1a1a1-0000-0000-0000-000000000002', tenant: ALPHA, user: USERS[1], profile: 'f1f1f1f1-0000-0000-0000-000000000002', name: 'Alpha User' },
  { id: 'b2b2b2b2-0000-0000-0000-000000000001', tenant: BETA,  user: USERS[2], profile: 'f2f2f2f2-0000-0000-0000-000000000002', name: 'Beta Admin' },
  { id: 'a1a1a1a1-0000-0000-0000-000000000001', tenant: ALPHA, user: USERS[0], profile: 'f1f1f1f1-0000-0000-0000-000000000003', name: 'Alpha Owner' },
];

// Role baseline per tenant (Demo Foundation sec.6). Nama role hanya konvension
// seed: guard memutuskan dari kode permission, tidak pernah dari nama role.
// Role sistem tidak dapat diubah tenant (policy 0013); isinya hanya dari sini.
const TENANT_ALL = '*';
const ROLE_BUNDLES: Record<string, { name: string; permissions: string[] | typeof TENANT_ALL }> = {
  tenant_owner: { name: 'Tenant Owner', permissions: TENANT_ALL },
  tenant_admin: {
    name: 'Tenant Admin',
    permissions: [
      'profile.read', 'profile.update',
      'members.read', 'members.invite', 'members.update_profile', 'members.suspend', 'members.assign_role',
      'roles.read', 'roles.create', 'roles.update', 'roles.archive', 'roles.assign_permission',
      'permissions.read', 'menus.read', 'audit.read',
    ],
  },
  tenant_user: { name: 'Tenant User', permissions: ['profile.read', 'profile.update', 'menus.read'] },
  tenant_auditor: {
    name: 'Tenant Auditor',
    permissions: ['profile.read', 'members.read', 'roles.read', 'permissions.read', 'menus.read', 'audit.read'],
  },
};
const ROLE_CODES = Object.keys(ROLE_BUNDLES);
// UUID tetap: tes merujuk role seed langsung. 9a.. = Alpha, 9b.. = Beta, urutan = ROLE_CODES.
const roleId = (tenant: string, code: string) =>
  `${tenant === ALPHA ? '9a9a9a9a' : '9b9b9b9b'}-0000-0000-0000-00000000000${ROLE_CODES.indexOf(code) + 1}`;

// Siapa memegang role apa (membership -> role). Multi = auditor di kedua tenant:
// hak baca IAM, tanpa hak mengundang.
const ASSIGNMENTS: Array<{ membership: string; tenant: string; role: string }> = [
  { membership: 'a1a1a1a1-0000-0000-0000-000000000001', tenant: ALPHA, role: 'tenant_owner' },
  { membership: 'a1a1a1a1-0000-0000-0000-000000000002', tenant: ALPHA, role: 'tenant_user' },
  { membership: 'a1a1a1a1-0000-0000-0000-000000000003', tenant: ALPHA, role: 'tenant_auditor' },
  { membership: 'b2b2b2b2-0000-0000-0000-000000000001', tenant: BETA,  role: 'tenant_admin' },
  { membership: 'b2b2b2b2-0000-0000-0000-000000000002', tenant: BETA,  role: 'tenant_auditor' },
];

// DEMO-0201: minimal satu undangan PENDING di Tenant Alpha, token lewat kanal
// demo (outbox), tidak pernah dicetak. Email belum punya akun.
const PENDING_INVITE = {
  id: 'e1e1e1e1-0000-0000-0000-000000000001',
  tenant: ALPHA,
  tenantName: 'Tenant Alpha',
  email: 'baru@alpha.demo',
  invitedBy: 'a1a1a1a1-0000-0000-0000-000000000001',
};

/** Loader superuser: membaca crypto_keys langsung, tanpa fungsi definer. */
class SuperuserKeyLoader implements WrappedKeyLoader {
  constructor(private readonly db: Client) {}

  async active(purpose: Purpose, tenantId: string | null): Promise<WrappedKeyRow | null> {
    const { rows } = await this.db.query<WrappedKeyRow>(
      `SELECT key_version, wrapped_dek FROM crypto_keys
       WHERE purpose = $1 AND tenant_id IS NOT DISTINCT FROM $2 AND status = 'ACTIVE'`,
      [purpose, tenantId],
    );
    return rows[0] ?? null;
  }

  async version(purpose: Purpose, tenantId: string | null, version: number): Promise<WrappedKeyRow | null> {
    const { rows } = await this.db.query<WrappedKeyRow>(
      `SELECT key_version, wrapped_dek FROM crypto_keys
       WHERE purpose = $1 AND tenant_id IS NOT DISTINCT FROM $2 AND key_version = $3`,
      [purpose, tenantId, version],
    );
    return rows[0] ?? null;
  }
}

async function ensureKey(db: Client, kek: Buffer, loader: SuperuserKeyLoader, purpose: Purpose, tenantId: string | null) {
  if (await loader.active(purpose, tenantId)) return false;
  const scope = tenantId ?? PLATFORM;
  await db.query(
    `INSERT INTO crypto_keys (tenant_id, purpose, key_version, wrapped_dek) VALUES ($1, $2, 1, $3)`,
    [tenantId, purpose, wrapDek(kek, newDek(), scope, purpose, 1)],
  );
  return true;
}

async function main(): Promise<void> {
  const plain = process.env.DEMO_PASSWORD ?? 'Demo#12345';
  const superPassword = process.env.DEMO_DB_SUPER_PASSWORD;
  if (!superPassword) {
    console.error('Set dulu DEMO_DB_SUPER_PASSWORD (password superuser PostgreSQL).');
    process.exit(2);
  }

  const db = new Client({
    host: process.env.DEMO_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DEMO_DB_PORT ?? 5432),
    database: process.env.DEMO_DB_NAME ?? 'saas_demo',
    user: process.env.DEMO_DB_SUPER ?? 'postgres',
    password: superPassword,
  });
  await db.connect();

  // KEK hanya BOLEH dibuat bila database belum punya satu kunci pun. Membuat KEK
  // baru di atas kunci yang sudah ada tidak memperbaiki apa pun: kunci lama tetap
  // tak terbuka, dan kini ada KEK yatim yang membuat kegagalan berikutnya lebih
  // membingungkan. Versi pertama berkas ini melakukan persis itu.
  const { rows: ada } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM crypto_keys');
  let kek: Buffer;
  if (ada[0].n > 0) {
    kek = loadKek(); // KekMissingError bila hilang - pesannya menyebut reset
    console.log(`  -> KEK demo: ${kekPath()}`);
  } else {
    const k = ensureKek();
    kek = k.kek;
    console.log(k.created ? `  -> KEK demo baru dibuat di ${kekPath()}` : `  -> KEK demo: ${kekPath()}`);
  }

  try {
    await db.query('BEGIN');
    const loader = new SuperuserKeyLoader(db);

    let createdKeys = 0;
    for (const p of PLATFORM_PURPOSES) createdKeys += Number(await ensureKey(db, kek, loader, p, null));
    for (const t of [ALPHA, BETA]) {
      for (const p of TENANT_PURPOSES) createdKeys += Number(await ensureKey(db, kek, loader, p, t));
    }

    // KeyRing yang sama dengan yang dipakai API. Kalau KEK tidak cocok dengan DEK
    // lama, di sinilah prosesnya berhenti (KekMismatchError).
    const crypto = new FieldCrypto(new KeyRing(kek, loader));
    const passwords = new PasswordService();

    for (const u of USERS) {
      const email = await crypto.encrypt(FIELDS.userEmail, PLATFORM, u.id, u.email);
      await db.query(
        `INSERT INTO users (id, email_ciphertext, email_key_version, email_blind_index)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET
           email_ciphertext = EXCLUDED.email_ciphertext,
           email_key_version = EXCLUDED.email_key_version,
           email_blind_index = EXCLUDED.email_blind_index,
           updated_at = now()`,
        [u.id, email.ciphertext, email.keyVersion, await crypto.userEmailIndex(u.email)],
      );
      await db.query(
        `INSERT INTO credentials (user_id, password_hash) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
        [u.id, await passwords.hash(plain)],
      );
    }

    for (const m of MEMBERSHIPS) {
      await db.query(
        `INSERT INTO tenant_memberships (id, tenant_id, user_id) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [m.id, m.tenant, m.user.id],
      );
      const name = await crypto.encrypt(FIELDS.profileDisplayName, m.tenant, m.profile, m.name);
      const contact = await crypto.encrypt(FIELDS.profileContactEmail, m.tenant, m.profile, m.user.email);
      await db.query(
        `INSERT INTO tenant_member_profiles (
           id, tenant_id, membership_id,
           display_name_ciphertext, display_name_key_version,
           contact_email_ciphertext, contact_email_key_version, contact_email_blind_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           display_name_ciphertext = EXCLUDED.display_name_ciphertext,
           display_name_key_version = EXCLUDED.display_name_key_version,
           contact_email_ciphertext = EXCLUDED.contact_email_ciphertext,
           contact_email_key_version = EXCLUDED.contact_email_key_version,
           contact_email_blind_index = EXCLUDED.contact_email_blind_index,
           updated_at = now()`,
        [
          m.profile, m.tenant, m.id,
          name.ciphertext, name.keyVersion,
          contact.ciphertext, contact.keyVersion,
          await crypto.contactEmailIndex(m.tenant, m.user.email),
        ],
      );
    }

    // Role sistem dan isinya. Isi role sistem dibuat ulang setiap seed (hapus lalu
    // isi), supaya seed ulang selalu menghasilkan bundel yang sama persis.
    for (const tenant of [ALPHA, BETA]) {
      for (const code of ROLE_CODES) {
        const id = roleId(tenant, code);
        await db.query(
          `INSERT INTO roles (id, tenant_id, code, name, is_system) VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_system = true, archived_at = NULL`,
          [id, tenant, code, ROLE_BUNDLES[code].name],
        );
        await db.query('DELETE FROM role_permissions WHERE tenant_id = $1 AND role_id = $2', [tenant, id]);
        const bundle = ROLE_BUNDLES[code].permissions;
        await db.query(
          `INSERT INTO role_permissions (tenant_id, role_id, permission_code)
           SELECT $1, $2, code FROM permissions
           WHERE scope = 'TENANT' AND retired_at IS NULL AND ($3::text[] IS NULL OR code = ANY($3::text[]))`,
          [tenant, id, bundle === TENANT_ALL ? null : bundle],
        );
        if (bundle !== TENANT_ALL) {
          // Kode yang salah ketik di bundel tidak boleh hilang diam-diam.
          const { rows } = await db.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM role_permissions WHERE tenant_id = $1 AND role_id = $2', [tenant, id]);
          if (rows[0].n !== bundle.length) throw new Error(`bundel ${code} memuat permission yang tidak ada di katalog`);
        }
      }
    }
    for (const a of ASSIGNMENTS) {
      await db.query(
        `INSERT INTO user_role_assignments (tenant_id, membership_id, role_id) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, membership_id, role_id) WHERE ended_at IS NULL DO NOTHING`,
        [a.tenant, a.membership, roleId(a.tenant, a.role)],
      );
    }

    // Undangan PENDING demo. Token baru setiap seed (token lama mati), jadi berkas
    // outbox terbaru adalah satu-satunya yang berlaku.
    const tickets = new TicketService();
    const { token, hash } = tickets.issue();
    const invSealed = await crypto.encrypt(FIELDS.invitationEmail, PENDING_INVITE.tenant, PENDING_INVITE.id, PENDING_INVITE.email);
    const { rows: invRows } = await db.query<{ id: string; expires_at: Date }>(
      `INSERT INTO user_invitations (
         id, tenant_id, email_ciphertext, email_key_version, email_blind_index,
         identity_hint, invited_by_membership_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '72 hours')
       ON CONFLICT (tenant_id, email_blind_index) WHERE status = 'PENDING'
       DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, updated_at = now()
       RETURNING id, expires_at`,
      [
        PENDING_INVITE.id, PENDING_INVITE.tenant, invSealed.ciphertext, invSealed.keyVersion,
        await crypto.invitationEmailIndex(PENDING_INVITE.tenant, PENDING_INVITE.email),
        await crypto.userEmailIndex(PENDING_INVITE.email),
        PENDING_INVITE.invitedBy, hash,
      ],
    );

    await db.query('COMMIT');

    deliverInvitation({
      invitationId: invRows[0].id,
      to: PENDING_INVITE.email,
      tenantName: PENDING_INVITE.tenantName,
      token,
      expiresAt: new Date(invRows[0].expires_at),
    });
    console.log(`  -> 1 undangan PENDING di Tenant Alpha; tautannya di ${outboxDir()}`);
    // Jumlah saja, bukan daftar email: keluaran seed juga bukan tempat data pribadi.
    console.log(`  -> ${createdKeys} kunci baru, ${USERS.length} identitas, ${MEMBERSHIPS.length} profil (terenkripsi)`);
    console.log(`  -> ${ROLE_CODES.length} role sistem per tenant, ${ASSIGNMENTS.length} penugasan role`);
    console.log(`${USERS.length} identitas demo siap dipakai login.`);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => failWithExplanation(error));
