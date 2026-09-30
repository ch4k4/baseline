---
title: "Infrastructure SSOT — Next.js + NestJS + PostgreSQL"
document_id: "INFRASTRUCTURE-SSOT"
edition: "2.10 (consolidated final)"
status: "Consolidated Baseline — Proposed; specialist approval pending"
owner: "<OWNER_PLACEHOLDER>"
last_updated: "2026-09-29"
architecture: "Modular Monolith"
environment_scope: "Windows Local Development -> Linux VPS Production"
related_documents:
  - "README.md"
  - "ARCHITECTURE_DECISIONS.md"
  - "GENERAL_FEATURE_BASE_SSOT.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT.md"
  - "SAAS_DEMO_FOUNDATION_SSOT.md"
  - "SAAS_DEMO_SPRINT_PLAN.md"
supersedes_archive: "_archive/ (INFRASTRUCTURE_SSOT v1.2–v1.5)"
change_control: "Perubahan normatif MUST diperbarui di dokumen ini sebelum implementasi dan dicatat di bagian Riwayat serta README.md §5."
---

# Infrastructure SSOT

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

Scaffold aplikasi (repository, build/lint pipeline, application shell tanpa integrasi API) untuk frontend **boleh** dibuat pada Sprint/Phase awal agar quality gate dapat disiapkan. Integrasi frontend ke API, halaman fungsional, dan authentication UI tetap mengikuti urutan phase dan tidak boleh mendahului Phase 4 (tenant isolation) dan Phase 5 (API contract).

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

### 3.3 Batas scope

Baseline tidak memasukkan microservices, GraphQL, Nx/Turborepo, Redis, queue, WebSocket, microfrontend, atau state-management library global. Baseline **memasukkan SaaS multi-tenancy** dengan shared database/shared schema, mandatory tenant context, dan PostgreSQL Row-Level Security (RLS). Penambahan komponen lain hanya dilakukan saat ada kebutuhan terukur dan melalui change control.

## 4. Technology baseline

| Komponen | Baseline | Policy |
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
- Prisma 8 bukan dependency mandatory pada baseline ini. Upgrade dipertimbangkan pada versi berikutnya setelah status GA dan compatibility diverifikasi terhadap dokumentasi versi yang digunakan.

### 4.2 Catatan verifikasi versi

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
| Future Redis (reserved, belum dalam baseline) | 6379 | Belum diaktifkan |

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
+-- README.md
+-- README.md
```

`README.md` adalah daftar versi dokumen yang berlaku. Dokumen versi lama dipertahankan sebagai arsip dan tidak boleh dirujuk oleh implementasi baru.

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
    +-- auth/            (login, select-context, refresh, logout; memanggil fungsi register)
    +-- identity/        (identitas global; tanpa controller tenant)
    +-- tenancy/
    +-- members/
    |   +-- dto/
    |   +-- entities/
    |   +-- members.controller.ts
    |   +-- members.service.ts
    |   +-- members.repository.ts
    |   +-- members.module.ts
    +-- platform/        (superadmin, support session)
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
- Baseline memisahkan tiga role:

| Role | Fungsi | Login dari aplikasi runtime |
|---|---|---|
| `app_owner` | Owner schema/table, menjalankan migration | Tidak (hanya pipeline migration) |
| `app_auth_definer` | Owner fungsi `SECURITY DEFINER` terdaftar; `NOBYPASSRLS`; akses baris **hanya** melalui policy `TO app_auth_definer` + grant kolom (Opsi A) | Tidak (`NOLOGIN`) |
| `app_user` | Runtime least privilege, `EXECUTE` pada fungsi terdaftar; bukan member `app_auth_definer` | Ya |

- Fungsi, policy `TO app_auth_definer`, dan grant kolom ditetapkan **hanya** di `ARCHITECTURE_DECISIONS.md` Lampiran A. Schema inspection test menggagalkan build bila database berbeda dari register.

- `app_user` tidak boleh menjadi table owner, tidak memiliki `BYPASSRLS`, dan tidak boleh memakai superuser.
- Table tenant-scoped wajib mengaktifkan dan memaksa RLS (`ENABLE ROW LEVEL SECURITY` dan `FORCE ROW LEVEL SECURITY`).
- Penyederhanaan owner/runtime menjadi satu account tidak diizinkan untuk environment yang menyimpan data multi-tenant riil.
- Port PostgreSQL production tidak boleh diekspos ke internet.

### 8.2 Naming dan identifier

- Table dan column memakai `snake_case`.
- Contoh: `users`, `user_roles`, `refresh_tokens`, `audit_logs`, `created_at`, `updated_at`, `deleted_at`.
- UUID digunakan untuk public/business identifier bila diperlukan.
- Naming campuran seperti `UserRoles`, `userRoles`, `tblUsers`, atau `T_USER` dilarang.

### 8.3 Table Ownership Register

Register berikut adalah sumber kebenaran klasifikasi tabel fondasi. Dokumen lain (termasuk SaaS Demo Foundation §7.2) tidak boleh berbeda dari register ini.

Kolom "Register" merujuk ID fungsi pada `ARCHITECTURE_DECISIONS.md` Lampiran A (sumber tunggal).

| Table | Class (ADR-001 §3.1) | `tenant_id` | RLS untuk `app_user` | Register |
|---|---|---|---|---|
| `tenants` | Tenant control-plane | Row identity (`id`) | Policy platform + baca baris sendiri | F-01, F-04, F-11, F-12, F-16 |
| `tenant_domains` | Tenant control-plane | NOT NULL | Ya | F-01 |
| `tenant_settings` | Tenant-owned | NOT NULL | Ya | — |
| `tenant_entitlements` | Tenant control-plane | NOT NULL | Ya; tulis hanya context platform | — |
| `users` | Platform-global | Tidak | Tidak ada grant ke `app_user` | F-02, F-12, F-16 (identity service lain via fungsi terdaftar) |
| `credentials` | Platform-global secret | Tidak | Tidak ada grant ke `app_user` | F-02, F-03, F-16 |
| `tenant_memberships` | Tenant-owned | NOT NULL | Ya | F-04, F-06, F-12, F-15 |
| `tenant_member_profiles` | Tenant-owned | NOT NULL | Ya | F-12 |
| `user_invitations` | Tenant-owned | NOT NULL | Ya | F-11, F-12, F-16 |
| `invitation_roles` | Tenant-owned | NOT NULL | Ya | F-12 |
| `auth_selection_tickets` | Platform-global (transient) | Tidak | Tidak ada grant ke `app_user` | F-05, F-06 |
| `sessions` | Mixed-ownership (`context_kind` TENANT/PLATFORM) | NOT NULL untuk TENANT; NULL untuk PLATFORM | Ya untuk baris TENANT; baris PLATFORM tidak terbaca `app_user` | F-07, F-08, F-09, F-10 |
| `refresh_tokens` | Mixed-ownership (idem) | idem | idem | F-07, F-08, F-09, F-10 |
| `permissions` | Platform-global catalog | Tidak | Read-only grant ke `app_user` | — |
| `roles` | Tenant-owned | NOT NULL | Ya | — |
| `role_permissions` | Tenant-owned | NOT NULL | Ya | — |
| `user_role_assignments` | Tenant-owned | NOT NULL | Ya | F-12 |
| `menus`, `menu_permissions` | Mixed-ownership | NULL hanya baris platform; ownership dimaterialisasi kolom `owner_key` (generated) | `SELECT` saja untuk `app_user`, dengan policy terpisah per context (`tenant`+`support` membaca baris `context_kind = 'TENANT'`; `platform` membaca baris `PLATFORM`). Tidak ada grant INSERT/UPDATE/DELETE bagi siapa pun di runtime: administrasi menu adalah P2 | F-20 |
| `audit_logs` | Mixed-ownership | NULL hanya event platform/pre-context | Ya; `UPDATE/DELETE` di-revoke | F-14 |
| `audit_event_types` | Platform-global catalog | Tidak | Read-only grant ke `app_user`; tanpa grant tulis untuk siapa pun | — |
| `crypto_keys` | Mixed-ownership | NULL hanya kunci platform | Tidak ada grant ke `app_user`; DEK tersimpan terbungkus KEK (Data Protection §9) | — |
| `platform_role_assignments` | Platform-global | Tidak | `app_user` punya SELECT/INSERT/UPDATE, tetapi seluruh policy mensyaratkan `app_context_kind() = 'platform'`, sehingga session tenant mendapat nol baris; kolom `revoked_at`/`revoked_by` saja yang dapat di-UPDATE | F-04, F-07, F-13 |
| `role_templates`, `role_template_permissions` | Platform-global catalog | Tidak | Read-only untuk `app_user` dan hanya pada context platform; tanpa grant tulis bagi siapa pun (diubah lewat migration). Dibaca peran definer untuk F-27 | F-27 |
| `schema_migrations` | Infrastructure (ledger §8.4.1) | Tidak | Tidak ada grant untuk `app_user` maupun peran definer; TANPA RLS, karena penulisnya adalah pemilik tabel dan `FORCE` hanya akan mengunci penulisnya sendiri | — |
| `platform_role_permissions` | Platform-global catalog | Tidak | Read-only untuk `app_user` dan hanya pada context platform; isinya diubah lewat migration, bukan runtime. FK `(permission_code, permission_scope)` menolak permission tenant di role platform | — |
| `support_sessions` | Tenant control-plane | NOT NULL | Ya, ENABLE + FORCE. Tiga policy `app_user`, satu per context: `platform` membaca semuanya dan hanya di sini baris dibuat; `tenant` membaca baris tenantnya (`app_context_kind() = 'tenant'`); `support` membaca HANYA barisnya sendiri (`id = app_support_session_id()`). `expires_at` tanpa grant UPDATE (sesi tidak dapat diperpanjang); UPDATE hanya `status`/`ended_at`/`ended_by`/`end_reason` dan satu arah (aktif -> berakhir) | F-18, F-19 |
| `tenant_notifications` | Tenant-owned | NOT NULL | Batas tenant dijaga RLS; syarat permission `audit.read` ditegakkan guard aplikasi (RLS tidak mengetahui membership pemanggil). `app_user` TIDAK punya grant INSERT sama sekali; UPDATE hanya `read_at`/`read_by_membership_id` dan hanya sekali jalan | F-15 |

Assignment role memakai **satu** tabel `user_role_assignments` berbasis `membership_id` (General Feature Base §5.3); tidak ada tabel `tenant_role_assignments`.

Setiap tabel baru wajib ditambahkan ke register ini (atau register modul yang dirujuk) sebelum migration disetujui.

Tabel tenant-owned/domain wajib memiliki:

```text
tenant_id UUID NOT NULL
UNIQUE (tenant_id, id)   -- candidate key untuk composite FK tenant-safe
```

**Aturan foreign key tenant-safe.** Setiap foreign key antar tabel tenant-owned atau mixed-ownership wajib composite dan menyertakan `tenant_id`, misalnya `FK (tenant_id, role_id) -> roles (tenant_id, id)`. RLS menyaring baris yang **terbaca**; RLS tidak mencegah satu baris menunjuk baris milik tenant lain. Foreign key tunggal ke `id` hanya boleh sebagai pelengkap untuk baris `PLATFORM` pada tabel mixed-ownership, karena composite FK dengan `tenant_id` NULL tidak dievaluasi (MATCH SIMPLE).

Constraint yang bersifat kondisional (misalnya "hanya satu assignment aktif") ditegakkan **partial unique index**, bukan `UNIQUE` biasa. Ownership scope yang tidak dapat dinyatakan satu kolom nullable ditegakkan kolom generated (`owner_key`), karena PostgreSQL tidak menerima ekspresi sebagai target foreign key maupun anggota unique constraint.

`organization` berada di dalam tenant dan tidak menggantikan security boundary tenant. Satu tenant dapat memiliki satu atau lebih organization. Domain table hanya ditambahkan setelah multi-tenant foundation dan isolation test lulus.

### 8.4 Migration dan data integrity

- Semua schema change harus melalui migration ter-versioning; perubahan manual production dilarang.
- Migration wajib memiliki forward plan, rollback/mitigation plan, backup consideration, dan data-integrity verification.
- Foreign key, unique constraint, nullability, index, cascade behavior, dan concurrency impact harus ditinjau eksplisit.
- Migration review menolak foreign key antar tabel tenant-owned yang tidak menyertakan `tenant_id` (§8.3), dan menolak constraint yang hanya dinyatakan sebagai prosa.
- Destructive migration memerlukan backup terverifikasi dan rehearsal di environment non-production.
- Migration status harus dapat diaudit dari repository dan deployment log.

#### 8.4.1 Ledger migrasi (wajib)

Status migrasi **tidak boleh** hanya berupa "berkas yang ada di repo". Database memuat ledger
`schema_migrations` (PK `(component, version)`), dan pemasang menjalankan HANYA migrasi yang
belum tercatat di sana.

| Aturan | Penegaknya |
|---|---|
| Satu implementasi pemasang untuk semua platform | `api/scripts/migrate.ts`; `db.ps1` dan `db.sh` memanggilnya, tidak menyalin logikanya |
| Migrasi yang sudah dipasang tidak boleh diedit | checksum sha256 per berkas di ledger; pemasang berhenti dengan pesan, dan `api/test/migration.test.ts` kasus 1 gagal |
| Nomor migrasi tidak boleh ganda | pemasang menolak; test kasus 2 |
| Satu transaksi per berkas | pemasang, kecuali berkas yang mengurus transaksinya sendiri (mis. yang melepas `FORCE` RLS sesaat) - berkas semacam itu dijalankan apa adanya dan dicatat sebagai demikian |
| Runtime tidak dapat menyentuh ledger | tanpa grant apa pun untuk `app_user`/`app_auth_definer`; test kasus 3 |
| Database lama dapat diadopsi | perintah `stamp`: mencatat seluruh berkas sebagai terpasang TANPA menjalankannya, dan menolak berjalan bila tabel inti belum ada |

Kolom `component` ada sejak awal karena baseline dipasang ke database tiap produk (ADR-001
§3.11): migrasi baseline dan migrasi produk berdampingan dengan urutan nomor masing-masing.
Perintah yang tersedia: `migrate` (pasang yang belum), `status` (apa yang sudah/belum, checksum
mana yang berubah), `stamp` (adopsi). Ketiganya juga tersedia lewat `db.ps1`/`db.sh`.

Yang **tidak** dijanjikan bagian ini: rollback otomatis. Migrasi turun (down migration) tidak
ada, dan tidak akan dipalsukan dengan skrip yang belum pernah dijalankan - mitigasi tetap
backup terverifikasi plus rehearsal (butir di atas).

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
- Setiap request protected memverifikasi tenant berstatus `ACTIVE` dan membership masih aktif. **Pengecualian:** context `support` boleh beroperasi pada tenant `SUSPENDED`, `CLOSING`, atau `ARCHIVED` dengan scope dipaksa READ_ONLY (ADR-003 §2.2 aturan 10); tenant `PURGED` selalu ditolak.
- Session memiliki `context_kind` (`TENANT` | `PLATFORM`); token context PLATFORM hanya diterima route `/platform/*` dan tidak membawa tenant claim. User dengan lebih dari satu context memilih melalui tiket pemilihan berumur ≤ 5 menit (ADR-003 §2.6).
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

#### 8.7.1 Pre-context access path

Operasi yang terjadi sebelum tenant context terverifikasi (resolusi domain, login, pemilihan context, refresh token, penerimaan undangan, audit pre-context) atau yang menulis lintas context (audit/notifikasi tenant dari context platform) **hanya** boleh memakai fungsi `SECURITY DEFINER` yang tercantum di `ARCHITECTURE_DECISIONS.md` Lampiran A (disalin ke `docs/registers/` saat repository dibuat).

fungsi milik `app_auth_definer` tetap tunduk pada RLS karena role tersebut bukan pemilik tabel dan tidak memiliki `BYPASSRLS`. Akses baris diberikan secara eksplisit dengan policy per tabel/operasi `TO app_auth_definer` dan grant kolom, sesuai register §4.

Dilarang:

- `BYPASSRLS` pada role apa pun yang dipakai atau dimiliki aplikasi, termasuk `app_auth_definer`;
- koneksi `app_owner` dari aplikasi runtime;
- menonaktifkan `FORCE ROW LEVEL SECURITY`;
- klausa policy untuk `app_user` yang membuka akses ketika context kosong;
- policy `TO app_auth_definer` atau fungsi `SECURITY DEFINER` yang tidak tercantum di register;
- membuat `app_user` member dari `app_auth_definer`.

Context platform ditandai `app.context_kind = 'platform'` (transaction-local, diset oleh guard route platform) dan hanya berlaku untuk tabel control-plane/mixed-ownership sesuai policy.

Context support (`app.context_kind = 'support'`) menetapkan `app.current_tenant_id` ke tenant support session sehingga RLS berlaku normal; scope READ_ONLY dipaksa `SET TRANSACTION READ ONLY` (ADR-003 §2.3).

GUC ketiga `app.support_session_id` ikut ditulis setiap transaksi (nilai kosong di luar sesi support) dan dibaca `app_support_session_id()`, yang **fail-closed**: nilai kosong menjadi NULL, dan NULL membuat setiap perbandingan `id = app_support_session_id()` bernilai NULL - nol baris, bukan semua baris. Tanpa GUC ini, sesi support akan melihat seluruh riwayat sesi tenant, bukan hanya sesinya sendiri.

`SET TRANSACTION READ ONLY` wajib mendahului query pertama transaksi - termasuk `set_config` - jadi urutan di unit of work adalah READ ONLY lalu GUC. Dipasang di tempat lain, ia diam-diam tidak berlaku.

Superadmin pertama dibuat dengan **bootstrap command** di server (CLI backend, idempotent, teraudit, memerlukan akses host), bukan melalui API publik atau seed production.

#### 8.7.2 Pola Prisma + RLS

- Prisma Migrate tidak merepresentasikan policy RLS, `FORCE`, function, dan grant pada schema model. Objek tersebut ditulis sebagai SQL di migration terversi (`prisma/migrations/*/migration.sql` atau folder SQL yang ditetapkan), dan **schema inspection test** (query `pg_policies`, `pg_class.relforcerowsecurity`, `pg_proc`, grant) wajib lulus di CI.
- Satu unit of work = satu interactive transaction; statement pertama `set_config('app.current_tenant_id', ..., true)`, bersama `app.context_kind`, `app.support_session_id`, `statement_timeout`, dan **`set_config('TimeZone','UTC', true)`**.
- **TimeZone WAJIB dipatok UTC di dalam unit of work.** Prisma membaca `timestamptz` dari query mentah sebagai jam dinding sesi database lalu melabelinya UTC; pada server dengan TimeZone bukan UTC, setiap nilai waktu yang dibaca aplikasi bergeser sebesar offset zona itu (terukur +7 jam pada TimeZone `Asia/Jakarta`, sementara node-postgres mengembalikan nilai yang benar). Pematokan ini transaction-local dan ditegakkan `lint:guc`; durasi apa pun yang dipakai untuk keputusan (umur token, sisa waktu sesi) dihitung DATABASE sebagai bilangan bulat detik, bukan dari pengurangan dua tanggal di aplikasi.
- **Zona waktu server database di lingkungan pengembangan dan demo dipatok BUKAN UTC** (`Asia/Jakarta`), oleh `db.sh`/`db.ps1` tepat setelah `CREATE DATABASE`. Cacat di atas tidak bergejala sama sekali pada server UTC, sehingga lingkungan pengembangan yang lebih "bersih" daripada mesin target tidak dapat menemukannya — itulah sebabnya pergeseran tujuh jam bertahan sejak slice 8 tanpa terlihat. Aturan ini pernah hanya berupa catatan di `app/AUDIT.md` dan hilang pada `reset` berikutnya; sekarang skrip yang menegakkannya. Pematokan UTC pada unit of work tetap wajib dan tidak digantikan olehnya.
- Repository tenant-owned hanya menerima transaction client dari unit-of-work wrapper; akses Prisma client global ke tabel tenant-owned dilarang dan dideteksi test/lint.
- Tidak ada nested transaction; timeout ditetapkan eksplisit.
- Pola ini wajib dibuktikan spike (Sprint Plan DEMO-0100) meliputi: RLS read/write, missing context, pool reuse dengan concurrency, interactive transaction multi-langkah, drift detection, **fungsi definer membaca lintas tenant via policy `TO app_auth_definer` sementara `app_user` tetap 0 baris**, dan deteksi `set_config('app.` di luar wrapper. Hasil negatif spike memicu revisi ADR.

#### 8.7.3 Batas kepercayaan tenant context

`app.current_tenant_id`, `app.context_kind`, dan `SET TRANSACTION READ ONLY` diset oleh aplikasi melalui `app_user`. RLS berbasis GUC melindungi dari **bug aplikasi** (filter terlewat, raw query tanpa filter), tetapi **tidak** dari kode yang memanggil `set_config` dengan nilai lain, SQL injection yang menjalankan statement arbitrer, atau kredensial `app_user` yang bocor (ADR-001 §3.10).

Kontrol wajib:

- lint CI: `set_config('app.` hanya di modul unit-of-work; raw SQL concatenation dilarang;
- `app_user` tanpa `CREATE`, `TRUNCATE`, `ALTER`, `REFERENCES`;
- telemetry/alert: query tenant-owned di luar wrapper; `context_kind = platform` dari route non-platform;
- threat model mencatat batas ini.

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
GET   /api/v1/auth/contexts          (hanya dengan tiket pemilihan)
POST  /api/v1/auth/select-context
POST  /api/v1/auth/refresh
POST  /api/v1/auth/logout
GET   /api/v1/me
GET   /api/v1/me/contexts
POST  /api/v1/me/context-switch
GET   /api/v1/members
GET   /api/v1/members/:membershipId
POST  /api/v1/invitations
POST  /api/v1/invitations/accept
GET   /api/v1/platform/tenants
```

Tidak ada endpoint `GET/POST/PATCH /api/v1/users`: tenant tidak membuat atau mengubah identitas global (ADR-002); administrasi dilakukan melalui `members` dan `invitations`. Kontrak lengkap endpoint demo ada di SaaS Demo Foundation SSOT.

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
                                             |-- validate credentials (Lampiran A F-02/F-03)
                                             |-- resolve contexts (F-04): TENANT memberships + PLATFORM role
                                             |-- 1 context  -> create session (F-07)
                                             |-- >1 context -> selection ticket (F-05) -> select-context (F-06, F-07)
                                             |-- create short-lived access token (context claim)
                                             `-- create/rotate refresh token (F-08, F-09)
```

- Session dan token memiliki `context_kind`; token PLATFORM ditolak di route tenant dan sebaliknya (ADR-003 §2.6).

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

Seluruh implementasi Data Pribadi wajib mengikuti `DATA_PROTECTION_ENCRYPTION_SSOT.md`. Istilah "KMS/HSM" pada dokumen ini dibaca sesuai opsi KMS Data Protection SSOT §9.2 (Vault/OpenBao Transit atau cloud KMS untuk production; local wrapped key hanya untuk demo synthetic):

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

Acceptance pre-context dan register:

- Register fungsi di `ARCHITECTURE_DECISIONS.md` Lampiran A lengkap; setiap fungsi punya test negatif (enumeration, hash salah, tenant suspended, token tenant lain).
- Schema inspection test untuk RLS/FORCE/function/grant lulus di CI.
- Mixed-ownership policy test lulus (tenant tidak menulis baris platform; context platform tidak membaca tenant-owned table).
- Register test CI (ARCHITECTURE_DECISIONS.md Lampiran A §5) lulus: fungsi terdaftar membaca/menulis lintas tenant melalui policy `TO app_auth_definer`; `app_user` tetap 0 baris tanpa context; tidak ada role runtime/auth dengan `BYPASSRLS`; tidak ada fungsi/policy di luar register.
- Constraint `sessions`/`refresh_tokens` (`context_kind` ↔ `tenant_id`) aktif; baris PLATFORM tidak terbaca dari context tenant.
- Lint `set_config('app.` dan raw SQL concatenation berjalan di CI.

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
- Superadmin dan break-glass support session memenuhi test ADR-003 §5; MFA superadmin menjadi blocker production.
- Superadmin tanpa membership dapat login ke context PLATFORM; user multi-context wajib memilih melalui tiket; token context salah route ditolak.

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

## 17. Global acceptance criteria

Infrastructure baseline diterima hanya jika seluruh kondisi berikut terpenuhi:

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

## 18. Definition of Done — Infrastructure

Infrastructure baseline dinyatakan **DONE** apabila:

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

## 21. Open decisions

Hal berikut tidak mengubah baseline sampai disetujui melalui change control:

- nama proyek, database, dan domain production final;
- hosting/VPS provider dan secret manager;
- CI/CD platform;
- detail session store dan refresh-token persistence (struktur `context_kind` sudah ditetapkan; TTL dan idle timeout masih terbuka);
- pricing, subscription, metering, quota, dan commercial billing model;
- tenant custom domain verification dan certificate automation;
- privileged support access/break-glass operating procedure;
- single-tenant logical restore tooling dan portability format;
- backup retention/RPO/RTO;
- monitoring/alerting stack;
- Prisma 8 upgrade;
- Redis, queue, WebSocket, atau microservices.
- KMS opsi A/B (Data Protection SSOT §9.2), cryptographic library, key-cache strategy, dan rotation interval — **harus diputuskan sebelum crypto adapter Sprint 1 dibekukan**.
- Fallback NestJS 11 bila compatibility check NestJS 12 gagal.

## Riwayat

| Edisi | Tanggal | Ringkasan |
|---|---|---|
| 2.0 | 2026-09-16 | Edisi final hasil konsolidasi dari Infrastructure SSOT v1.5; penanda revisi dan change log berlapis dihapus; isi normatif tidak diubah selain perapian rujukan. Riwayat keputusan: `README.md` §5; versi lengkap sebelumnya: `_archive/` |
| 2.1 | 2026-09-19 | §8.3: aturan foreign key tenant-safe (composite FK wajib menyertakan `tenant_id`, `UNIQUE (tenant_id, id)` sebagai candidate key, batas MATCH SIMPLE untuk baris PLATFORM), partial unique index untuk constraint kondisional, dan kolom generated `owner_key` untuk ownership scope; §8.4: migration review menolak FK tanpa `tenant_id` dan constraint berupa prosa |
| 2.2 | 2026-09-22 | Table Ownership Register: kolom fungsi pre-context untuk `tenants`, `users`, `credentials`, dan `user_invitations` mengikuti Lampiran A edisi 2.1 (F-16 baru; F-12 membaca `tenants` dan `users`). Tidak ada perubahan klasifikasi maupun kontrol |
| 2.3 | 2026-09-23 | Table Ownership Register: `audit_event_types` (katalog nama event audit, platform-global, read-only) ditambahkan; `audit_logs.event_type` memakai foreign key ke katalog itu. Keputusan pemilik proyek (D-30) |
| 2.10 | 2026-09-29 | §8.3: baris `role_templates`/`role_template_permissions` (katalog template role sistem, dibaca F-27) dan `schema_migrations` (ledger, tanpa RLS beserta alasannya) ditambahkan ke Table Ownership Register. Keputusan pemilik proyek (fondasi langkah 3); review Security pending |
| 2.9 | 2026-09-28 | §8.4.1 baru: ledger migrasi `schema_migrations` diwajibkan beserta penegaknya (satu implementasi pemasang yang dipakai db.ps1 dan db.sh, checksum per berkas, nomor unik, satu transaksi per berkas, tanpa hak untuk runtime, perintah `stamp` untuk mengadopsi database lama), dan kolom `component` dinyatakan sebagai konsekuensi ADR-001 §3.11 (baseline dipasang ke database tiap produk). Rollback otomatis dinyatakan TIDAK ada, bukan dijanjikan. Keputusan pemilik proyek (fondasi langkah 2); review Security pending |
| 2.8 | 2026-09-28 | §8.3: baris `menus`/`menu_permissions` mencatat RLS sebenarnya (baca-saja, policy terpisah per context, tanpa grant tulis) dan fungsi register F-20; §8.7.2 menambahkan aturan lingkungan bahwa zona waktu server database di pengembangan/demo dipatok bukan UTC oleh `db.sh`/`db.ps1`, karena cacat pembacaan `timestamptz` tidak bergejala pada server UTC. Keputusan pemilik proyek (DEMO-0409 Bagian A); review Security pending |
| 2.7 | 2026-09-27 | §8.7.2: kontrak unit of work menambah pematokan `TimeZone='UTC'` transaction-local beserta sebabnya (Prisma salah membaca `timestamptz` bila TimeZone server bukan UTC - ditemukan saat verifikasi slice 14 di mesin target), dan aturan bahwa durasi untuk keputusan dihitung database sebagai detik. Keputusan pemilik proyek; review Security pending |
| 2.6 | 2026-09-27 | Table Ownership Register: entri `support_sessions` dilengkapi (tiga policy per context, `expires_at` tanpa grant UPDATE, UPDATE satu arah, rujukan F-18/F-19); §8.7.1 mencatat GUC ketiga `app.support_session_id` beserta sifat fail-closed pembacanya dan urutan wajib `SET TRANSACTION READ ONLY` sebelum `set_config`. Keputusan pemilik proyek (slice 14, DEMO-0312); review Security pending |
| 2.5 | 2026-09-26 | Table Ownership Register: `platform_role_permissions` ditambahkan dan entri `platform_role_assignments` dikoreksi - sejak DEMO-0311 `app_user` memang punya grant ke tabel itu, tetapi seluruh policy-nya mensyaratkan context platform, jadi "tidak ada grant" tidak lagi menggambarkan keadaan; entri `tenant_notifications` mempertegas bahwa batas tenant dijaga RLS sementara syarat `audit.read` ditegakkan guard aplikasi. Keputusan pemilik proyek (slice 13); review Security pending |
| 2.4 | 2026-09-23 | Table Ownership Register: `crypto_keys` (penyimpan DEK terbungkus, mixed-ownership, tanpa grant ke `app_user`) ditambahkan - tabel ini ada sejak slice 8 tetapi belum pernah terdaftar. Keputusan pemilik proyek (D-31) |
