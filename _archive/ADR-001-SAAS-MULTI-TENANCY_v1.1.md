---
title: "ADR-001 — SaaS Multi-Tenancy Architecture"
adr_id: "ADR-001"
version: "1.1"
status: "SUPERSEDED"
original_status: "Accepted as Product/Architecture Direction; v1.1 Addendum Proposed; Implementation and Specialist Reviews Pending"
superseded_by: "ADR-001-SAAS-MULTI-TENANCY_v1.3.md"
superseded_date: "2026-09-16"
decision_date: "2026-09-16"
revision_date: "2026-09-16"
decision_owner: "<REQUESTER_PLACEHOLDER>"
technical_approver: "<TECHNICAL_APPROVER_PLACEHOLDER>"
security_privacy_approver: "<SECURITY_PRIVACY_APPROVER_PLACEHOLDER>"
operations_approver: "<OPERATIONS_APPROVER_PLACEHOLDER>"
supersedes: "ADR-001 v1.0"
related_adr:
  - "ADR-002-IDENTITY-MODEL_v1.0.md"
related_ssot:
  - "INFRASTRUCTURE_SSOT_v1.3.md"
  - "GENERAL_FEATURE_BASE_SSOT_v1.3.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md"
review_reference: "REVIEW_BASELINE_DOCS_2026-09-16.md"
---

> ⚠️ **SUPERSEDED — ARSIP, BUKAN DOKUMEN AKTIF.**
> Versi berlaku: [`ADR-001-SAAS-MULTI-TENANCY_v1.3.md`](./ADR-001-SAAS-MULTI-TENANCY_v1.3.md). Lihat `DOCUMENT_VERSION_INDEX.md`.
> Isi dan referensi versi di bawah bersifat historis dan **tidak boleh** dijadikan dasar implementasi, ticket, atau review.

# ADR-001 — SaaS Multi-Tenancy Architecture v1.1

> **Perubahan v1.1:** menambahkan jalur akses database sebelum tenant context terbentuk (§3.7), policy baris platform/`tenant_id NULL` (§3.8), pola transaksi ORM (§3.9), jalur reactivation pada lifecycle, dan kontrol wajib terkait. Keputusan inti v1.0 tidak berubah.

## 1. Context

Platform akan digunakan sebagai SaaS lintas industri dan melayani beberapa customer independen dalam satu platform. Setiap customer memerlukan isolation boundary untuk data, identity membership, configuration, entitlement, file, integration, background processing, reporting, dan audit.

Model awal hanya mendukung organisasi sebagai struktur bisnis. Organization tidak cukup sebagai tenant boundary karena satu tenant dapat mempunyai lebih dari satu organization dan platform operation dapat berada di luar organization.

Review 2026-09-16 menemukan bahwa v1.0 mewajibkan RLS fail-closed pada tabel yang harus dibaca **sebelum** tenant diketahui (resolusi domain, login, refresh token, audit login gagal). Tanpa jalur terkontrol, implementasi akan macet atau menambal dengan bypass RLS yang tidak aman.

## 2. Decision

Platform menetapkan:

```text
Deployment model : Shared application deployment
Database model   : Shared PostgreSQL database
Schema model     : Shared schema
Isolation key    : tenant_id UUID NOT NULL pada seluruh tenant-owned table
Primary control  : Verified tenant context + application authorization
Defense in depth : PostgreSQL Row-Level Security (RLS)
Pre-context path : Narrow SECURITY DEFINER functions (bukan role bypass)
Architecture     : Modular monolith
```

Tenant adalah security, data-isolation, commercial, entitlement, dan lifecycle boundary tertinggi bagi customer. Organization adalah struktur bisnis di dalam tenant. Model identitas pengguna ditetapkan terpisah pada ADR-002.

## 3. Decision details

### 3.1 Data classification by ownership

Setiap table harus diklasifikasikan sebelum migration:

| Class | Contoh | Requirement |
|---|---|---|
| Platform-global | `permissions`, platform roles, system registry, `users` (identitas global, lihat ADR-002) | Tidak memiliki `tenant_id`; akses hanya lewat service/function yang ditetapkan |
| Tenant control-plane | `tenants`, `tenant_domains`, `tenant_entitlements` | Explicit access policy; baris beridentitas tenant; pembacaan pre-context hanya lewat §3.7 |
| Tenant-owned | `tenant_memberships`, `roles`, `sessions`, `refresh_tokens`, organization, files, task, domain record | `tenant_id NOT NULL`, tenant-safe constraints, RLS |
| Mixed-ownership | `menus`, `audit_logs` | `tenant_id` nullable **hanya** untuk baris platform; policy terpisah §3.8 |
| Operational | outbox, job, webhook delivery, export | Tenant-owned bila berasal dari tenant; tenant context wajib |

Global table dan mixed-ownership table harus terdaftar eksplisit dalam **Table Ownership Register** (Infrastructure SSOT §8.3). Table tanpa `tenant_id` tidak boleh muncul karena kelalaian.

### 3.2 Tenant resolution

Tenant aktif ditentukan server-side dari verified domain/selector, authenticated session, dan active tenant membership. Client-supplied `tenant_id` pada body/query/header tidak dipercaya sebagai authority.

Tenant switch hanya dapat dilakukan terhadap active membership dan menghasilkan token/session context baru. Tenant status dan membership diverifikasi kembali pada protected request sesuai session strategy. Biaya query verifikasi per request diterima secara sadar; access token tidak diperlakukan sebagai sepenuhnya stateless.

### 3.3 Database enforcement

- Runtime account (`app_user`) bukan owner, bukan superuser, dan tanpa `BYPASSRLS`.
- Tenant-owned table memakai `ENABLE ROW LEVEL SECURITY` serta `FORCE ROW LEVEL SECURITY`.
- Backend menetapkan tenant context transaction-local dengan `set_config(..., true)`/`SET LOCAL` sebelum query.
- RLS policy menggunakan current tenant context untuk `USING` dan `WITH CHECK`.
- Application repository tetap memfilter tenant; RLS menjadi lapisan kedua.
- Unique constraint, foreign key, dan index tenant-owned memasukkan tenant scope.
- Composite foreign key digunakan bila diperlukan untuk menolak relasi lintas tenant.
- Connection pooling test wajib membuktikan context tidak bocor antar request.
- Policy RLS, `FORCE`, function, dan grant dikelola sebagai SQL migration terversi (lihat §3.9).

### 3.4 Non-database enforcement

Tenant context wajib dibawa dan divalidasi pada:

- cache key dan invalidation;
- object-storage namespace serta download authorization;
- search index/query;
- job scheduler/worker;
- notification/template/delivery;
- webhook, integration credential, outbox, retry, dan dead-letter processing;
- import, export, report, dan generated artifact;
- audit/activity visibility;
- rate limit, quota, serta entitlement evaluation.

### 3.5 Platform and support access

Platform admin tidak memperoleh implicit tenant-data access. Tenant support access menggunakan permission khusus, explicit tenant selection, documented reason, bounded session, audit, dan approval/policy sesuai sensitivity. Break-glass procedure harus dibentuk sebelum production.

Operasi platform (`/platform/*`) berjalan dengan context `app.context_kind = 'platform'` dan hanya dapat menyentuh tabel control-plane serta baris platform melalui policy §3.8. Context platform **tidak** membuka tenant-owned table.

### 3.6 Lifecycle

```text
PROVISIONING -> ACTIVE -> SUSPENDED -> CLOSING -> ARCHIVED -> PURGED
                  ^           |
                  +-----------+  (authorized reactivation)
```

Provisioning idempotent membuat tenant, domain/slug, owner membership, role, settings, entitlement, dan audit record. Organization default dibuat hanya bila modul Organization aktif pada scope implementasi. Suspension memblokir access tanpa menghapus data. Purge memerlukan retention/legal-hold check, authorization, export/offboarding completion, dan purge evidence.

### 3.7 Pre-context access path (baru v1.1)

Beberapa operasi harus membaca atau menulis data sebelum tenant context terverifikasi. Operasi tersebut **hanya** boleh melalui fungsi PostgreSQL `SECURITY DEFINER` yang sempit.

| Use case | Function (nama indikatif) | Output minimum |
|---|---|---|
| Host/domain → tenant | `auth.resolve_tenant_by_host(host text)` | `tenant_id`, `status` untuk domain terverifikasi |
| Daftar membership saat login/pilih tenant | `auth.list_active_memberships(user_id uuid)` | `tenant_id`, `membership_id`, `tenant display name`, `status` |
| Lookup refresh token | `auth.find_refresh_token(token_hash bytea)` | `refresh_token_id`, `tenant_id`, `session_id`, `family_id`, status/expiry |
| Rotasi/revocation refresh token | `auth.rotate_refresh_token(...)`, `auth.revoke_token_family(...)` | Hasil operasi atomik |
| Audit sebelum context | `audit.write_pre_context_event(...)` | Insert-only; `tenant_id` NULL atau hasil resolusi |

Aturan wajib:

1. Function dimiliki role khusus `app_auth_definer` (bukan `app_owner` migration role, bukan superuser); `app_user` hanya mendapat `EXECUTE`.
2. Setiap function menetapkan `SET search_path = pg_catalog, <schema>`; tidak ada dynamic SQL berbasis input.
3. Input berupa identifier/hashes, bukan filter bebas; output hanya kolom minimum di atas.
4. Function tidak mengembalikan data personal plaintext maupun ciphertext.
5. Tidak ada function yang menerima `tenant_id` dari client lalu mengembalikan data tenant-owned tanpa membuktikan kepemilikan (hash token atau user_id terverifikasi).
6. Rate limit aplikasi dan audit berlaku di atas function.
7. Daftar function dikelola dalam **Pre-context Function Register** dengan owner, alasan, dan test negatif.
8. Menambah function baru memerlukan review Security dan pembaruan register.

Dilarang: memberi `BYPASSRLS` pada role runtime/auth, memakai koneksi owner/migration dari aplikasi, mematikan `FORCE`, atau menambahkan klausa `OR current_setting(...) IS NULL` pada policy.

### 3.8 Mixed-ownership rows (baru v1.1)

Untuk tabel yang memuat baris platform (`tenant_id IS NULL`) dan baris tenant:

```sql
-- Baca: tenant melihat baris miliknya + baris platform yang memang dipublikasikan
CREATE POLICY menus_read ON menus FOR SELECT
USING (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  OR (tenant_id IS NULL AND is_system = true)
);

-- Tulis tenant: hanya baris miliknya
CREATE POLICY menus_write_tenant ON menus FOR INSERT
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
-- (UPDATE/DELETE setara dengan USING + WITH CHECK)

-- Tulis platform: hanya pada context platform
CREATE POLICY menus_write_platform ON menus FOR ALL
USING (tenant_id IS NULL AND current_setting('app.context_kind', true) = 'platform')
WITH CHECK (tenant_id IS NULL AND current_setting('app.context_kind', true) = 'platform');
```

`audit_logs`: tenant hanya membaca baris `tenant_id = current`; baris platform hanya dibaca pada context platform dengan permission audit platform; insert lewat audit writer; `UPDATE`/`DELETE` di-`REVOKE` dari role runtime.

`app.context_kind` ditetapkan server-side oleh guard route platform, transaction-local, dan tidak dapat dipengaruhi input client. Pola SQL di atas bersifat indikatif; implementasi final wajib ditinjau Security.

### 3.9 ORM transaction pattern (baru v1.1)

- Prisma tidak merepresentasikan policy RLS, `FORCE`, function, dan grant di schema model. Objek tersebut ditulis sebagai SQL di dalam migration terversi dan diverifikasi oleh schema inspection test.
- Satu **unit of work = satu interactive transaction**; statement pertama selalu `set_config('app.current_tenant_id', <verified>, true)` (dan `app.context_kind` bila perlu).
- Query tenant-owned di luar unit-of-work wrapper dilarang dan dideteksi lewat test/lint.
- Nested transaction tidak digunakan; service yang sudah berada dalam unit of work menerima transaction client.
- Timeout transaksi ditetapkan eksplisit dan diuji.
- Pola ini wajib dibuktikan oleh spike terukur (Sprint Plan v1.1 DEMO-0100) sebelum domain table dibuat. Jika spike gagal, keputusan kembali ke ADR (bukan diselesaikan di code).

## 4. Alternatives considered

### 4.1 Database per tenant

Tidak dipilih sebagai baseline karena meningkatkan provisioning, migration orchestration, connection management, monitoring, backup, dan operational cost. Model ini dapat dipertimbangkan untuk regulated/premium isolation tier melalui ADR baru, termasuk desain portability tenant.

### 4.2 Schema per tenant

Tidak dipilih karena schema proliferation, migration complexity, connection/search-path risk, dan tooling overhead meningkat seiring tenant count.

### 4.3 Shared schema without RLS

Ditolak. Application filter saja terlalu mudah terlewat pada raw query, new repository, maintenance path, atau refactor.

### 4.4 Organization as tenant

Ditolak. Organization adalah business hierarchy; tenant adalah isolation dan lifecycle boundary.

### 4.5 Pre-context via role dengan `BYPASSRLS` (baru v1.1)

Ditolak. Role bypass memberikan akses baca seluruh tabel tenant ke seluruh code path yang memakai koneksi tersebut; blast radius jauh lebih besar daripada function sempit.

### 4.6 Pre-context via role `app_auth` dengan policy khusus (baru v1.1)

Tidak dipilih. Layak secara teknis, tetapi menambah pool koneksi kedua dan policy per tabel yang harus dijaga sinkron. Dapat dievaluasi ulang bila jumlah function pre-context tumbuh melebihi yang dapat direview.

## 5. Positive consequences

- onboarding tenant tidak memerlukan database/schema baru;
- migration dan observability lebih sederhana dibanding database-per-tenant;
- resource utilization lebih efisien;
- shared feature dapat digunakan konsisten lintas industri;
- RLS dan tenant-safe constraint mengurangi risiko query lintas tenant;
- satu user dapat memiliki membership pada beberapa tenant secara eksplisit;
- jalur pre-context kecil, dapat direview, dan dapat diuji secara negatif.

## 6. Negative consequences and risks

- bug isolation berpotensi berdampak besar sehingga negative test wajib;
- single-tenant point-in-time restore lebih sulit pada shared database;
- noisy-neighbor risk memerlukan quota, index, query monitoring, dan rate limit;
- RLS menambah kompleksitas transaction, Prisma integration, testing, dan troubleshooting;
- setiap request protected menambah query verifikasi tenant/membership;
- `SECURITY DEFINER` function adalah permukaan serangan baru dan wajib direview;
- platform support workflow menjadi lebih ketat;
- setiap secondary store/process harus tenant-aware;
- tenant migration dari/ke dedicated database memerlukan portability design.

## 7. Mandatory controls before production

1. Automated cross-tenant isolation tests dengan sedikitnya dua tenant.
2. Runtime database role verification: non-owner, non-superuser, no `BYPASSRLS`.
3. RLS enabled/forced verification untuk seluruh tenant-owned dan mixed-ownership table.
4. Tenant-safe unique/FK/index schema validation.
5. Connection-pool contamination test.
6. Cache, file, search, job, webhook, integration, notification, report, dan export isolation tests.
7. Provisioning, suspension, reactivation, offboarding, retention, dan purge tests.
8. Privileged support/break-glass design dan audit test.
9. Backup/restore rehearsal dan documented single-tenant logical recovery limitation.
10. Security/Privacy, Technical, dan Operations approval.
11. **(v1.1)** Pre-context Function Register lengkap; setiap function memiliki test negatif (enumeration, wrong hash, suspended tenant, cross-tenant token).
12. **(v1.1)** Mixed-ownership policy test: tenant tidak dapat menulis baris platform; context platform tidak dapat membaca tenant-owned table.
13. **(v1.1)** Schema inspection test membuktikan migration SQL untuk RLS/function/grant sesuai database aktual (tidak ada drift).

## 8. Implementation sequence

```text
0. ORM + RLS + pool-reuse spike (go/no-go)
1. Tenant schema and lifecycle
2. Database runtime-role separation (app_owner / app_auth_definer / app_user)
3. Pre-context function register and functions
4. Tenant context resolver
5. Membership and tenant switch
6. Tenant-aware constraints and indexes
7. RLS policies (tenant-owned + mixed-ownership) and transaction context
8. Tenant-aware repositories / unit-of-work wrapper
9. Secondary surface isolation
10. Provisioning and operations workflow
11. Cross-tenant automated test suite
12. Domain module onboarding
```

Domain table tidak boleh dibuat sebelum langkah 0–8 memiliki verified implementation pattern.

## 9. Validation evidence required

- schema/migration diff;
- database role, grant, function ownership, dan RLS inspection output;
- Pre-context Function Register dan hasil test negatifnya;
- API and repository negative tests;
- connection-pool reuse test;
- object-storage/search/cache/job isolation test;
- provisioning lifecycle test report;
- threat model and security review;
- backup/restore rehearsal record;
- OpenAPI and operational runbook;
- traceable commit/release identifier.

## 10. Approval boundary

Keputusan untuk menggunakan SaaS multi-tenancy telah diadopsi sebagai product/architecture direction pada 2026-09-16. Addendum v1.1 berstatus **Proposed** sampai disetujui Technical dan Security/Privacy. Keputusan ini **tidak** dengan sendirinya membuktikan correctness implementasi, security/privacy approval, operational readiness, regulatory compliance, atau production acceptance.

| Role | Decision | Date |
|---|---|---|
| Product/Architecture Direction | Adopted (v1.0); v1.1 addendum proposed | 2026-09-16 |
| Technical | Pending | — |
| Security/Privacy | Pending | — |
| Operations | Pending | — |

## 11. Change log

| Version | Date | Summary | Approval |
|---|---|---|---|
| 1.0 | 2026-09-16 | Initial multi-tenancy decision | Product/architecture direction adopted |
| 1.1 | 2026-09-16 | Pre-context SECURITY DEFINER path, mixed-ownership policy, ORM transaction pattern, reactivation path, kontrol 11–13, sequence dengan spike; referensi ke ADR-002 dan SSOT versi terbaru | Proposed; Technical/Security pending |
