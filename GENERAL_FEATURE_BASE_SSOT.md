---
title: "General Feature Base SSOT — Cross-Industry Application Foundation"
document_id: "GENERAL-FEATURE-BASE-SSOT"
edition: "2.0 (consolidated final)"
status: "Consolidated Baseline — Proposed; specialist approval pending"
owner: "<OWNER_PLACEHOLDER>"
last_updated: "2026-09-16"
architecture: "Modular Monolith / Domain-Oriented Modules"
industry_scope: "Cross-industry"
related_documents:
  - "README.md"
  - "ARCHITECTURE_DECISIONS.md"
  - "INFRASTRUCTURE_SSOT.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT.md"
  - "SAAS_DEMO_FOUNDATION_SSOT.md"
  - "SAAS_DEMO_SPRINT_PLAN.md"
supersedes_archive: "_archive/ (GENERAL_FEATURE_BASE_SSOT v1.2–v1.4)"
change_control: "Perubahan normatif MUST diperbarui di dokumen ini sebelum implementasi dan dicatat di bagian Riwayat serta README.md §5."
---

# General Feature Base SSOT

## 1. Tujuan dan kedudukan dokumen

Dokumen ini menetapkan fitur horizontal yang dapat digunakan ulang oleh aplikasi lintas industri seperti healthcare, retail, jasa, distribusi, pendidikan, manufaktur, properti, professional services, dan internal enterprise system.

Dokumen ini adalah pendamping [Infrastructure SSOT](./INFRASTRUCTURE_SSOT.md) dan [Data Protection and Field Encryption SSOT](./DATA_PROTECTION_ENCRYPTION_SSOT.md). Infrastructure SSOT mengatur stack, SaaS tenant isolation, dan deployment; dokumen ini mengatur shared application capabilities. Business rule khusus industri harus ditempatkan dalam domain module terpisah dan tidak boleh dimasukkan ke shared core hanya karena dipakai oleh satu domain.

> **Aturan utama:** shared core hanya memuat capability yang benar-benar lintas domain. Domain-specific terminology, workflow, form, status, dan regulatory rule harus berada di domain module atau extension point.

### 1.1 Sasaran

- menyediakan fondasi fitur yang konsisten untuk berbagai industri;
- menghindari duplikasi users, files, approvals, notifications, audit, dan settings pada setiap domain;
- mempertahankan authorization, traceability, dan data ownership;
- memungkinkan konfigurasi tanpa mengubah business rule menjadi EAV yang sulit dirawat;
- menyediakan extension point yang terkontrol;
- menjaga domain module tetap independen dari UI dan ORM.

### 1.2 Bukan sasaran baseline

Baseline ini tidak menetapkan:

- business process khusus industri;
- pricing, subscription charging, invoice, dan payment processing;
- low-code/no-code engine;
- dynamic database schema builder;
- microservices;
- real-time collaboration;
- data warehouse/BI platform;
- billing, payment, inventory, clinical record, learning management, atau domain khusus lain.

## 2. Prinsip desain

1. **Domain-neutral language** — gunakan `organization`, `organizational_unit`, `party`, `resource`, dan `record`, bukan istilah industri tertentu.
2. **Configuration with boundaries** — configurable option digunakan untuk variasi stabil; business logic kritis tetap berupa code dan test.
3. **No generic EAV for core transactions** — tabel entity-attribute-value tidak menjadi tempat menyimpan seluruh data aplikasi.
4. **Authorization is backend-enforced** — frontend visibility bukan security boundary.
5. **Audit by design** — perubahan penting memiliki actor, timestamp, action, target, dan correlation ID.
6. **API-first contracts** — shared capability diakses melalui service/application contract yang terdokumentasi.
7. **Explicit ownership** — setiap record mempunyai owning module dan organizational scope yang jelas.
8. **Safe extensibility** — domain module menggunakan extension point/event, bukan mengubah internal shared module secara langsung.
9. **Archive over accidental deletion** — data bisnis tidak dihapus permanen tanpa retention/purge policy.
10. **Single deployment first** — modular monolith adalah baseline; pemisahan service memerlukan ADR dan evidence kebutuhan.
11. **Tenant isolation is mandatory** — seluruh tenant-owned capability wajib membawa tenant context dan lulus cross-tenant leakage test.

## 3. Application capability map

### 3.1 Foundation — wajib

| Module | Capability utama |
|---|---|
| Tenancy | Tenant lifecycle, domain, membership, entitlement, isolation context |
| Data Protection | Field register, classification, encryption, masking, retention, subject-right workflow |
| IAM | User, credential, session, role, permission, access policy |
| Organization | Organization profile, unit hierarchy, position, membership |
| Party & Contact | Person/organization reference, contact point, address |
| Reference Data | Code list, category, status dictionary, localized label |
| Settings | System, tenant, organization, unit, dan user preferences |
| Audit | Immutable security/business audit trail |
| Files | Metadata, upload, download, access control, integrity |
| Notifications | Template, channel, delivery, preference, retry |

### 3.2 Collaboration — recommended

| Module | Capability utama |
|---|---|
| Tasks | Assignment, due date, priority, status, reminder |
| Comments | Threaded note, mention, attachment, moderation |
| Tags | Controlled/free tags untuk klasifikasi non-kritis |
| Activity Feed | Timeline dari event lintas module |

### 3.3 Process — optional but standardized

| Module | Capability utama |
|---|---|
| Workflow | Definition version, state transition, guard, history |
| Approval | Request, step, approver resolution, decision, delegation |
| Forms | Versioned form definition dan validated submission |
| Calendar | Event, participant, reminder, timezone |

### 3.4 Platform — optional

| Module | Capability utama |
|---|---|
| Search | Unified search contract dan module-owned index projection |
| Import/Export | Validated batch import, preview, error report, export job |
| Integration | API client registry, webhook, idempotency, outbox, retry |
| Reporting | Saved filter, report definition, asynchronous generation |
| Feature Flags | Controlled rollout tanpa menggantikan authorization |
| Localization | Locale, timezone, translated reference labels |

## 4. Module boundaries

```text
backend/src/modules/
+-- tenancy/
+-- data-protection/
+-- iam/
+-- organizations/
+-- parties/
+-- reference-data/
+-- settings/
+-- audit/
+-- files/
+-- notifications/
+-- tasks/
+-- comments/
+-- tags/
+-- workflows/
+-- approvals/
+-- forms/
+-- calendar/
+-- integrations/
+-- imports-exports/
+-- reports/
+-- search/
`-- feature-flags/
```

Setiap module minimal memiliki:

```text
<module>/
+-- application/
|   +-- dto/
|   +-- commands/
|   +-- queries/
|   `-- services/
+-- domain/
|   +-- entities/
|   +-- value-objects/
|   +-- policies/
|   `-- events/
+-- infrastructure/
|   +-- repositories/
|   `-- adapters/
+-- presentation/
|   `-- http/
`-- <module>.module.ts
```

Struktur boleh disederhanakan untuk module kecil, tetapi dependency direction wajib dipertahankan: presentation dan infrastructure bergantung pada application/domain, bukan sebaliknya.

## 5. Identity and Access Management

### 5.1 Capability

- lifecycle identitas global: active, suspended, locked, archived (ADR-002);
- onboarding ke tenant hanya melalui invitation yang diterima pemilik email (ADR-002); status undangan: pending, accepted, expired, revoked;
- lifecycle membership tenant: active, suspended, ended;
- credential dan password policy;
- session dan refresh-token management;
- role-based access control;
- direct permission hanya untuk exception yang diaudit;
- organization/unit scoped role assignment;
- tenant membership dan tenant-scoped role assignment;
- service account untuk integrasi;
- MFA extension point;
- login/security event audit.

### 5.2 Permission convention

Permission menggunakan format:

```text
<resource>.<action>
```

Contoh:

```text
members.read
members.invite
members.update_profile
members.suspend
reports.export
approvals.decide
```

Authorization decision mempertimbangkan:

```text
tenant_context + identity + permission + organizational_scope + resource_scope + record_state
```

Role hanya bundel permission. Nama role tidak boleh di-hardcode sebagai business rule jika permission check lebih tepat.

### 5.3 Minimum entities

```text
users                    (platform-global identity)
credentials              (platform-global secret)
user_invitations         (tenant-owned)
invitation_roles         (tenant-owned; composite FK ke roles)
tenant_memberships       (tenant-owned)
tenant_member_profiles   (tenant-owned; termasuk contact email copy)
auth_selection_tickets   (platform-global transient; hanya via fungsi register)
sessions                 (mixed-ownership: context_kind TENANT/PLATFORM)
refresh_tokens           (mixed-ownership: context_kind TENANT/PLATFORM)
platform_role_assignments (platform-global)
roles                    (tenant-owned)
permissions              (platform-global catalog)
role_permissions         (tenant-owned)
user_role_assignments    (tenant-owned; membership_id-based)
service_accounts         (tenant-owned)
```

Tidak ada tabel `tenant_role_assignments`. Satu tabel `user_role_assignments` mereferensikan `(tenant_id, membership_id)` dan `(tenant_id, role_id)` dengan composite FK. Organizational/unit scope ditambahkan sebagai kolom scope opsional pada assignment ketika modul Organization aktif, bukan tabel assignment kedua.

Permission yang diperlukan untuk onboarding: `members.invite`, `members.read`, `members.update_profile`, `members.suspend`, `members.assign_role`. Admin tenant tidak memiliki operasi create/update terhadap `users` global.

Field credential, token, dan recovery secret tidak boleh tersedia pada API response atau audit payload.

**Aturan akses:** akses ke tabel identitas, session, dan tiket sebelum tenant context terbentuk hanya melalui fungsi yang tercantum di `ARCHITECTURE_DECISIONS.md` Lampiran A; shared module lain tidak boleh membuat jalur baru ke tabel tersebut.

## 6. SaaS tenancy, organization, and workforce structure

### 6.0 Tenant capability

Tenant adalah security, commercial, dan data-isolation boundary tertinggi untuk request bisnis. Tenant tidak sama dengan organization.

```text
SaaS Platform
`-- Tenant
    |-- Tenant memberships and roles
    |-- Entitlements/settings/domains
    `-- One or more Organizations
        `-- Organizational units and positions
```

Minimum tenant entities:

```text
tenants
tenant_domains
tenant_memberships
tenant_member_profiles
user_invitations
tenant_settings
tenant_entitlements
tenant_lifecycle_events
```

Tenant lifecycle:

```text
PROVISIONING -> ACTIVE -> SUSPENDED -> CLOSING -> ARCHIVED -> PURGED
                    ^         |
                    +---------+ (authorized reactivation)
```

Rules:

- Tenant slug/domain unik secara global dan diverifikasi sebelum digunakan untuk routing.
- User dapat memiliki membership pada lebih dari satu tenant.
- Tenant switch memerlukan active membership dan menghasilkan signed tenant context baru.
- Tenant A tidak dapat mengakses data Tenant B, termasuk lewat ID yang diketahui, search, report, export, file URL, cache, job, webhook, atau support tooling.
- Tenant suspension menolak request bisnis dan background action tanpa menghapus data.
- Entitlement mengontrol ketersediaan fitur/limit, tetapi bukan pengganti authorization.
- Platform administrator tidak memiliki implicit tenant data access.
- Privileged/break-glass access memerlukan permission khusus, reason, bounded duration, approval/policy, dan immutable audit.
- Provisioning, retry, suspension, reactivation, offboarding, dan purge wajib idempotent.
- Purge dilarang saat retention period atau legal hold masih aktif.

### 6.1 Capability

- satu organization default dibuat saat provisioning tenant;
- satu tenant boleh memiliki lebih dari satu organization jika entitlement dan use case mengizinkan;
- hierarchical organizational units;
- position/job title;
- user membership dengan effective period;
- manager/reporting relation opsional;
- unit-scoped access;
- active/inactive unit tanpa menghapus history.

### 6.2 Minimum entities

```text
organizations
organizational_units
positions
organization_memberships
membership_positions
```

`organizational_units.parent_id` membentuk hierarchy dan wajib dilindungi dari cycle. Reorganization tidak boleh merusak historical ownership; effective date atau snapshot digunakan bila history relevan.

### 6.3 Multi-tenancy boundary

Baseline ini adalah SaaS multi-tenant dengan **shared PostgreSQL database, shared schema, mandatory `tenant_id`, application-layer tenant scope, PostgreSQL RLS, dan mandatory PDP encryption controls**.

- `organization` adalah struktur bisnis di dalam tenant dan bukan security tenant.
- Semua shared/domain record yang dimiliki customer wajib memiliki `tenant_id UUID NOT NULL`.
- Table global/control-plane tanpa `tenant_id` harus terdaftar eksplisit dan memiliki access policy khusus.
- Unique constraint menggunakan tenant scope, misalnya `UNIQUE (tenant_id, code)`.
- Tenant-owned relation memakai tenant-safe composite foreign key agar relasi lintas tenant ditolak database.
- Index tenant-owned query umumnya dimulai dengan `tenant_id`.
- Backend menetapkan PostgreSQL tenant context secara transaction-local sebelum query.
- Runtime role bukan owner, tidak memiliki `BYPASSRLS`, dan table memakai `FORCE ROW LEVEL SECURITY`.
- Detail normatif RLS, tenant resolution, lifecycle, storage namespace, backup/restore, dan acceptance gate mengikuti Infrastructure SSOT, ADR-001, ADR-002, dan ADR-003 beserta Lampiran A di `ARCHITECTURE_DECISIONS.md`.

## 7. Party, contact, dan address

`party` menyediakan identitas referensial umum tanpa menggantikan domain entity.

### 7.1 Model

```text
parties
|-- type: PERSON | ORGANIZATION
|-- display_name
|-- status
`-- external_reference (optional)

party_person_profiles
party_organization_profiles
contact_points
addresses
party_addresses
```

### 7.2 Rules

- User account dan person adalah konsep berbeda; seseorang dapat ada tanpa login.
- Identitas login (`users`) bersifat platform-global; data tampilan anggota di tenant berada di `tenant_member_profiles` (ADR-002). `party_person_profiles` adalah data orang dalam domain tenant dan tidak menggantikan keduanya.
- Field personal pada party/contact/address mengikuti matriks enkripsi Data Protection SSOT dan memakai DEK tenant.
- Domain-specific profile tetap berada dalam domain module dan mereferensikan `party_id` bila sesuai.
- Email/phone dinormalisasi dan dapat memiliki flag verified/primary.
- Address harus mendukung country-aware fields tanpa memaksakan format satu negara.
- Sensitive identifiers tidak boleh ditempatkan dalam generic metadata.
- Duplicate detection menghasilkan candidate; merge tidak dilakukan otomatis tanpa policy dan audit.

## 8. Reference data

Reference data digunakan untuk code list yang stabil dan terkontrol, bukan transaction record.

### 8.1 Model

```text
reference_sets
reference_values
reference_value_translations
```

**Ownership** (sesuai Infrastructure SSOT §8.8):

| Jenis | `tenant_id` | Pengelola |
|---|---|---|
| Global system set/value | NULL | Platform (migration/seed/context platform) |
| Tenant override/extension value | NOT NULL | Tenant sesuai permission |

- Tabel memakai pola mixed-ownership (ADR-001 §3.8); tenant tidak dapat mengubah baris global.
- Override tenant tidak boleh mengubah `code` global; override hanya label, urutan, dan status aktif untuk tenant tersebut, atau menambah value baru pada set yang ditandai `tenant_extensible`.
- Uniqueness: `(set_id, code)` untuk global dan `(tenant_id, set_id, code)` untuk tenant, dengan larangan tabrakan code tenant terhadap code global.

Minimum field `reference_values`:

```text
id
tenant_id (NULL untuk global)
set_id
code
label
description
sort_order
is_active
effective_from
effective_to
metadata_json (bounded, non-sensitive)
```

### 8.2 Rules

- `code` immutable setelah digunakan oleh transaction.
- Deactivation dipilih daripada deletion.
- System-owned value tidak boleh diubah oleh operator biasa.
- `metadata_json` memiliki schema validation dan size limit.
- Status yang mengendalikan invariant/transition domain tidak dipindahkan ke reference data hanya agar terlihat configurable.

## 9. Settings dan preferences

Precedence:

```text
system default -> tenant -> organization -> organizational unit -> user
```

Level `tenant` wajib didukung. Setting definition wajib menyatakan level mana yang diizinkan; entitlement tenant dapat membatasi nilai setting pada level di bawahnya. Setting level tenant disimpan di `tenant_settings` (atau `setting_values` dengan `scope_type = TENANT`), selalu dengan `tenant_id`.

### 9.1 Model

```text
setting_definitions
setting_values
user_preferences
```

Setiap definition wajib memiliki key, data type, validation schema, default, allowed scope, sensitivity classification, dan owner module.

Secret tidak boleh disimpan dalam settings biasa. Perubahan security-critical setting memerlukan permission khusus dan audit.

## 10. Audit dan activity history

### 10.1 Audit event minimum

```text
id
tenant_id (NULL hanya untuk event platform/pre-context)
occurred_at
actor_type
actor_id
action
target_type
target_id
organization_id (opsional, bila modul Organization aktif)
request_id
source_ip_ref (policy-controlled; keyed pseudonym/truncated, bukan raw IP)
result
reason_code
changed_fields_json (nama field + klasifikasi + aksi; tanpa nilai personal)
metadata_json (bounded, non-personal)
```

### 10.2 Rules

- Audit event append-only untuk application role (`UPDATE`/`DELETE` di-revoke).
- Password, token, secret, authorization header, dan sensitive body tidak boleh dicatat.
- raw before/after value untuk DP-1/DP-2 dilarang (Data Protection SSOT §6.6). Diff nilai hanya untuk field DP-0 yang diizinkan; field personal dicatat sebagai nama field, klasifikasi, dan masked/hash reference. Pengecualian memerlukan payload terenkripsi dengan audit key terbatas.
- Visibility audit mengikuti mixed-ownership policy (ADR-001 §3.8).
- Audit retention dan access policy ditentukan per deployment/regulatory requirement.
- Activity feed adalah user-facing projection; audit log adalah control evidence. Keduanya tidak saling menggantikan.

## 11. File dan attachment management

File binary disimpan di object storage/filesystem adapter; database menyimpan metadata.

### 11.1 Model

```text
files
file_versions
file_links
file_access_policies
```

Minimum metadata:

```text
id
storage_key
original_name
media_type
size_bytes
checksum
status
created_by
created_at
```

### 11.2 Security rules

- allowlist media type dan extension;
- size limit per use case;
- randomized storage key, bukan user filename;
- malware scanning hook sebelum file tersedia;
- checksum/integrity verification;
- authorization diperiksa saat upload dan download;
- private-by-default;
- signed URL memiliki TTL pendek jika digunakan;
- file tidak boleh dieksekusi oleh web server;
- quarantine, rejected, active, archived, dan purged state terpisah;
- purge mengikuti retention/legal hold policy.

## 12. Notifications

> **Catatan:** notifikasi keamanan tenant minimal (`tenant_notifications`, ADR-003 §2.4) — misalnya pemberitahuan support session — berdiri sendiri dan tidak bergantung pada modul Notifications penuh di bawah ini. Saat modul Notifications diimplementasikan, `tenant_notifications` dapat dimigrasikan menjadi channel `IN_APP` dengan tetap mempertahankan jalur insert terdaftar (`ARCHITECTURE_DECISIONS.md` Lampiran A F-15).

Channels baseline:

```text
IN_APP
EMAIL (adapter optional)
SMS (adapter optional)
PUSH (adapter optional)
```

### 12.1 Model

```text
notification_templates
notification_template_versions
notifications
notification_deliveries
notification_preferences
```

### 12.2 Rules

- Domain module menerbitkan intent/event; notification module menangani rendering dan delivery.
- Template version yang digunakan harus dapat ditelusuri.
- Retry menggunakan bounded exponential backoff.
- Permanent failure masuk dead-letter/error review state.
- Idempotency mencegah duplicate delivery.
- User preference tidak boleh menonaktifkan mandatory security notification.
- Sensitive data diminimalkan, terutama untuk third-party channel.

## 13. Tasks, comments, tags, dan activity

### 13.1 Tasks

```text
tasks
task_assignees
task_watchers
task_status_history
```

Minimum field: title, description, priority, status, due_at, owning module, target reference, creator, assignee, organizational scope, dan timestamps.

Shared task status hanya untuk lifecycle umum:

```text
OPEN -> IN_PROGRESS -> COMPLETED
  |          |
  +--------> CANCELLED
```

Workflow khusus domain tidak boleh dipaksakan ke shared task status.

### 13.2 Comments

- Comment terhubung melalui typed target reference yang divalidasi oleh owning module.
- Edit/delete history dipertahankan sesuai policy.
- Mention menghasilkan notification intent.
- Rich text harus disanitasi; attachment memakai file module.

### 13.3 Tags

Tags digunakan untuk discovery/classification non-kritis. Tags tidak boleh menentukan authorization, accounting rule, clinical decision, compliance status, atau invariant domain.

## 14. Workflow engine

Workflow digunakan untuk process yang benar-benar configurable dan stateful.

### 14.1 Model

```text
workflow_definitions
workflow_definition_versions
workflow_states
workflow_transitions
workflow_instances
workflow_transition_history
```

### 14.2 Rules

- Published definition version immutable.
- Instance mengunci version yang digunakan.
- Transition memiliki source state, target state, permission, guard, dan optional action.
- Guard harus deterministic dan testable; arbitrary user script dilarang pada baseline ini.
- Setiap transition atomic dan idempotent terhadap retry.
- Concurrent transition menggunakan optimistic locking/version column.
- History mencatat actor, transition, from/to state, timestamp, dan reason.
- Domain invariant tetap berada pada domain service; workflow engine tidak boleh menjadi bypass.

## 15. Approval engine

Approval adalah capability terpisah dari workflow agar decision trail konsisten.

### 15.1 Model

```text
approval_definitions
approval_definition_versions
approval_requests
approval_steps
approval_step_assignees
approval_decisions
approval_delegations
```

Decision baseline:

```text
APPROVE
REJECT
RETURN_FOR_REVISION
CANCEL
```

### 15.2 Rules

- Request menyimpan subject type/id, requester, submitted snapshot/reference, dan definition version.
- Approver resolution dapat berbasis user, position, unit, role, atau rule yang tervalidasi.
- Requester tidak boleh menyetujui sendiri bila separation-of-duties diaktifkan.
- Delegation memiliki effective period, scope, dan audit.
- Keputusan final tidak diedit; koreksi dilakukan melalui superseding action.
- Concurrent decision dilindungi optimistic lock dan idempotency key.
- SLA/escalation boleh ditambahkan, tetapi auto-approval tidak menjadi default.

## 16. Dynamic forms

Dynamic form hanya digunakan untuk data tambahan yang risikonya terbatas. Data inti yang membutuhkan query, constraint, integration, atau regulatory meaning tetap memiliki typed schema/table.

### 16.1 Model

```text
form_definitions
form_definition_versions
form_sections
form_fields
form_submissions
form_submission_values
```

### 16.2 Rules

- Published form version immutable.
- Submission menyimpan form version.
- Server-side validation wajib mengikuti versioned JSON schema/typed rule.
- Field memiliki stable key; label dapat berubah tanpa mengubah key.
- Conditional visibility bukan pengganti validation.
- File field menggunakan file module.
- PII/sensitive classification didefinisikan per field.
- Formula/arbitrary code execution dilarang pada baseline ini.

## 17. Calendar dan scheduling

Capability umum:

- event dengan start/end;
- participant dan response;
- reminder;
- recurring rule sebagai extension;
- relation ke domain record;
- timezone-aware storage dan display.

Waktu disimpan sebagai UTC instant bila merepresentasikan kejadian absolut; timezone asal dipertahankan bila dibutuhkan untuk recurrence atau legal meaning. Scheduling resource khusus industri tetap berada di domain module.

## 18. Import dan export

### 18.1 Import flow

```text
upload -> scan -> parse -> validate -> preview -> confirm -> process -> report
```

Rules:

- import asynchronous untuk file besar;
- row-level validation dan downloadable error report;
- dry-run/preview sebelum commit untuk operasi berisiko;
- idempotency/import batch key;
- partial success policy harus eksplisit;
- permission dan organizational scope diterapkan per row;
- import tidak boleh bypass domain service/invariant;
- input CSV/spreadsheet dilindungi dari formula injection.

### 18.2 Export rules

- export mengikuti authorization dan current filters;
- sensitive column memerlukan permission eksplisit;
- large export asynchronous dengan expiring secure download;
- audit mencatat requester, scope, row count, dan result;
- CSV/spreadsheet output dinetralisasi terhadap formula injection.

## 19. Integration foundation

### 19.1 Capability

- outbound HTTP client dengan timeout;
- retry untuk transient failure;
- circuit breaker sebagai extension;
- idempotency key;
- webhook delivery dan signature;
- inbound webhook verification dan replay protection;
- transactional outbox;
- dead-letter/error queue state;
- external identifier mapping;
- integration audit tanpa secret leakage.

### 19.2 Model

```text
integration_connections
external_identifiers
idempotency_records
outbox_events
webhook_endpoints
webhook_deliveries
integration_failures
```

### 19.3 Rules

- Credential integrasi disimpan melalui secret facility, bukan database plaintext/settings biasa.
- Setiap connection memiliki owner, environment, purpose, data classification, dan rotation metadata.
- Retry hanya untuk failure yang aman; non-idempotent request memerlukan idempotency contract.
- Outbox event dibuat dalam transaction yang sama dengan business change.
- Payload memiliki schema/version dan bounded retention.
- External ID unik dalam `(tenant_id, integration_connection_id, entity_type, external_id)`; external identifier platform-level (tanpa tenant) harus terdaftar sebagai global table.
- Reconciliation job dan manual recovery path wajib tersedia untuk critical integration.

## 20. Search dan reporting

### 20.1 Search

- Setiap module mengontrol projection yang boleh dicari.
- Search result wajib difilter ulang dengan authorization.
- Secret/sensitive field tidak diindeks tanpa keputusan eksplisit.
- PostgreSQL search dapat digunakan lebih dahulu; external search engine memerlukan ADR.

### 20.2 Reporting

Baseline capability:

```text
report_definitions
saved_filters
report_runs
report_outputs
```

- Operational report menggunakan read/query model yang jelas.
- Heavy report asynchronous dan tidak mengganggu transaction workload.
- Report definition memiliki owner, permission, parameter schema, dan version.
- Financial/regulatory report khusus tetap dimiliki domain module.
- Export report mengikuti masking, access control, retention, dan audit.

## 21. Feature flags

Feature flag digunakan untuk controlled rollout, bukan authorization atau permanent configuration.

Minimum capability:

- boolean flag;
- environment scope;
- optional tenant/organization/user targeting (tenant targeting wajib memakai verified tenant context; flag tidak menggantikan entitlement);
- start/end time;
- owner dan expiry date;
- audit perubahan.

Flag yang lewat expiry harus direview dan dihapus setelah rollout stabil. Backend tetap menegakkan security rule walaupun UI disembunyikan oleh flag.

## 22. Data ownership dan cross-module reference

Setiap record lintas module harus memiliki:

```text
owning_module
target_type
target_id
```

Rules:

- Target type berasal dari registry, bukan arbitrary string dari client.
- Owning module memvalidasi existence dan access terhadap target.
- Shared module tidak melakukan direct query ke private table module lain.
- Cross-module side effect memakai application service atau domain/application event.
- Synchronous call digunakan bila hasil diperlukan untuk menjaga invariant; event digunakan untuk projection/side effect yang dapat eventual-consistent.
- Distributed event broker belum diperlukan pada modular monolith baseline ini.

### 22.1 Tenant propagation matrix

| Surface | Mandatory tenant control |
|---|---|
| Database row | `tenant_id NOT NULL`, application filter, tenant-safe FK/unique constraint, RLS |
| Request | Verified tenant context dari authenticated membership; fail-closed |
| Background job | Validated `tenant_id`, system/membership authority, idempotency, tenant-local DB transaction |
| Cache | Tenant-prefixed key dan tenant-safe invalidation |
| File/object | Tenant namespace, metadata ownership, authorized download |
| Search | Tenant field pada document dan mandatory tenant filter sebelum query/result |
| Report/export | Tenant-scoped query, permission, audit, expiring output |
| Notification | Tenant-owned template/config/delivery dan recipient validation |
| Integration/webhook | Tenant-owned connection, secret, idempotency, outbox, signature, retry |
| Audit/activity | Tenant identifier dan no cross-tenant visibility |
| Metrics/log | Tenant correlation tanpa sensitive tenant data |

Tidak ada shared module yang boleh dianggap tenant-safe hanya karena controller sudah memfilter `tenant_id`. Constraint database, RLS, secondary storage, asynchronous processing, dan negative isolation test tetap wajib.

## 23. Shared API standards

Base path mengikuti Infrastructure SSOT:

```text
/api/v1
```

Contoh route:

```text
GET    /api/v1/me
GET    /api/v1/me/contexts
POST   /api/v1/me/context-switch
POST   /api/v1/platform/tenants
PATCH  /api/v1/platform/tenants/:id/status
GET    /api/v1/members
POST   /api/v1/invitations
POST   /api/v1/invitations/accept
GET    /api/v1/organizations/:id/units
GET    /api/v1/reference-data/:setCode
POST   /api/v1/files
GET    /api/v1/notifications
PATCH  /api/v1/notifications/:id/read
POST   /api/v1/tasks
POST   /api/v1/approval-requests/:id/decisions
POST   /api/v1/import-jobs
GET    /api/v1/export-jobs/:id
```

Route `/platform/*` tidak memakai implicit tenant context dan wajib memiliki platform permission, reason/audit, rate limit, serta response minimization. Route tenant biasa tidak boleh menerima arbitrary `tenant_id` untuk mengganti resolved context.

### 23.1 List contract

List endpoint wajib memiliki bounded pagination:

```text
page
page_size
sort
filter
```

Default `page_size` dan maximum wajib ditetapkan per endpoint. Arbitrary field sorting/filtering dilarang; gunakan allowlist.

### 23.2 Mutation contract

- DTO server-side validation;
- optimistic locking (`version`/ETag) untuk concurrent editable record;
- idempotency key untuk retried create/decision/integration operation;
- consistent error code;
- audit untuk sensitive mutation;
- `created_at`, `created_by`, `updated_at`, dan `updated_by` bila relevan.

### 23.3 Error code categories

```text
VALIDATION_ERROR
AUTHENTICATION_REQUIRED
PERMISSION_DENIED
RESOURCE_NOT_FOUND
CONFLICT
INVALID_STATE_TRANSITION
RATE_LIMITED
DEPENDENCY_UNAVAILABLE
INTERNAL_ERROR
```

## 24. Frontend shared foundation

```text
frontend/src/
+-- app/
+-- components/
|   +-- ui/
|   +-- layout/
|   `-- feedback/
+-- features/
|   +-- auth/
|   +-- organization/
|   +-- notifications/
|   +-- files/
|   `-- tasks/
+-- lib/
|   +-- api/
|   +-- auth/
|   +-- permissions/
|   +-- formatting/
|   `-- validation/
`-- types/
```

Shared UI minimum:

- application shell dan responsive navigation;
- tenant identity indicator yang selalu terlihat pada authenticated area;
- tenant switcher hanya menampilkan active membership dan melakukan server-validated context switch;
- destructive/high-impact action menampilkan nama tenant aktif untuk mengurangi operator error;
- authenticated user menu;
- permission-aware navigation (UX only, bukan security boundary);
- loading, skeleton, empty, error, offline/retry state;
- toast/inline feedback;
- confirmation untuk destructive/high-impact action;
- accessible form field, table, dialog, pagination, dan file upload;
- timezone/locale-aware date and number formatting;
- global error boundary dan not-found page.

## 25. Security dan privacy baseline

- deny-by-default authorization;
- fail-closed tenant resolution dan mandatory tenant context untuk tenant-owned resource;
- organization/unit/resource scoping;
- information label: public, internal, confidential, restricted — untuk field personal wajib dipetakan ke DP-0…DP-4 sesuai Data Protection SSOT §4.1 (kontrol yang lebih ketat berlaku);
- field-level masking untuk sensitive output;
- purpose-aware export dan integration;
- immutable/append-only audit control;
- encryption in transit dan storage controls sesuai deployment;
- secret redaction;
- rate limiting dan abuse protection;
- file scanning dan content validation;
- retention, archive, legal hold, dan purge capability;
- data subject/privacy operation sebagai extension sesuai jurisdiction;
- no cross-tenant dan no cross-organization data leakage test;
- PostgreSQL RLS, non-owner runtime role, dan tenant-safe constraints;
- audited privileged/break-glass access tanpa implicit platform-admin visibility;
- dependency dan input security testing.

### 25.1 Mandatory Data Pribadi controls

- setiap field personal memiliki entry Data Field Register;
- Data Pribadi umum/spesifik diklasifikasikan DP-1/DP-2; credential/secret sebagai DP-3;
- direct identifier, contact/location identifier, seluruh Data Pribadi spesifik, dan retrievable secret mengikuti mandatory field encryption matrix;
- password dan non-retrievable token di-hash, bukan dienkripsi reversibel;
- file/dokumen personal disimpan private dan encrypted; DP-2 menggunakan application envelope encryption sesuai threat model;
- UI/API menggunakan minimization dan masking; unauthorized reveal ditolak dan diaudit;
- log, audit diff, cache, search, queue, analytics, export, backup, dan test data tidak boleh menjadi jalur bypass plaintext;
- tenant/purpose key separation dan KMS/HSM control mengikuti Data Protection and Field Encryption SSOT;
- pemrosesan Data Pribadi spesifik/high-risk memerlukan DPIA dan specialist approval sebelum production.

Regulatory compliance tidak boleh diklaim hanya karena base feature tersedia. Setiap industri/jurisdiction memerlukan requirement mapping dan approval terpisah.

## 26. Database conventions

Semua tabel mengikuti Infrastructure SSOT dan menggunakan:

```text
id
tenant_id (WAJIB untuk tenant-owned table)
created_at
created_by (jika relevan)
updated_at
updated_by (jika relevan)
version (untuk optimistic locking bila relevan)
archived_at / deleted_at (hanya sesuai lifecycle policy)
```

### 26.1 Rules

- Foreign key dan delete behavior eksplisit.
- Unique constraint tenant-owned wajib memasukkan tenant scope bila uniqueness bersifat per tenant.
- Tenant-owned foreign key harus membawa `tenant_id` dan mencegah cross-tenant relation.
- Runtime query wajib memakai tenant context transaction-local dan RLS; filter aplikasi saja tidak cukup.
- Table global/control-plane tanpa `tenant_id` harus didaftarkan eksplisit dan tidak boleh tercipta karena kelalaian.
- Index ditentukan dari access pattern, bukan ditambahkan ke semua column.
- JSON hanya untuk bounded extension metadata dengan schema validation.
- Soft delete bukan default universal; gunakan explicit lifecycle (`ACTIVE`, `ARCHIVED`, `PURGED`) sesuai module.
- Timestamp disimpan konsisten dengan timezone-aware database type.
- History/audit tidak dicampur dengan current-state table tanpa alasan teknis.
- Purge job harus idempotent, auditable, dan menghormati legal hold.

## 27. Recommended implementation phases

### Phase G0 — Shared contracts

- module boundary dan dependency rule disetujui;
- API response/error convention aktif;
- request ID, validation, error filter, logging, dan audit interface tersedia;
- data classification dan authorization policy ditetapkan;
- tenant context contract, global-table registry, dan tenant propagation matrix disetujui.

### Phase G1 — Tenancy, IAM, dan organization

- tenant lifecycle, domain/slug, memberships, entitlements, tenant roles, organization, unit, dan workforce membership;
- tenant provisioning, suspension, reactivation, offboarding, dan purge guard;
- login/session lifecycle;
- backend tenant/permission/resource-scope enforcement;
- database RLS dan tenant-safe constraints;
- automated two-tenant isolation suite;
- security audit event dan privileged-access audit.

### Phase G2 — Reference data dan settings

- version-safe reference value lifecycle;
- typed setting definition, precedence, validation, dan audit;
- no secret stored in generic settings.

### Phase G3 — Files dan notifications

- secure upload/download metadata flow;
- scanning adapter contract;
- in-app notification dan delivery state;
- retry/idempotency.

### Phase G4 — Collaboration

- tasks, comments, mentions, tags, dan activity projection;
- resource-level authorization;
- accessible frontend states.

### Phase G5 — Workflow dan approvals

- immutable definition versions;
- guarded/idempotent transition;
- approval history, concurrency protection, delegation, dan separation of duties.

### Phase G6 — Integration dan data movement

- import/export jobs;
- webhook signing/verification;
- outbox, retry, failure review, external identifier, dan reconciliation.

### Phase G7 — Domain onboarding

- domain module menggunakan shared contracts tanpa menyalin shared table/service;
- domain-specific rule tetap di domain;
- extension point dan ownership tervalidasi;
- domain table memiliki tenant-safe schema/RLS/index/relations;
- end-to-end tenant isolation, permission, audit, failure, dan concurrency scenario lulus.

## 28. Acceptance criteria

General Feature Base diterima jika:

- module boundary dan ownership dapat ditelusuri dari code;
- tidak ada frontend/direct database access;
- IAM menegakkan tenant, permission, organizational, dan resource scope di backend;
- user, party, organization, dan tenant tidak diperlakukan sebagai konsep yang sama;
- tenant context tidak dapat dipilih dari arbitrary client input dan request tanpa valid context gagal secara tertutup;
- tenant-owned schema memiliki `tenant_id`, RLS, scoped uniqueness, tenant-safe relation, dan index yang sesuai;
- runtime database role bukan owner/superuser dan tidak mempunyai `BYPASSRLS`;
- reference data dan settings tervalidasi serta diaudit;
- file private-by-default dan melewati validation/scanning state;
- notification retry idempotent dan tidak membocorkan sensitive payload;
- audit log mencatat action penting tanpa secret;
- workflow/approval definition version immutable setelah published;
- transition dan decision aman terhadap retry/concurrency;
- import/export melewati domain validation dan authorization;
- integration memiliki timeout, retry classification, idempotency, outbox, failure review, dan reconciliation path;
- list API bounded dan mutation API memiliki conflict handling;
- setiap feature memiliki loading, error, empty, permission-denied, dan success state;
- automated tests mencakup happy path, validation, unauthorized, forbidden, conflict, idempotent retry, dan dependency failure;
- cross-tenant/cross-organization leakage test lulus untuk API, direct repository, relation, search, file, cache, job, notification, integration, report, dan export;
- tenant provisioning/lifecycle dan tenant switch bersifat idempotent, tervalidasi, dan diaudit;
- privileged support access tidak implicit dan selalu bounded, justified, serta diaudit;
- tidak ada domain-specific logic yang bocor ke shared core tanpa approved change;
- OpenAPI dan migration konsisten dengan implementation.
- seluruh field personal terdaftar, memiliki classification/purpose/retention/owner, dan menerapkan encryption/hash/tokenization sesuai policy;
- mandatory plaintext leak tests lulus pada database dump, log, audit, cache, search, queue, file, analytics, export, backup, dan error path;
- key rotation, cross-tenant key denial, AAD substitution failure, KMS outage fail-closed, dan backup-key recovery tests lulus;

## 29. Definition of Done

Satu shared module dinyatakan **DONE** hanya jika:

1. tujuan, owner, boundary, entity, state, API, permission, dan extension point terdokumentasi;
2. schema migration, constraint, index, rollback/mitigation, dan clean-database replay lulus;
3. backend build, lint, unit, integration, authorization, concurrency, dan audit tests lulus;
4. frontend build, lint, accessibility smoke test, responsive state, dan failure state lulus;
5. OpenAPI, `.env.example`, operational notes, dan SSOT sinkron;
6. sensitive data classification, log redaction, retention, archive/purge, dan export behavior ditinjau;
7. error handling, idempotency, retry, dan dependency failure telah diuji bila applicable;
8. tidak ada unresolved critical/high security defect;
9. evidence dapat ditelusuri ke commit/release yang diuji;
10. approver yang berwenang memberi sign-off sesuai scope-nya.
11. tenant propagation matrix dan negative isolation tests lulus untuk setiap storage/processing surface yang digunakan module;
12. Security/Privacy dan Operations review selesai sebelum shared module dipakai pada production multi-tenant.
13. Data Field Register, DPIA requirement, encryption mapping, masking, retention, dan Legal/DPO review selesai untuk seluruh Data Pribadi yang diproses.

Build sukses saja bukan Definition of Done.

## 30. Domain extension checklist

Sebelum menambahkan domain industri baru, jawab dan dokumentasikan:

```text
Domain name dan owner
Actors dan organizational scope
Tenant ownership dan platform/global boundary
Data Field Register dan DP-0/DP-1/DP-2/DP-3/DP-4 classification
Field encryption, hashing, tokenization, masking, key purpose, dan search/blind-index requirement
Core entities dan aggregate boundaries
Business identifiers
States dan allowed transitions
Approval/separation-of-duties rules
Permissions dan resource scope
Sensitive/restricted fields
Retention, archive, legal hold, purge
Audit events
API contracts
Integration identifiers dan source of truth
Concurrency/idempotency behavior
Reports/exports
Failure and recovery paths
Regulatory mappings dan required approvers
```

## 31. Approval record

| Role | Name | Decision | Date | Evidence/Reference |
|---|---|---|---|---|
| Document Owner | `<OWNER_PLACEHOLDER>` | Pending | — | — |
| Product/Architecture Direction | `<REQUESTER_PLACEHOLDER>` | Adopt SaaS multi-tenant and PDP field-encryption baseline | 2026-09-16 | ADR-001 + Data Protection and Field Encryption SSOT |
| Technical Approver | `<TECHNICAL_APPROVER_PLACEHOLDER>` | Pending | — | — |
| Security/Privacy Reviewer | `<SECURITY_REVIEWER_PLACEHOLDER>` | Pending | — | — |
| Operations Reviewer | `<OPERATIONS_REVIEWER_PLACEHOLDER>` | Pending | — | — |

Persetujuan satu role tidak boleh dianggap sebagai persetujuan role lain.

## 33. Open decisions

- pricing, plans, subscription, metering, quota, invoice, dan payment provider;
- tenant custom-domain verification dan certificate automation;
- privileged support/break-glass operating procedure;
- single-tenant logical backup/restore dan portability format;
- MFA mechanism dan identity provider/SSO;
- object storage dan malware scanner;
- email/SMS/push providers;
- search engine;
- background job implementation;
- report rendering engine;
- localization languages dan supported timezones;
- retention matrix per data class;
- privacy/regulatory requirements per deployment;
- real-time notification/collaboration;
- commercial billing implementation.

## Riwayat

| Edisi | Tanggal | Ringkasan |
|---|---|---|
| 2.0 | 2026-09-16 | Edisi final hasil konsolidasi dari General Feature Base SSOT v1.4; penanda revisi dan change log berlapis dihapus; isi normatif tidak diubah selain perapian rujukan. Riwayat keputusan: `README.md` §5; versi lengkap sebelumnya: `_archive/` |
