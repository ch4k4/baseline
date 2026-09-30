import { defineConfig } from 'prisma/config';

/**
 * Konfigurasi CLI Prisma (generate, db pull, migrate diff). Klien runtime TIDAK
 * membaca berkas ini: koneksinya dibuat di src/db.ts dari pool pg yang sama.
 *
 * CLI terhubung sebagai app_owner (pemilik tabel) hanya untuk introspeksi.
 * Aplikasi tidak pernah memakai app_owner.
 */
const host = process.env.DEMO_DB_HOST ?? '127.0.0.1';
const port = process.env.DEMO_DB_PORT ?? '5432';
const db = process.env.DEMO_DB_NAME ?? 'saas_demo';
const pw = encodeURIComponent(process.env.DEMO_DB_OWNER_PASSWORD ?? 'devowner');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: `postgresql://app_owner:${pw}@${host}:${port}/${db}` },
});
