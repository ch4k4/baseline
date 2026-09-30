---
title: "ADR-001 — SaaS Multi-Tenancy Architecture"
adr_id: "ADR-001"
version: "1.0"
status: "SUPERSEDED"
original_status: "Accepted as Product/Architecture Direction; Implementation and Specialist Reviews Pending"
superseded_by: "ADR-001-SAAS-MULTI-TENANCY_v1.3.md"
superseded_date: "2026-09-16"
decision_date: "2026-09-16"
decision_owner: "<REQUESTER_PLACEHOLDER>"
technical_approver: "<TECHNICAL_APPROVER_PLACEHOLDER>"
security_privacy_approver: "<SECURITY_PRIVACY_APPROVER_PLACEHOLDER>"
operations_approver: "<OPERATIONS_APPROVER_PLACEHOLDER>"
supersedes: null
related_ssot:
  - "INFRASTRUCTURE_SSOT_v1.1.md"
  - "GENERAL_FEATURE_BASE_SSOT_v1.1.md"
---

> ⚠️ **SUPERSEDED — ARSIP, BUKAN DOKUMEN AKTIF.**
> Versi berlaku: [`ADR-001-SAAS-MULTI-TENANCY_v1.3.md`](./ADR-001-SAAS-MULTI-TENANCY_v1.3.md). Lihat `DOCUMENT_VERSION_INDEX.md`.
> Isi dan referensi versi di bawah bersifat historis dan **tidak boleh** dijadikan dasar implementasi, ticket, atau review.

# ADR-001 — SaaS Multi-Tenancy Architecture

## 1. Context

Platform akan digunakan sebagai SaaS lintas industri dan melayani beberapa customer independen dalam satu platform. Setiap customer memerlukan isolation boundary untuk data, identity membership, configuration, entitlement, file, integration, background processing, reporting, dan audit.

Model awal hanya mendukung organisasi sebagai struktur bisnis. Organization tidak cukup sebagai tenant boundary karena satu tenant dapat mempunyai lebih dari satu organization dan platform operation dapat berada di luar organization.

## 2. Decision

Platform menetapkan:

```text
Deployment model : Shared application deployment
Database model   : Shared PostgreSQL database
Schema model     : Shared schema
Isolation key    : tenant_id UUID NOT NULL pada seluruh tenant-owned table
Primary control  : Verified tenant context + application authorization
Defense in depth : PostgreSQL Row-Level Security (RLS)
Architecture     : Modular monolith
```

Tenant adalah security, data-isolation, commercial, entitlement, dan lifecycle boundary tertinggi bagi customer. Organization adalah struktur bisnis di dalam tenant.

## 3. Decision details

### 3.1 Data classification by ownership

Setiap table harus diklasifikasikan sebelum migration:

| Class | Contoh | Requirement |
|---|---|---|
| Platform-global | platform roles, system registry | Tidak memiliki `tenant_id`; hanya platform service/permission |
| Tenant control-plane | tenant, domain, membership, entitlement | Memiliki explicit access policy; sebagian row beridentitas tenant |
| Tenant-owned | organization, files, task, workflow, domain record | `tenant_id NOT NULL`, tenant-safe constraints, RLS |
| Operational | outbox, job, webhook delivery, export | Tenant-owned bila berasal dari tenant; tenant context wajib |

Global table harus terdaftar eksplisit. Table tanpa `tenant_id` tidak boleh muncul karena kelalaian.

### 3.2 Tenant resolution

Tenant aktif ditentukan server-side dari verified domain/selector, authenticated session, dan active tenant membership. Client-supplied `tenant_id` pada body/query/header tidak dipercaya sebagai authority.

Tenant switch hanya dapat dilakukan terhadap active membership dan menghasilkan token/session context baru. Tenant status dan membership diverifikasi kembali pada protected request sesuai session strategy.

### 3.3 Database enforcement

- Runtime account bukan owner, bukan superuser, dan tanpa `BYPASSRLS`.
- Tenant-owned table memakai `ENABLE ROW LEVEL SECURITY` serta `FORCE ROW LEVEL SECURITY`.
- Backend menetapkan tenant context transaction-local dengan `set_config(..., true)`/`SET LOCAL` sebelum query.
- RLS policy menggunakan current tenant context untuk `USING` dan `WITH CHECK`.
- Application repository tetap memfilter tenant; RLS menjadi lapisan kedua.
- Unique constraint, foreign key, dan index tenant-owned memasukkan tenant scope.
- Composite foreign key digunakan bila diperlukan untuk menolak relasi lintas tenant.
- Connection pooling test wajib membuktikan context tidak bocor antar request.

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

### 3.6 Lifecycle

```text
PROVISIONING -> ACTIVE -> SUSPENDED -> CLOSING -> ARCHIVED -> PURGED
```

Provisioning idempotent membuat tenant, domain/slug, owner membership, organization default, role, settings, entitlement, dan audit record. Suspension memblokir access tanpa menghapus data. Purge memerlukan retention/legal-hold check, authorization, export/offboarding completion, dan purge evidence.

## 4. Alternatives considered

### 4.1 Database per tenant

Tidak dipilih sebagai baseline karena meningkatkan provisioning, migration orchestration, connection management, monitoring, backup, dan operational cost. Model ini dapat dipertimbangkan untuk regulated/premium isolation tier melalui ADR baru.

### 4.2 Schema per tenant

Tidak dipilih karena schema proliferation, migration complexity, connection/search-path risk, dan tooling overhead meningkat seiring tenant count.

### 4.3 Shared schema without RLS

Ditolak. Application filter saja terlalu mudah terlewat pada raw query, new repository, maintenance path, atau refactor. RLS memberi defense-in-depth, walaupun tidak menggantikan application authorization.

### 4.4 Organization as tenant

Ditolak. Organization adalah business hierarchy dan dapat berubah/berjumlah lebih dari satu; tenant adalah isolation dan lifecycle boundary.

## 5. Positive consequences

- onboarding tenant tidak memerlukan database/schema baru;
- migration dan observability lebih sederhana dibanding database-per-tenant;
- resource utilization lebih efisien;
- shared feature dapat digunakan konsisten lintas industri;
- RLS dan tenant-safe constraint mengurangi risiko query lintas tenant;
- satu user dapat memiliki membership pada beberapa tenant secara eksplisit.

## 6. Negative consequences and risks

- bug isolation berpotensi berdampak besar sehingga negative test wajib;
- single-tenant point-in-time restore lebih sulit pada shared database;
- noisy-neighbor risk memerlukan quota, index, query monitoring, dan rate limit;
- RLS menambah kompleksitas transaction, Prisma integration, testing, dan troubleshooting;
- platform support workflow menjadi lebih ketat;
- setiap secondary store/process harus tenant-aware;
- tenant migration dari/ke dedicated database memerlukan portability design.

## 7. Mandatory controls before production

1. Automated cross-tenant isolation tests dengan sedikitnya dua tenant.
2. Runtime database role verification: non-owner, non-superuser, no `BYPASSRLS`.
3. RLS enabled/forced verification untuk seluruh tenant-owned table.
4. Tenant-safe unique/FK/index schema validation.
5. Connection-pool contamination test.
6. Cache, file, search, job, webhook, integration, notification, report, dan export isolation tests.
7. Provisioning, suspension, reactivation, offboarding, retention, dan purge tests.
8. Privileged support/break-glass design dan audit test.
9. Backup/restore rehearsal dan documented single-tenant logical recovery limitation.
10. Security/Privacy, Technical, dan Operations approval.

## 8. Implementation sequence

```text
1. Tenant schema and lifecycle
2. Tenant context resolver
3. Membership and tenant switch
4. Database runtime-role separation
5. Tenant-aware constraints and indexes
6. RLS policies and transaction context
7. Tenant-aware repositories
8. Secondary surface isolation
9. Provisioning and operations workflow
10. Cross-tenant automated test suite
11. Domain module onboarding
```

Domain table tidak boleh dibuat sebelum langkah 1-6 memiliki verified implementation pattern.

## 9. Validation evidence required

Evidence minimum:

- schema/migration diff;
- database role and RLS inspection output;
- API and repository negative tests;
- connection-pool reuse test;
- object-storage/search/cache/job isolation test;
- provisioning lifecycle test report;
- threat model and security review;
- backup/restore rehearsal record;
- OpenAPI and operational runbook;
- traceable commit/release identifier.

## 10. Approval boundary

Keputusan untuk menggunakan SaaS multi-tenancy telah diadopsi sebagai product/architecture direction pada 2026-09-16. Keputusan ini **tidak** dengan sendirinya membuktikan correctness implementasi, security/privacy approval, operational readiness, regulatory compliance, atau production acceptance.

| Role | Decision | Date |
|---|---|---|
| Product/Architecture Direction | Adopted | 2026-09-16 |
| Technical | Pending | — |
| Security/Privacy | Pending | — |
| Operations | Pending | — |

