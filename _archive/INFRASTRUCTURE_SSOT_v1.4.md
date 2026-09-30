---
title: "Infrastructure SSOT — Next.js + NestJS + PostgreSQL"
document_id: "INFRASTRUCTURE-SSOT"
version: "1.4"
status: "SUPERSEDED"
original_status: "SaaS Multi-Tenant and PDP Encryption Baseline Adopted / v1.4 Revisions Proposed / Implementation and Specialist Review Pending"
superseded_by: "INFRASTRUCTURE_SSOT_v1.5.md"
superseded_date: "2026-09-16"
supersedes: "INFRASTRUCTURE_SSOT_v1.3.md"
related_documents:
  - "ADR-001-SAAS-MULTI-TENANCY_v1.2.md"
  - "ADR-002-IDENTITY-MODEL_v1.0.md"
  - "ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.0.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md"
  - "GENERAL_FEATURE_BASE_SSOT_v1.3.md"
review_reference: "REVIEW_BASELINE_DOCS_2026-09-16.md"
owner: "<OWNER_PLACEHOLDER>"
last_updated: "2026-09-16"
baseline_date: "2026-09-16"
architecture: "Modular Monolith"
environment_scope: "Windows Local Development -> Linux VPS Production"
change_control: "Architecture-first: setiap perubahan arsitektur, baseline teknologi, port, struktur folder, environment, security, phase gate, atau acceptance criteria MUST diperbarui dan disetujui di SSOT ini sebelum implementasi."
---

> ⚠️ **SUPERSEDED — ARSIP, BUKAN DOKUMEN AKTIF.**
> Versi berlaku: [`INFRASTRUCTURE_SSOT_v1.5.md`](./INFRASTRUCTURE_SSOT_v1.5.md). Lihat `DOCUMENT_VERSION_INDEX.md`.
> Isi dan referensi versi di bawah bersifat historis dan **tidak boleh** dijadikan dasar implementasi, ticket, atau review.

# Infrastructure SSOT v1.4

> **Perubahan v1.4:** `platform_role_assignments` dan `support_sessions` masuk Table Ownership Register; bootstrap superadmin; context kind `support`; acceptance Phase 7 untuk superadmin/break-glass (ADR-003).

> **Perubahan v1.3:** Table Ownership Register menggantikan daftar tabel awal yang bertentangan (§8.3); tiga database role (§8.1); pre-context access path (§8.7.1); pola Prisma + RLS (§8.7.2); aturan scaffold frontend pada phase order (§2, §15); catatan kompatibilitas NestJS 12 dan patch Next.js Windows (§4.2); tafsir KMS untuk VPS (§12.1); struktur `docs/` (§6).

## 1. Status dan otoritas dokumen

Dokumen ini adalah **single source of truth (SSOT)** untuk fondasi infrastruktur aplikasi berbasis Next.js, NestJS, dan PostgreSQL. Jika README, ticket, source code, deployment script, konfigurasi environment, atau dokumen lain bertentangan dengan file ini, konflik harus dihentikan dan diselesaikan melalui change control; implementasi tidak boleh diam-diam menjadi sumber keputusan baru.

> **Aturan utama:** perubahan arsitektur harus diperbarui dan disetujui di file ini lebih dahulu, baru diterapkan ke codebase, database, CI/CD, atau production.

Baseline versi dalam dokumen ini adalah keputusan bertanggal **2026-09-16**. Nomor versi tidak otomatis berubah mengikuti rilis terbaru. Upgrade dependency wajib melalui compatibility test dan perubahan SSOT.

### 1.1 Change control

Setiap perubahan terkontrol wajib:

1. menjelaskan alasan, scope, risiko, security impact, migration/rollback, dan compatibility impact;
2. memperbarui bagian terkait dalam dokumen ini dan menaikkan versi dokumen secara semantik;
3. memperoleh persetujuan owner/otoritas teknis yang ditetapkan proyek;
4. diterapkan melalui pull request yang menautkan perubahan SSOT/ADR;
5. lulus build, test, migration check, dan smoke test yang relevan;
6. mencatat tanggal, approver, dan ringkasan pada change log.

Perubahan besar seperti microservices, GraphQL, database tambahan, direct database access dari Next.js, package manager lain, atau major-version upgrade tidak boleh dilakukan hanya melalui perubahan kode.

### 1.2 Istilah normatif

- **MUST / WAJIB**: persyaratan wajib.
- **MUST NOT / DILARANG**: tidak boleh dilanggar.
- **SHOULD / SEBAIKNYA**: default yang hanya boleh dikesampingkan dengan alasan terdokumentasi.
- **MAY / BOLEH**: opsional.

## 2. Purpose dan prinsip implementasi

Tujuan SSOT ini adalah membuat environment reproducible, responsibility tiap layer jelas, dependency terkunci, proses debugging terisolasi, dan fondasi dapat berkembang tanpa memulai dari microservices.

Urutan implementasi wajib:

```text
Environment -> Database -> Backend -> ORM -> API -> Frontend -> Authentication -> Domain
```

Business feature tidak boleh dimulai sebelum phase gate sebelumnya lulus dan bukti verifikasinya dicatat.

**Klarifikasi v1.3:** scaffold aplikasi (repository, build/lint pipeline, application shell tanpa integrasi API) untuk frontend **boleh** dibuat pada Sprint/Phase awal agar quality gate dapat disiapkan. Integrasi frontend ke API, halaman fungsional, dan authentication UI tetap mengikuti urutan phase dan tidak boleh mendahului Phase 4 (tenant isolation) dan Phase 5 (API contract).

## 3. Keputusan arsitektur

Arsitektur yang dipilih adalah **modular monolith** dalam satu repository, dengan frontend dan backend sebagai dua aplikasi Node.js terpisah.

```text
Browser
   |
   | HTTPS
   v
Next.js
Presentation Layer
   |
   | REST / JSON
   v
NestJS
Application + Domain Layer
   |
   v
Prisma
Persistence Adapter
   |
   v
PostgreSQL
Data Layer
```

### 3.1 Tanggung jawab layer

| Layer | Tanggung jawab |
|---|---|
| Next.js | App Router, page/layout, UI component, form, navigation, loading/error/empty state, accessibility, SEO, dan UI state |
| NestJS | REST controller, business rule, authentication, authorization, validation, transaction boundary, audit, logging, dan repository orchestration |
| Prisma | Persistence adapter, type-safe database access, dan migration |
| PostgreSQL | Relational data, constraints, indexes, transaction, dan durable storage |

### 3.2 Aturan akses data

Alur yang diizinkan:

```text
Browser -> Next.js -> NestJS -> Prisma -> PostgreSQL
```

Alur berikut dilarang:

```text
Next.js -> PostgreSQL
Next.js -> Prisma
Browser -> PostgreSQL
Controller -> Prisma secara langsung
```

- PostgreSQL hanya boleh diakses backend NestJS.
- Next.js tidak memiliki Prisma client atau `DATABASE_URL`.
- Business logic dan authorization wajib berada di NestJS.
- Menyembunyikan UI di frontend bukan security boundary.
- Repository layer memisahkan service/domain logic dari ORM.

### 3.3 Batas scope v1.4

Baseline tidak memasukkan microservices, GraphQL, Nx/Turborepo, Redis, queue, WebSocket, microfrontend, atau state-management library global. Baseline **memasukkan SaaS multi-tenancy** dengan shared database/shared schema, mandatory tenant context, dan PostgreSQL Row-Level Security (RLS). Penambahan komponen lain hanya dilakukan saat ada kebutuhan terukur dan melalui change control.

## 4. Technology baseline

| Komponen | Baseline v1.4 | Policy |
|---|---|---|
| Runtime | Node.js 24 LTS; recommended pin `24.21.x` | Dev, CI/CD, dan production memakai major yang sama |
| Package manager | npm bawaan Node 24 | Tidak mencampur npm, pnpm, Yarn, atau Bun |
| Language | TypeScript 5.x | Version dikunci melalui lockfile |
| Frontend | Next.js 16.x, minimum baseline security patch `16.3.3` | App Router; gunakan patch aman terbaru yang kompatibel dalam major 16 |
| React | Versi yang didukung/bundled Next.js 16 | Jangan override tanpa compatibility test |
| Backend | NestJS 12.x | ESM, REST API, OpenAPI/Swagger |
| Database | PostgreSQL 18.6 / major 18 | PostgreSQL 19 beta tidak digunakan |
| ORM | Prisma 7 GA | PostgreSQL driver adapter `@prisma/adapter-pg` |
| Reverse proxy | Nginx | Terminasi HTTPS dan routing production |

Backend `package.json` wajib memuat:

```json
{
  "type": "module"
}
```

### 4.1 Dependency policy

- `package.json` dan `package-lock.json` wajib di-commit.
- Nilai `latest` tidak boleh dipertahankan sebagai versi permanen.
- Frontend dan backend masing-masing memiliki lockfile karena merupakan aplikasi Node.js terpisah.
- Upgrade dependency harus disengaja: update SSOT bila mengubah baseline, install, test, build, security review, smoke test, lalu commit lockfile.
- Prisma 8 bukan dependency mandatory v1.4. Upgrade dipertimbangkan pada versi berikutnya setelah status GA dan compatibility diverifikasi terhadap dokumentasi versi yang digunakan.

### 4.2 Catatan verifikasi versi (baru v1.3, dicek 2026-09-16)

| Komponen | Status | Tindakan |
|---|---|---|
| Next.js `16.3.3` | Terverifikasi: security release 2026-08-25 memperbaiki RCE kritis, termasuk satu yang hanya berdampak pada server Next.js di filesystem Windows | Minimum `16.3.3` wajib juga di **development Windows**; dev server tidak boleh diekspos ke jaringan lain; pantau security release bulanan |
| NestJS 12 | Terverifikasi: dirilis 2026-08-28, ESM-first, Node ≥ 20.19/22.12 | Sprint 0 wajib compatibility check untuk `@nestjs/swagger`, `@nestjs/throttler`, `@nestjs/jwt`/passport, `@nestjs/config`, dan library pihak ketiga; bila blocker, fallback ke NestJS 11 melalui change control |
| PostgreSQL 18.6 | Terverifikasi (rilis Agustus 2026) | — |
| Prisma 7 + `@prisma/adapter-pg` | Belum diverifikasi detail | Diverifikasi di spike DEMO-0100 |
| Node.js 24 LTS `24.21.x` | Belum diverifikasi detail | Diverifikasi di DEMO-0001 |

## 5. Port dan endpoint baseline

| Service | Port | Endpoint lokal |
|---|---:|---|
| Next.js | 3000 | `http://localhost:3000` |
| NestJS | 4000 | `http://localhost:4000` |
| Swagger | melalui 4000 | `http://localhost:4000/docs` |
| Backend health | melalui 4000 | `http://localhost:4000/api/v1/health` |
| PostgreSQL | 5432 | `localhost:5432` |
| Future Redis (reserved, not in v1.4) | 6379 | Belum diaktifkan |

NestJS tidak boleh menggunakan default port 3000. Perubahan port wajib diperbarui di SSOT, environment template, reverse proxy, health check, dan dokumentasi operasi.

## 6. Struktur repository

Root baseline Windows:

```text
D:\projects\<project-name>\
|
+-- frontend\
|   +-- src\
|   +-- public\
|   +-- package.json
|   +-- package-lock.json
|   +-- next.config.ts
|   +-- tsconfig.json
|   +-- .env.local
|   +-- .env.example
|
+-- backend\
|   +-- prisma\
|   +-- src\
|   +-- test\
|   +-- package.json
|   +-- package-lock.json
|   +-- nest-cli.json
|   +-- tsconfig.json
|   +-- .env
|   +-- .env.example
|
+-- docs\
|   +-- ssot\          (Infrastructure, General Feature Base, Data Protection)
|   +-- adr\           (ADR-001, ADR-002, ...)
|   +-- delivery\      (Demo Foundation, Sprint Plan)
|   +-- registers\     (Table Ownership, Pre-context Function, Data Field, RoPA)
|   +-- architecture\
|   +-- api\
|   +-- database\
|   +-- reviews\
|
+-- scripts\
+-- .gitignore
+-- DOCUMENT_VERSION_INDEX.md
+-- README.md
```

`DOCUMENT_VERSION_INDEX.md` adalah daftar versi dokumen yang berlaku. Dokumen versi lama dipertahankan sebagai arsip dan tidak boleh dirujuk oleh implementasi baru.

### 6.1 Backend: domain/module oriented

```text
backend/src/
+-- main.ts
+-- app.module.ts
+-- common/
|   +-- decorators/
|   +-- filters/
|   +-- guards/
|   +-- interceptors/
|   +-- pipes/
|   +-- utils/
+-- config/
+-- infrastructure/
|   +-- database/prisma/
|   +-- logging/
|   +-- security/
+-- modules/
    +-- health/
    +-- auth/
    +-- users/
    |   +-- dto/
    |   +-- entities/
    |   +-- users.controller.ts
    |   +-- users.service.ts
    |   +-- users.repository.ts
    |   +-- users.module.ts
    +-- audit/
```

Struktur global `controllers/`, `services/`, dan `repositories/` dilarang karena mengaburkan ownership domain.

### 6.2 Frontend

```text
frontend/src/
+-- app/
|   +-- layout.tsx
|   +-- page.tsx
|   +-- login/
|   +-- dashboard/
|   +-- users/
+-- components/
|   +-- ui/
|   +-- layout/
|   +-- forms/
+-- features/
+-- lib/
|   +-- api/
|   +-- auth/
|   +-- utils/
+-- types/
```

Server Components digunakan secara default sesuai Next.js; Client Components hanya untuk state, event handler, atau browser API.

## 7. Environment dan secret policy

### 7.1 Backend environment

File runtime lokal: `backend/.env`

```env
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://app_user:CHANGE_ME@localhost:5432/app_db
TENANCY_MODE=shared_schema_rls
PLATFORM_BASE_DOMAIN=localhost
JWT_ACCESS_SECRET=CHANGE_ME
JWT_REFRESH_SECRET=CHANGE_ME
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
FRONTEND_URL=http://localhost:3000
```

### 7.2 Frontend environment

File runtime lokal: `frontend/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
```

Frontend dilarang memiliki `DATABASE_URL`, `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, atau `POSTGRES_PASSWORD`.

### 7.3 Secret handling

- `.env`, `.env.local`, `.env.production`, dan `.env.development.local` tidak boleh masuk Git.
- Setiap aplikasi wajib menyediakan `.env.example` tanpa secret asli.
- Production secret harus disimpan di secret manager atau protected environment milik deployment platform.
- Secret tidak boleh ditulis di source code, image, log, ticket, atau dokumentasi.
- Secret rotation dan incident response harus tersedia sebelum production go-live.

Minimum `.gitignore`:

```gitignore
node_modules/
.next/
dist/
coverage/

.env
.env.*
!.env.example

*.log
.DS_Store
Thumbs.db
```

## 8. Database baseline

### 8.1 Logical structure dan identity

```text
PostgreSQL Server
`-- app_db
    `-- public
```

- Satu database dan schema `public` digunakan pada fase awal.
- SaaS menggunakan **shared database + shared schema**. Tenant-owned row wajib memiliki `tenant_id`.
- Application tidak boleh memakai superuser `postgres`.
- Baseline memisahkan tiga role (v1.3):

| Role | Fungsi | Login dari aplikasi runtime |
|---|---|---|
| `app_owner` | Owner schema/table, menjalankan migration | Tidak (hanya pipeline migration) |
| `app_auth_definer` | Owner fungsi `SECURITY DEFINER` pre-context (ADR-001 §3.7) | Tidak (`NOLOGIN`) |
| `app_user` | Runtime least privilege, `EXECUTE` pada fungsi pre-context | Ya |

- `app_user` tidak boleh menjadi table owner, tidak memiliki `BYPASSRLS`, dan tidak boleh memakai superuser.
- Table tenant-scoped wajib mengaktifkan dan memaksa RLS (`ENABLE ROW LEVEL SECURITY` dan `FORCE ROW LEVEL SECURITY`).
- Penyederhanaan owner/runtime menjadi satu account tidak diizinkan untuk environment yang menyimpan data multi-tenant riil.
- Port PostgreSQL production tidak boleh diekspos ke internet.

### 8.2 Naming dan identifier

- Table dan column memakai `snake_case`.
- Contoh: `users`, `user_roles`, `refresh_tokens`, `audit_logs`, `created_at`, `updated_at`, `deleted_at`.
- UUID digunakan untuk public/business identifier bila diperlukan.
- Naming campuran seperti `UserRoles`, `userRoles`, `tblUsers`, atau `T_USER` dilarang.

### 8.3 Table Ownership Register (revisi v1.3)

v1.2 menempatkan `sessions`, `refresh_tokens`, `audit_logs`, `roles`, dan `tenant_memberships` dalam daftar "global/control-plane", bertentangan dengan Demo Foundation. Register berikut adalah sumber kebenaran untuk tabel fondasi:

| Table | Class (ADR-001 §3.1) | `tenant_id` | RLS | Pre-context access |
|---|---|---|---|---|
| `tenants` | Tenant control-plane | Row identity (`id`) | Policy platform + baca baris sendiri | `auth.resolve_tenant_by_host`, `auth.list_active_memberships` |
| `tenant_domains` | Tenant control-plane | NOT NULL | Ya | `auth.resolve_tenant_by_host` |
| `tenant_settings` | Tenant-owned | NOT NULL | Ya | Tidak |
| `tenant_entitlements` | Tenant control-plane | NOT NULL | Ya; tulis hanya context platform | Tidak |
| `users` | Platform-global | Tidak | Tidak ada grant SELECT langsung ke `app_user`; akses via identity service/function | Identity lookup function |
| `credentials` | Platform-global secret | Tidak | Tidak ada grant langsung ke `app_user`; via auth function | Auth function |
| `tenant_memberships` | Tenant-owned | NOT NULL | Ya | `auth.list_active_memberships` |
| `tenant_member_profiles` | Tenant-owned | NOT NULL | Ya | Tidak |
| `user_invitations` | Tenant-owned | NOT NULL | Ya | Function penerimaan undangan (hash token) |
| `sessions` | Tenant-owned | NOT NULL | Ya | Refresh/revoke function |
| `refresh_tokens` | Tenant-owned | NOT NULL | Ya | `auth.find_refresh_token`, rotate/revoke |
| `permissions` | Platform-global catalog | Tidak | Read-only grant ke `app_user` | Tidak |
| `roles` | Tenant-owned | NOT NULL | Ya | Tidak |
| `role_permissions` | Tenant-owned | NOT NULL | Ya | Tidak |
| `user_role_assignments` | Tenant-owned | NOT NULL | Ya | Tidak |
| `menus`, `menu_permissions` | Mixed-ownership | NULL hanya baris platform | Ya (ADR-001 §3.8) | Tidak |
| `audit_logs` | Mixed-ownership | NULL hanya event platform/pre-context | Ya; `UPDATE/DELETE` di-revoke | `audit.write_pre_context_event` |
| `platform_role_assignments` | Platform-global | Tidak | Tidak ada grant langsung ke `app_user`; akses via platform authorization service | Platform role lookup function (dipakai guard) |
| `support_sessions` | Tenant control-plane | NOT NULL | Ya; policy per context `platform`/`tenant`/`support` (ADR-003 §2.4) | Tidak |

`tenant_role_assignments` (v1.2) **dihapus**; assignment role memakai satu tabel `user_role_assignments` berbasis `membership_id` (General Feature Base v1.3 §5.3).

Setiap tabel baru wajib ditambahkan ke register ini (atau register modul yang dirujuk) sebelum migration disetujui.

Tabel tenant-owned/domain wajib memiliki:

```text
tenant_id UUID NOT NULL
```

`organization` berada di dalam tenant dan tidak menggantikan security boundary tenant. Satu tenant dapat memiliki satu atau lebih organization. Domain table hanya ditambahkan setelah multi-tenant foundation dan isolation test lulus.

### 8.4 Migration dan data integrity

- Semua schema change harus melalui migration ter-versioning; perubahan manual production dilarang.
- Migration wajib memiliki forward plan, rollback/mitigation plan, backup consideration, dan data-integrity verification.
- Foreign key, unique constraint, nullability, index, cascade behavior, dan concurrency impact harus ditinjau eksplisit.
- Destructive migration memerlukan backup terverifikasi dan rehearsal di environment non-production.
- Migration status harus dapat diaudit dari repository dan deployment log.

### 8.5 Multi-tenant architecture decision

Model yang ditetapkan:

```text
SaaS Platform
`-- PostgreSQL app_db
    `-- public shared schema
        |-- global/control-plane tables
        `-- tenant-scoped tables with tenant_id + RLS
```

Keputusan ini bersifat normatif:

- satu deployment melayani banyak tenant independen;
- setiap tenant memiliki security dan data-isolation boundary sendiri;
- satu user boleh menjadi anggota lebih dari satu tenant melalui `tenant_memberships`;
- tenant aktif dipilih dari membership yang sah;
- `organization` adalah struktur bisnis di dalam tenant, bukan alias tenant;
- cross-tenant query dilarang pada request biasa;
- platform operation yang memerlukan cross-tenant access menggunakan jalur administratif khusus, permission eksplisit, reason, dan audit.

### 8.6 Tenant context resolution

Tenant context harus dibentuk server-side melalui alur berikut:

```text
verified host/domain or explicit tenant selector
  -> authenticated user/session
  -> active tenant membership
  -> signed token/session tenant claim
  -> NestJS TenantContext
  -> transaction-scoped PostgreSQL context
  -> RLS policy
```

Rules:

- `tenant_id` dari request body, query, atau arbitrary header tidak boleh dipercaya sebagai sumber otoritatif.
- Host/domain mapping harus unik dan terverifikasi melalui `tenant_domains`.
- Token/session menyimpan tenant claim yang ditandatangani dan berumur terbatas.
- Setiap request protected memverifikasi tenant berstatus `ACTIVE` dan membership masih aktif.
- Perubahan tenant menghasilkan token/session context baru; context tidak boleh diganti hanya dengan mengubah header.
- Endpoint platform-level harus terpisah jelas dari endpoint tenant-level.
- Request tanpa tenant context ke resource tenant-scoped ditolak fail-closed.

### 8.7 PostgreSQL Row-Level Security

RLS adalah defense-in-depth yang wajib, bukan pengganti filter aplikasi. Pola policy baseline:

```sql
ALTER TABLE example_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE example_records FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_example_records
ON example_records
USING (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);
```

Pada awal transaction, backend menetapkan context secara transaction-local:

```sql
SELECT set_config('app.current_tenant_id', '<verified-tenant-uuid>', true);
```

Implementation rules:

- operasi tenant-scoped dijalankan dalam transaction yang menetapkan context sebelum query;
- connection pooling tidak boleh membawa tenant context ke request berikutnya;
- `set_config(..., true)`/`SET LOCAL` wajib digunakan dalam transaction yang sama;
- raw query dibatasi dan wajib melewati tenant-aware repository;
- migration/maintenance role dipisahkan dari runtime role;
- background job menetapkan tenant context dari signed/validated job payload;
- test wajib membuktikan query tanpa context dan context tenant lain tidak dapat membaca/menulis row.

Detail integrasi Prisma transaction dan adapter perlu diverifikasi terhadap dokumentasi versi Prisma 7 yang benar-benar digunakan sebelum implementasi.

#### 8.7.1 Pre-context access path (baru v1.3)

Operasi yang terjadi sebelum tenant context terverifikasi (resolusi domain, login, daftar membership, refresh token, audit pre-context, penerimaan undangan) **hanya** boleh memakai fungsi `SECURITY DEFINER` sesuai ADR-001 §3.7 dan tercatat dalam `docs/registers/PRE_CONTEXT_FUNCTIONS.md`.

Dilarang:

- `BYPASSRLS` pada role apa pun yang dipakai aplikasi;
- koneksi `app_owner` dari aplikasi runtime;
- menonaktifkan `FORCE ROW LEVEL SECURITY`;
- klausa policy yang membuka akses ketika context kosong.

Context platform ditandai `app.context_kind = 'platform'` (transaction-local, diset oleh guard route platform) dan hanya berlaku untuk tabel control-plane/mixed-ownership sesuai policy.

Context support (`app.context_kind = 'support'`, v1.4) menetapkan `app.current_tenant_id` ke tenant support session sehingga RLS berlaku normal; scope READ_ONLY dipaksa `SET TRANSACTION READ ONLY` (ADR-003 §2.3).

Superadmin pertama dibuat dengan **bootstrap command** di server (CLI backend, idempotent, teraudit, memerlukan akses host), bukan melalui API publik atau seed production.

#### 8.7.2 Pola Prisma + RLS (baru v1.3)

- Prisma Migrate tidak merepresentasikan policy RLS, `FORCE`, function, dan grant pada schema model. Objek tersebut ditulis sebagai SQL di migration terversi (`prisma/migrations/*/migration.sql` atau folder SQL yang ditetapkan), dan **schema inspection test** (query `pg_policies`, `pg_class.relforcerowsecurity`, `pg_proc`, grant) wajib lulus di CI.
- Satu unit of work = satu interactive transaction; statement pertama `set_config('app.current_tenant_id', ..., true)`.
- Repository tenant-owned hanya menerima transaction client dari unit-of-work wrapper; akses Prisma client global ke tabel tenant-owned dilarang dan dideteksi test/lint.
- Tidak ada nested transaction; timeout ditetapkan eksplisit.
- Pola ini wajib dibuktikan spike (Sprint Plan v1.1 DEMO-0100) meliputi: RLS read/write, missing context, pool reuse dengan concurrency, interactive transaction multi-langkah, dan drift detection. Hasil negatif spike memicu revisi ADR.

### 8.8 Tenant-aware keys, relations, dan indexes

- Semua tenant-owned table memiliki `tenant_id UUID NOT NULL` dan foreign key ke `tenants(id)` sesuai lifecycle policy.
- Natural/business uniqueness selalu scoped, contoh `UNIQUE (tenant_id, code)`.
- Cross-table foreign key tenant-scoped harus mencegah relasi lintas tenant. Gunakan candidate key `(tenant_id, id)` dan composite foreign key `(tenant_id, parent_id)` bila applicable.
- Index access pattern umumnya diawali `tenant_id`, misalnya `(tenant_id, status, created_at)`.
- Public identifier tetap tidak boleh dipakai untuk mengabaikan tenant scope.
- Global table harus didaftarkan eksplisit; ketiadaan `tenant_id` bukan keputusan implisit.
- Global reference data dan tenant override harus dipisahkan agar tenant tidak dapat memodifikasi global row.

### 8.9 Tenant lifecycle dan provisioning

Lifecycle baseline:

```text
PROVISIONING -> ACTIVE -> SUSPENDED -> CLOSING -> ARCHIVED -> PURGED
                    ^         |
                    +---------+ (authorized reactivation)
```

Provisioning minimal bersifat idempotent dan membuat tenant, verified domain/slug, owner membership, default roles, default organization, settings, entitlements, dan audit event. Kegagalan provisioning harus dapat dilanjutkan atau di-rollback tanpa tenant setengah aktif.

Suspension memblokir tenant access tetapi tidak menghapus data. Purge hanya dapat dilakukan setelah retention, legal hold, export, approval, dan backup policy terpenuhi.

### 8.10 Isolation di luar database

- Cache key wajib diawali tenant identifier.
- Object storage menggunakan namespace `tenants/<tenant_id>/...` dan authorization saat download.
- Search document menyimpan tenant identifier dan difilter sebelum hasil dikembalikan.
- Report/export/job membawa tenant context tervalidasi dan diaudit.
- Webhook, integration credential, idempotency record, notification, outbox, dan dead-letter item memiliki tenant ownership.
- Log dan metric boleh memuat tenant identifier non-secret untuk correlation, tetapi tidak boleh memuat data tenant sensitif.
- Rate limit dan quota dapat diterapkan per tenant serta per identity.

### 8.11 Backup, restore, dan tenant portability

- Physical backup/PITR tetap dilakukan pada level database dan bukan bukti kemampuan restore satu tenant.
- SaaS wajib memiliki export tenant terotorisasi, tervalidasi, terenkripsi, dan dapat diaudit.
- Single-tenant restore pada shared database memerlukan prosedur logical extraction/replay dan rehearsal khusus untuk menghindari overwrite tenant lain.
- RPO, RTO, retention, encryption key, dan restore rehearsal tetap merupakan keputusan Operations/Security terpisah.
- Offboarding harus mencakup export, revocation, retention/legal hold, purge evidence, domain release, dan credential/integration cleanup.

## 9. API contract

Base path:

```text
/api/v1
```

Baseline endpoint:

```text
GET   /api/v1/health
POST  /api/v1/auth/login
POST  /api/v1/auth/refresh
POST  /api/v1/auth/logout
GET   /api/v1/users
GET   /api/v1/users/:id
POST  /api/v1/users
PATCH /api/v1/users/:id
```

Setiap endpoint wajib mendefinisikan route, HTTP method, request DTO, response schema, status code, authentication/authorization requirement, validation rule, error code, dan idempotency behavior bila relevan. List endpoint wajib mempertimbangkan pagination, filtering, dan bounded page size.

### 9.1 Response convention

Success:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request"
  }
}
```

Production response tidak boleh mengekspos SQL query, stack trace, database credential, internal path, access token, atau detail internal lain.

### 9.2 OpenAPI/Swagger

- Swagger development tersedia di `http://localhost:4000/docs`.
- OpenAPI adalah kontrak frontend-backend dan harus diperbarui bersama endpoint.
- Exposure Swagger di production harus dinonaktifkan atau dilindungi sesuai keputusan security sebelum go-live.

## 10. Health check

Endpoint pertama yang diselesaikan:

```text
GET /api/v1/health
```

Level 1:

```json
{
  "status": "ok"
}
```

Setelah database terintegrasi:

```json
{
  "status": "ok",
  "services": {
    "api": "up",
    "database": "up"
  }
}
```

Health response harus ringan dan tidak membocorkan credential, connection string, versi sensitif, atau internal topology.

## 11. Authentication dan authorization

```text
Browser -> Next.js -> POST /api/v1/auth/login -> NestJS
                                             |-- validate credentials
                                             |-- create short-lived access token
                                             `-- create/rotate refresh token
```

- Access token berumur pendek; baseline TTL `15m`.
- Refresh token baseline TTL `7d`, dirotasi, dapat dicabut, dan disimpan server-side dalam bentuk aman sesuai threat model.
- Refresh token untuk browser sebaiknya dikirim dengan cookie `HttpOnly`, `Secure` di production, dan `SameSite` yang sesuai alur aplikasi.
- Password wajib menggunakan password-hashing algorithm yang layak dan konfigurasi cost yang ditinjau.
- Authentication dan authorization sepenuhnya ditegakkan NestJS.
- RBAC/permission check dilakukan pada backend untuk setiap protected operation.
- Login, refresh, password reset, dan endpoint sensitif wajib diberi rate limit dan audit event.
- CSRF protection wajib dievaluasi jika cookie digunakan untuk authentication.

## 12. Security baseline

Kontrol minimum:

- HTTPS di production;
- Helmet/security headers;
- CORS allowlist; local origin hanya `http://localhost:3000`;
- tidak menggunakan `origin: *` bersama `credentials: true`;
- global DTO validation dengan unknown field handling yang aman;
- password hashing dan credential enumeration protection;
- `HttpOnly`, `Secure`, dan `SameSite` cookie sesuai environment;
- rate limiting untuk auth dan endpoint abuse-prone;
- parameterized database access melalui Prisma;
- secret berbasis environment/secret manager;
- restricted database account dan network access;
- dependency patching dan vulnerability review;
- audit logging untuk security-sensitive operation;
- authorization deny-by-default;
- request/body size limit dan safe error handling;
- backup, restore test, retention, dan incident-response readiness sebelum production.

### 12.1 PDP encryption baseline

Seluruh implementasi Data Pribadi wajib mengikuti `DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md`. Istilah "KMS/HSM" pada dokumen ini dibaca sesuai opsi KMS Data Protection SSOT v1.1 §9.2 (Vault/OpenBao Transit atau cloud KMS untuk production; local wrapped key hanya untuk demo synthetic):

- encryption in transit dan infrastructure encryption at rest untuk seluruh storage yang dapat memuat Data Pribadi;
- application field-level encryption untuk direct identifier dan Data Pribadi spesifik/high-risk;
- password dan non-retrievable token menggunakan one-way hash, bukan reversible encryption;
- envelope encryption dengan tenant/purpose key separation dan KEK di KMS/HSM;
- key, plaintext secret, dan plaintext Data Pribadi dilarang masuk source, `.env`, log, audit diff, error queue, analytics, atau test fixture;
- backup, replica, object storage, search storage, export artifact, dan disaster-recovery copy termasuk dalam encryption scope;
- setiap field personal wajib terdaftar dalam Data Field Register sebelum migration/API approval;
- field-encryption exception memerlukan expiry dan persetujuan Legal/DPO, Security, pemilik domain/data, serta Technical Approver.

## 13. Logging, audit, dan observability

`console.log()` bukan production logging strategy.

Minimum application log:

```text
timestamp
level
requestId
method
route
statusCode
duration
```

Setiap request sebaiknya memiliki `X-Request-ID`/correlation ID yang diteruskan dari edge ke NestJS dan log.

Dilarang mencatat password, access token, refresh token, authorization header, database password, secret, atau sensitive payload. Audit log harus membedakan actor, action, target, timestamp, result, dan context yang aman; audit log tidak menggantikan application log.

## 14. Production architecture

```text
                         INTERNET
                             |
                           HTTPS
                             |
                             v
                         +-------+
                         | Nginx |
                         +---+---+
                             |
                  +----------+----------+
                  |                     |
                  v                     v
              Next.js                NestJS
               :3000                  :4000
                                         |
                                         v
                                    PostgreSQL
                                      :5432
                                  private network
```

- Hanya Nginx yang menerima trafik internet publik.
- Port 3000 dan 4000 dibatasi sesuai topology deployment.
- Port 5432 tidak boleh public; hanya NestJS yang boleh terhubung.
- TLS termination, proxy header, request size, timeout, dan security header harus dikonfigurasi eksplisit.
- Process supervision, restart policy, health probe, log collection, database backup, dan restore drill wajib tersedia sebelum production acceptance.

## 15. Phase gates

Setiap phase harus selesai berurutan. Bukti minimal berupa command/output, test report, migration status, atau screenshot/HTTP response yang dapat ditelusuri ke commit.

### Phase 0 — Machine baseline

Validasi Windows:

```powershell
node -v
npm -v
psql --version
git --version
Get-Command node
Get-Command npm
Get-Command psql
Get-Command git
```

Acceptance criteria:

- Node 24.x, npm, PostgreSQL 18.x client, dan Git tersedia.
- Executable resolve ke installation yang memang dipilih.
- Tidak ada Node installation ganda yang ambigu.
- Versi aktual dicatat sebagai evidence.

### Phase 1 — PostgreSQL

Acceptance query:

```sql
SELECT version();
SELECT current_database();
SELECT current_user;
SELECT 1;
```

Acceptance criteria:

- PostgreSQL running dan port 5432 listening secara lokal.
- `app_db` tersedia.
- Application account dapat connect tanpa menggunakan superuser `postgres`.
- Semua acceptance query berhasil.
- Credential tidak tersimpan di Git.

### Phase 2 — NestJS bare backend

Backend dibuat tanpa Prisma lebih dahulu.

Acceptance criteria:

- NestJS start pada port 4000.
- `GET /api/v1/health` mengembalikan HTTP 200 dan `{"status":"ok"}`.
- Belum ada dependency PostgreSQL pada health level 1.
- Build dan lint backend lulus.
- Global error handling dan validation bootstrap tersedia atau dicatat sebagai pekerjaan gate berikutnya.

### Phase 3 — NestJS, Prisma, dan PostgreSQL

```text
NestJS -> Repository -> Prisma 7 -> @prisma/adapter-pg -> PostgreSQL 18
```

Acceptance criteria:

- Prisma dikonfigurasi sebagai ESM dan memakai adapter PostgreSQL yang disepakati.
- First migration berhasil dan tercatat di repository/database.
- Minimal table `users` terbentuk dengan constraint yang ditinjau.
- Backend dapat melakukan read/write terkontrol menggunakan `app_user`.
- Health dependency check melaporkan API dan database `up` tanpa membocorkan detail sensitif.
- Migration dapat dijalankan dari clean database; rollback/mitigation sudah didokumentasikan.

### Phase 4 — SaaS tenant isolation foundation

Acceptance criteria:

- `tenants`, domain/slug mapping, membership, tenant roles, settings, dan entitlements memiliki migration ter-versioning.
- Tenant context hanya berasal dari host/selector, authenticated session, dan membership yang tervalidasi.
- Runtime role bukan owner, bukan superuser, dan tidak memiliki `BYPASSRLS`.
- Semua tenant-owned table memiliki `tenant_id NOT NULL`, scoped unique constraint, tenant-safe foreign key, serta `ENABLE` dan `FORCE ROW LEVEL SECURITY`.
- Query/read/write tanpa tenant context ditolak.
- Tenant A tidak dapat membaca, membuat relasi, memperbarui, menghapus, mencari, mengunduh file, menjalankan report, atau mengekspor data Tenant B.
- Connection-pool reuse tidak menyebabkan tenant-context leakage.
- Provisioning idempotent menghasilkan tenant aktif beserta owner membership, organization default, role, settings, dan audit event.
- Suspension memblokir access tanpa menghapus data.
- Background job, object storage, cache, search, audit, webhook, outbox, notification, import/export, dan report menggunakan tenant namespace/context.
- Isolation test berjalan otomatis di CI dan menggunakan sedikitnya dua tenant dengan identifier yang sengaja mirip.

Tambahan acceptance v1.3:

- Pre-context Function Register lengkap; setiap fungsi punya test negatif (enumeration, hash salah, tenant suspended, token tenant lain).
- Schema inspection test untuk RLS/FORCE/function/grant lulus di CI.
- Mixed-ownership policy test lulus (tenant tidak menulis baris platform; context platform tidak membaca tenant-owned table).

### Phase 5 — API contract dan Swagger

Acceptance criteria:

- Base path `/api/v1` aktif.
- Endpoint awal memiliki DTO validation dan response/error convention konsisten.
- Swagger tersedia pada `/docs` di development.
- OpenAPI mendokumentasikan method, schema, status code, dan auth requirement.
- API smoke test lulus, termasuk validation failure dan unauthorized path.

### Phase 6 — Next.js dan API integration

Integrasi Next.js ke API dilakukan setelah backend/API sehat. Scaffold tanpa integrasi boleh lebih awal (§2).

Acceptance criteria:

- Next.js start pada port 3000.
- Frontend memakai `NEXT_PUBLIC_API_URL` dan tidak memiliki database credential atau Prisma.
- Halaman smoke test berhasil memanggil API NestJS.
- Loading, error, empty, dan success state tersedia.
- CORS hanya mengizinkan origin yang ditetapkan.
- Frontend build, lint, dan page smoke test lulus.

### Phase 7 — Authentication dan authorization

Acceptance criteria:

- Login valid dan invalid menghasilkan status/error yang benar tanpa credential enumeration.
- Access token expiry dan refresh-token rotation diuji.
- Logout/revocation bekerja.
- Protected endpoint menolak unauthenticated dan unauthorized request.
- Cookie flags sesuai environment; rate limit auth aktif.
- Password/token/authorization header tidak muncul di log.
- Security-sensitive action menghasilkan audit record.
- Tenant switch hanya berhasil untuk membership aktif dan menghasilkan tenant context/token baru.
- Platform admin tidak memperoleh implicit tenant data access; privileged access memerlukan permission, reason, bounded session, dan audit.
- (v1.4) Superadmin dan break-glass support session memenuhi test ADR-003 §5; MFA superadmin menjadi blocker production.

### Phase 8 — Domain readiness

Acceptance criteria:

- Phase 0-7 lulus dengan evidence.
- Infrastructure defects kritis/tinggi telah ditutup atau diterima secara formal.
- Domain module pertama memiliki owner, business rules, API contract, tenant-aware schema/migration plan, test plan, dan authorization matrix.
- Tenant isolation matrix untuk domain module lulus sebelum domain feature dianggap siap.
- Belum ada penambahan komponen di luar scope tanpa change control.

## 16. Quality dan merge gates

Sebelum merge ke `main`:

Backend wajib lulus:

```text
build
lint
unit test
API smoke/integration test
```

Frontend wajib lulus:

```text
build
lint
component/page smoke test
```

Database wajib lulus:

```text
migration succeeds from clean baseline
migration status tracked
constraints/indexes reviewed
rollback or mitigation documented
```

Minimum manual verification:

- frontend, API, health, dan Swagger berjalan pada port yang ditentukan;
- frontend hanya berkomunikasi dengan API;
- error response tidak membocorkan internal detail;
- secret scan dan dependency/security review tidak menemukan blocker;
- perubahan sesuai SSOT/ADR.

Build success saja tidak membuktikan runtime, security, database integrity, UX, accessibility, atau production acceptance.

## 17. Global acceptance criteria v1.4

Infrastructure v1.4 diterima hanya jika seluruh kondisi berikut terpenuhi:

- architecture boundary Next.js -> NestJS -> Prisma -> PostgreSQL terbukti di source dan runtime;
- version baseline dan lockfile konsisten dengan SSOT;
- port 3000, 4000, dan 5432 digunakan sesuai alokasi;
- repository/folder ownership sesuai struktur yang disepakati;
- environment template tersedia dan tidak ada secret di Git/frontend;
- health check API dan database lulus;
- migration dapat direproduksi dari database bersih;
- Swagger/OpenAPI sesuai endpoint aktual;
- authentication, authorization, rate limit, logging redaction, dan audit baseline lulus;
- frontend memiliki loading/error/empty/success state dan basic accessibility check;
- build, lint, automated test, dan manual smoke test frontend/backend lulus;
- PostgreSQL production tidak terekspos ke internet;
- shared-schema tenant isolation diberlakukan berlapis melalui application scope dan PostgreSQL RLS;
- runtime database role tidak dapat melewati RLS dan bukan table owner;
- tenant-aware constraint, foreign key, index, cache, file, search, job, integration, report, export, dan audit telah diverifikasi;
- automated cross-tenant leakage suite lulus untuk read, write, relation, search, file, report/export, background job, dan privileged access;
- Data Field Register tersedia dan mandatory encrypted field tidak tersimpan plaintext pada database, dump, backup, object storage, cache, search, queue, log, audit, analytics, atau export;
- KMS/HSM, tenant/purpose key separation, key versioning, rotation, fail-closed behavior, dan backup key recovery diuji;
- password/token hashing, masking, blind index, dan prohibited-storage controls sesuai Data Protection and Field Encryption SSOT;
- tenant provisioning, suspension, reactivation, offboarding, dan purge guard memiliki tested workflow;
- backup/restore, deployment, observability, dan rollback readiness terdokumentasi;
- evidence dan commit/release yang diuji dapat ditelusuri.

## 18. Definition of Done — Infrastructure v1.4

Infrastructure v1.4 dinyatakan **DONE** apabila:

1. semua Phase 0-7 yang applicable berstatus PASS dan memiliki evidence;
2. tidak ada acceptance criterion mandatory yang belum dipenuhi;
3. code, runtime configuration, migration, OpenAPI, README, dan SSOT konsisten;
4. seluruh dependency terkunci dan tidak ada unsupported/canary/beta component dalam production baseline;
5. semua secret dan credential dikelola di luar repository serta telah diperiksa kebocorannya;
6. security minimum, least privilege, logging redaction, rate limiting, dan audit trail telah diuji;
7. build/test/migration/smoke test dapat diulang oleh engineer lain dari documented baseline;
8. deployment dan rollback/mitigation procedure tersedia dan telah direhearsal sesuai risiko;
9. owner/approver yang berwenang memberi sign-off dan mencatatnya pada bagian approval;
10. setiap deviasi telah memiliki ADR/risk acceptance yang eksplisit—bukan asumsi diam-diam.
11. tenant isolation diuji pada database dan seluruh secondary surface, bukan hanya controller/API filter;
12. Security/Privacy dan Operations review untuk RLS, privileged access, backup/restore, offboarding, dan incident handling telah selesai sebelum production go-live.
13. Legal/DPO dan Security/Privacy review terhadap field classification, encryption matrix, key management, retention, export, dan exception telah selesai sebelum production go-live.

## 19. Approval record

| Role | Name | Decision | Date | Evidence/Reference |
|---|---|---|---|---|
| Document Owner | `<OWNER_PLACEHOLDER>` | Pending | — | — |
| Product/Architecture Direction | `<REQUESTER_PLACEHOLDER>` | Adopt SaaS multi-tenant and PDP field-encryption baseline | 2026-09-16 | ADR-001 + Data Protection and Field Encryption SSOT |
| Technical Approver | `<TECHNICAL_APPROVER_PLACEHOLDER>` | Pending | — | — |
| Security Reviewer | `<SECURITY_REVIEWER_PLACEHOLDER>` | Pending | — | — |
| Operations Reviewer | `<OPERATIONS_REVIEWER_PLACEHOLDER>` | Pending | — | — |

Adopsi arah SaaS multi-tenant bukan bukti technical validation, Security/Privacy approval, Operations readiness, atau production approval.

## 20. Change log

| Version | Date | Author | Summary | Approval |
|---|---|---|---|---|
| 1.0 | 2026-09-16 | `<AUTHOR_PLACEHOLDER>` | Initial SSOT berdasarkan Infrastructure Blueprint v1.0 | Pending |
| 1.1 | 2026-09-16 | `<AUTHOR_PLACEHOLDER>` | Menetapkan SaaS shared-database/shared-schema, mandatory tenant context, tenant-aware constraints, dan PostgreSQL RLS | Product/architecture direction adopted; specialist reviews pending |
| 1.2 | 2026-09-16 | `<AUTHOR_PLACEHOLDER>` | Menetapkan PDP field encryption, Data Field Register, KMS/envelope encryption, hashing, masking, dan plaintext leak gates | Product/architecture direction adopted; Legal/DPO and specialist reviews pending |
| 1.4 | 2026-09-16 | `<AUTHOR_PLACEHOLDER>` | Register `platform_role_assignments` & `support_sessions`; bootstrap superadmin; context `support`; acceptance ADR-003 | Proposed |
| 1.3 | 2026-09-16 | `<AUTHOR_PLACEHOLDER>` | Table Ownership Register; tiga DB role; pre-context path; pola Prisma+RLS & schema inspection; klarifikasi scaffold frontend; verifikasi versi (Next.js 16.3.3 Windows RCE, NestJS 12 compat); tafsir KMS VPS; struktur docs & version index | Proposed; Technical/Security pending |

## 21. Open decisions

Hal berikut tidak mengubah baseline v1.4 sampai disetujui melalui change control:

- nama proyek, database, dan domain production final;
- hosting/VPS provider dan secret manager;
- CI/CD platform;
- detail session store dan refresh-token persistence;
- pricing, subscription, metering, quota, dan commercial billing model;
- tenant custom domain verification dan certificate automation;
- privileged support access/break-glass operating procedure;
- single-tenant logical restore tooling dan portability format;
- backup retention/RPO/RTO;
- monitoring/alerting stack;
- Prisma 8 upgrade;
- Redis, queue, WebSocket, atau microservices.
- KMS opsi A/B (Data Protection SSOT v1.1 §9.2), cryptographic library, key-cache strategy, dan rotation interval — **harus diputuskan sebelum crypto adapter Sprint 1 dibekukan**.
- Fallback NestJS 11 bila compatibility check NestJS 12 gagal.
