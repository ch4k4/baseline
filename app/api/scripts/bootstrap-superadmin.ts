import { Client } from 'pg';
import { PasswordService } from '../src/auth/password.service.js';
import { failWithExplanation } from '../src/database/preflight.js';
import { kekPath, loadKek } from '../src/crypto/kek-source.js';
import { FieldCrypto, FIELDS } from '../src/crypto/field-crypto.js';
import { KeyRing, PLATFORM, Purpose, WrappedKeyLoader, WrappedKeyRow } from '../src/crypto/key-ring.js';

/**
 * Perintah bootstrap superadmin platform (ADR-003 sec.2.5, DEMO-0311).
 *
 * KENAPA INI SKRIP TERSENDIRI, bukan beberapa baris di dalam seed:
 * ADR-003 sec.2.5 menetapkan superadmin pertama dibuat lewat perintah di server
 * - sekali, idempoten, teraudit - dan BUKAN lewat API publik atau seed. Alasannya
 * bukan formalitas: hak ini yang paling besar di seluruh platform, jadi jalan
 * masuknya harus satu, terlihat, dan meninggalkan jejak. Menyeludupkannya ke
 * dalam seed juga akan membuat tes wajib ADR-003 sec.5 ("bootstrap command
 * idempotent dan teraudit") tidak punya objek untuk diuji.
 *
 * Yang dilakukan:
 *   1. memastikan identitas global superadmin ada (email terenkripsi, seperti
 *      identitas demo lain - dienkripsi DI SINI sebelum menyentuh database);
 *   2. memberi role platform_superadmin bila belum dipegang;
 *   3. mencatat platform.admin_granted lewat F-14 HANYA bila pemberian benar-
 *      benar terjadi.
 *
 * Idempoten berarti: dijalankan dua kali menghasilkan satu assignment aktif dan
 * SATU baris audit, bukan dua. Audit yang menggandakan diri akan membuat "berapa
 * kali hak ini pernah diberikan" tidak dapat dijawab dari audit - padahal itulah
 * pertanyaan yang audit ini ada untuk menjawab.
 *
 * Berjalan sebagai SUPERUSER, sama seperti seed: seluruh tabel memakai FORCE RLS
 * dan ini jalur provisioning, bukan jalur aplikasi. Skrip ini tidak pernah
 * dipanggil dari kode API.
 *
 * Data SINTETIS. Password demo tidak dipakai di mana pun selain mesin sendiri.
 */

const SUPERADMIN = {
  id: 'dddddddd-0000-0000-0000-000000000001',
  email: 'superadmin@demo.platform',
};

const ROLE_CODE = 'platform_superadmin';

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

  async version(
    purpose: Purpose,
    tenantId: string | null,
    version: number,
  ): Promise<WrappedKeyRow | null> {
    const { rows } = await this.db.query<WrappedKeyRow>(
      `SELECT key_version, wrapped_dek FROM crypto_keys
       WHERE purpose = $1 AND tenant_id IS NOT DISTINCT FROM $2 AND key_version = $3`,
      [purpose, tenantId, version],
    );
    return rows[0] ?? null;
  }
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

  try {
    // Kunci platform harus SUDAH ada: bootstrap tidak membuat KEK maupun DEK.
    // Kalau ia boleh membuatnya, menjalankan bootstrap di database yang salah
    // akan menghasilkan KEK yatim dan pesan kegagalan yang membingungkan nanti.
    const { rows: keys } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM crypto_keys WHERE tenant_id IS NULL AND status = 'ACTIVE'`,
    );
    if (keys[0].n === 0) {
      console.error('Belum ada kunci platform. Jalankan seed identitas lebih dulu.');
      process.exit(2);
    }

    const crypto = new FieldCrypto(new KeyRing(loadKek(), new SuperuserKeyLoader(db)));
    const passwords = new PasswordService();

    await db.query('BEGIN');

    const email = await crypto.encrypt(FIELDS.userEmail, PLATFORM, SUPERADMIN.id, SUPERADMIN.email);
    await db.query(
      `INSERT INTO users (id, email_ciphertext, email_key_version, email_blind_index)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         email_ciphertext = EXCLUDED.email_ciphertext,
         email_key_version = EXCLUDED.email_key_version,
         email_blind_index = EXCLUDED.email_blind_index,
         updated_at = now()`,
      [
        SUPERADMIN.id,
        email.ciphertext,
        email.keyVersion,
        await crypto.userEmailIndex(SUPERADMIN.email),
      ],
    );
    await db.query(
      `INSERT INTO credentials (user_id, password_hash) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [SUPERADMIN.id, await passwords.hash(plain)],
    );

    // Pemberian hak: satu-satunya bagian yang tidak boleh berulang. Index unik
    // parsial di database yang menegakkannya; ON CONFLICT DO NOTHING hanya
    // menjadikan kegagalan itu tenang, bukan yang mencegahnya.
    const granted = await db.query(
      `INSERT INTO platform_role_assignments (user_id, role_code, reason)
       VALUES ($1, $2, 'Bootstrap superadmin pertama (ADR-003 sec.2.5)')
       ON CONFLICT (user_id, role_code) WHERE revoked_at IS NULL DO NOTHING
       RETURNING id`,
      [SUPERADMIN.id, ROLE_CODE],
    );

    // Audit hanya bila memang ada yang berubah. granted_by NULL dan sengaja:
    // pemberian ini tidak punya pelaku di dalam aplikasi - yang melakukannya
    // adalah orang dengan akses ke server, dan itulah yang dicatat di detail.
    if (granted.rowCount === 1) {
      await db.query(
        `SELECT auth.write_audit_event($1, $2, NULL, NULL, NULL, NULL, $3, $4, $5::jsonb)`,
        [
          'platform.admin_granted',
          'SUCCESS',
          'PLATFORM_ROLE_ASSIGNMENT',
          granted.rows[0].id,
          JSON.stringify({ roleCode: ROLE_CODE, via: 'BOOTSTRAP' }),
        ],
      );
    }

    await db.query('COMMIT');

    console.log(`  -> KEK demo: ${kekPath()}`);
    console.log(
      granted.rowCount === 1
        ? `  -> superadmin platform dibuat dan hak ${ROLE_CODE} diberikan (teraudit)`
        : `  -> superadmin platform sudah ada; tidak ada perubahan, tidak ada audit baru`,
    );
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => failWithExplanation(error));
