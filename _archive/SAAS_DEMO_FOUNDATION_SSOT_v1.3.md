---
title: "SaaS Demo Foundation SSOT"
document_id: "SAAS-DEMO-FOUNDATION-SSOT"
version: "1.3"
status: "Proposed Demo Baseline / Ready for Refinement after ADR-001 v1.3, ADR-002 v1.1, ADR-003 v1.1 Review"
owner: "<OWNER_PLACEHOLDER>"
last_updated: "2026-09-16"
supersedes: "SAAS_DEMO_FOUNDATION_SSOT_v1.2.md"
implementation_scope: "Authentication, invitation, profile, SaaS tenancy, RBAC, platform superadmin with break-glass support session, dynamic menu, session, and audit"
parent_documents:
  - "INFRASTRUCTURE_SSOT_v1.5.md"
  - "GENERAL_FEATURE_BASE_SSOT_v1.4.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md"
  - "ADR-001-SAAS-MULTI-TENANCY_v1.3.md"
  - "ADR-002-IDENTITY-MODEL_v1.1.md"
  - "ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.1.md"
  - "PRE_CONTEXT_FUNCTION_REGISTER_v1.0.md"
review_reference: "REVIEW_BASELINE_DOCS_v2_2026-09-16.md"
change_control: "Perubahan scope, tenant boundary, authentication flow, permission model, menu visibility rule, database schema, atau acceptance criteria MUST diperbarui di dokumen ini sebelum implementasi."
---

# SaaS Demo Foundation SSOT v1.3

> **Perubahan v1.3:** Opsi A (policy `TO app_auth_definer`) — seluruh akses pre-context/cross-context merujuk `PRE_CONTEXT_FUNCTION_REGISTER_v1.0.md`; login bercabang ke context TENANT/PLATFORM dengan tiket pemilihan (superadmin kini dapat login); `sessions`/`refresh_tokens` mixed-ownership; tabel `auth_selection_tickets`, `invitation_roles`, `tenant_notifications`; contact email copy pada `tenant_member_profiles` untuk daftar/pencarian member; support session ke tenant non-ACTIVE (READ_ONLY); route `me/contexts`; test & scenario diperbarui.

> **Perubahan v1.2:** superadmin platform tetap ada (ADR-003): role `platform_superadmin`, permission platform lengkap, break-glass support session (maks. 60 menit, alasan wajib, default READ_ONLY, teraudit, terlihat oleh tenant), tabel `platform_role_assignments` & `support_sessions`, halaman console superadmin, Scenario 6, dan test terkait.

> **Perubahan v1.1:** model identitas mengikuti ADR-002 (invitation, tenant member profile, tidak ada create/update identitas oleh admin tenant); klasifikasi tabel diselaraskan dengan Infrastructure SSOT v1.3 §8.3; login/refresh/audit pre-context memakai fungsi ADR-001 §3.7; menu administration CRUD diturunkan menjadi optional (P2); provisioning demo tanpa organization; open decision email identity ditutup.

## 1. Purpose

Dokumen ini menetapkan baseline implementasi aplikasi SaaS dasar yang dapat didemonstrasikan tanpa fitur bisnis. Demo harus membuktikan bahwa fondasi authentication, tenant isolation, authorization, dynamic navigation, dan audit bekerja secara nyata dari frontend sampai database.

Demo bukan sekadar UI prototype. Menu yang disembunyikan tanpa backend authorization, logout yang hanya menghapus browser state, atau tenant selector tanpa database isolation tidak memenuhi dokumen ini.

## 2. Scope

### 2.1 In scope

```text
Authentication
|-- Login
|-- Refresh session
|-- Logout
`-- Current-user profile

Platform Superadmin (ADR-003)
|-- Tenant registry & status
|-- Platform admin management
|-- Platform audit
`-- Break-glass support session

SaaS Tenancy
|-- Tenant registry
|-- Tenant membership
|-- Active tenant context
|-- Context selection & switch (TENANT/PLATFORM)
`-- Cross-tenant isolation

IAM / RBAC
|-- Members (tenant view of identities)
|-- Invitations
|-- Roles
|-- Permissions
|-- Member-role assignment
`-- Role-permission assignment

Dynamic Navigation
|-- Menu registry (seeded)
|-- Parent-child hierarchy
|-- Permission mapping
|-- Ordering
|-- Active/inactive state
`-- Menu administration CRUD (OPTIONAL / P2)

Control
|-- Session and refresh-token lifecycle
|-- Security audit events
|-- Request ID
`-- Health check and OpenAPI
```

### 2.2 Out of scope

- workflow dan approval;
- organization, unit, dan position (provisioning demo tidak membuat organization);
- perubahan email login, password change, account recovery;
- email delivery undangan (token undangan dikeluarkan melalui demo provisioning channel);
- name search berbasis search token (ADR-002 §2.5); demo mencari member berdasarkan email exact;
- dynamic form;
- task/comment/calendar;
- notification provider eksternal;
- file attachment;
- reporting dan export;
- import dan integration/webhook;
- billing, subscription charging, invoice, dan payment;
- custom domain dan certificate automation;
- SSO, social login, dan MFA;
- domain bisnis industri;
- mobile application;
- microservices, Redis, queue, dan WebSocket;
- production go-live dan regulatory compliance certification.

Penambahan fitur out-of-scope memerlukan perubahan dokumen dan acceptance criteria, bukan disisipkan diam-diam selama implementasi.

## 3. Architecture boundary

```text
Browser
   |
   v
Next.js :3000
   |
   | REST / JSON
   v
NestJS :4000
   |-- Authentication
   |-- Tenant context
   |-- Permission guard
   |-- Menu resolver
   |-- Audit
   v
Prisma 7
   v
PostgreSQL 18 :5432
   |-- tenant-aware constraints
   `-- Row-Level Security
```

Rules:

- Next.js tidak mengakses Prisma atau PostgreSQL.
- Semua authorization ditegakkan NestJS.
- Frontend permission/menu filtering hanya UX, bukan security boundary.
- Tenant context ditetapkan server-side dari authenticated membership.
- Database tenant-owned table memakai `tenant_id` dan RLS sesuai Infrastructure SSOT.

## 4. Actors

| Actor | Description |
|---|---|
| Platform Superadmin | Kewenangan penuh atas platform (tenant, status, domain, entitlement, status identitas global, admin platform, menu global, audit platform). Akses data tenant **hanya** melalui break-glass support session (ADR-003) |
| Tenant Owner | Administrator tertinggi dalam satu tenant |
| Tenant Administrator | Mengundang member, mengelola profil tenant member, role, dan permission assignment sesuai permission; tidak dapat membuat/mengubah identitas global |
| Tenant User | Mengakses profile dan menu yang diberikan melalui role |
| Auditor/Viewer | Read-only terhadap data IAM/audit yang diizinkan |

Platform Superadmin menggunakan route dan permission platform terpisah; tidak melakukan impersonation. Tenant Owner dan Tenant Administrator tetap dibatasi tenant aktif.

## 5. Permission catalog

Permission memakai format `<resource>.<action>` dan bersifat immutable setelah dipakai oleh role, kecuali melalui controlled migration.

Baseline permission:

```text
profile.read
profile.update

members.read
members.invite
members.update_profile
members.suspend
members.assign_role

roles.read
roles.create
roles.update
roles.archive
roles.assign_permission

permissions.read

menus.read
menus.create
menus.update
menus.archive
menus.assign_permission

audit.read

platform.tenants.read
platform.tenants.create
platform.tenants.update_status
platform.tenant_domains.manage
platform.entitlements.manage
platform.identities.read_status
platform.identities.suspend
platform.identities.unlock
platform.admins.read
platform.admins.manage
platform.menus.manage
platform.reference_data.manage
platform.audit.read
platform.permissions.read
platform.support.start_read
platform.support.start_write
```

Rules:

- Role adalah bundel permission; source code tidak boleh bergantung pada nama role untuk authorization.
- Permission platform tidak boleh diberikan kepada tenant role.
- `profile.read` hanya memberi akses ke profile user aktif, bukan seluruh user.
- Permission `users.*` (v1.0) diganti `members.*` (v1.1); tidak ada permission tenant untuk membuat atau mengubah identitas global.
- `menus.create/update/archive/assign_permission` hanya diseed bila menu administration P2 diimplementasikan.
- Assignment role/permission tidak boleh melampaui tenant atau kewenangan actor.
- Tenant Owner bukan bypass terhadap RLS atau tenant boundary.

## 6. Baseline roles

| Role | Scope | Baseline permission |
|---|---|---|
| `platform_superadmin` | Platform | Seluruh `platform.*`; tidak implicit tenant data access; akses data tenant via support session (ADR-003) |
| `tenant_owner` | Tenant | Seluruh tenant permission dalam demo |
| `tenant_admin` | Tenant | Profile, member, invitation, role, permission, (menu bila P2), dan audit administration yang ditetapkan seed |
| `tenant_user` | Tenant | `profile.read`, `profile.update`, dan menu dasar |
| `tenant_auditor` | Tenant | Read-only IAM dan `audit.read` |

Nama role adalah seed/demo convention. Backend guard tetap mengevaluasi permission dan scope, bukan string role.

## 7. Database model

### 7.1 Table inventory

```text
tenants
tenant_domains

users
credentials
sessions
refresh_tokens

tenant_memberships
tenant_member_profiles
user_invitations
invitation_roles
auth_selection_tickets
roles
permissions
role_permissions
user_role_assignments

menus
menu_permissions

audit_logs

platform_role_assignments
support_sessions
tenant_notifications
```

### 7.2 Tenant ownership classification

Klasifikasi mengikuti **Infrastructure SSOT v1.5 §8.3 (Table Ownership Register)**; akses pre-context/cross-context mengikuti **`PRE_CONTEXT_FUNCTION_REGISTER_v1.0.md`** (ID fungsi F-xx). Tabel di bawah adalah subset demo dan tidak boleh berbeda dari kedua sumber tersebut.

| Table | Class | `tenant_id` | RLS untuk `app_user` | Register |
|---|---|---:|---|---|
| `tenants` | Tenant control-plane | Row identity | Platform policy + baris sendiri | F-01, F-04, F-11 |
| `tenant_domains` | Tenant control-plane | Required | Required | F-01 |
| `users` | Platform-global | No | Tidak ada grant | F-02 |
| `credentials` | Platform-global secret | No | Tidak ada grant | F-02, F-03 |
| `auth_selection_tickets` | Platform-global transient | No | Tidak ada grant | F-05, F-06 |
| `sessions` | Mixed-ownership (`context_kind`) | Required untuk TENANT; NULL untuk PLATFORM | Baris TENANT saja | F-07–F-10 |
| `refresh_tokens` | Mixed-ownership (`context_kind`) | idem | Baris TENANT saja | F-07–F-10 |
| `tenant_memberships` | Tenant-owned | Required | Required | F-04, F-06, F-12, F-15 |
| `tenant_member_profiles` | Tenant-owned | Required | Required | F-12 |
| `user_invitations` | Tenant-owned | Required | Required | F-11, F-12 |
| `invitation_roles` | Tenant-owned | Required | Required | F-12 |
| `roles` | Tenant-owned | Required | Required | — |
| `permissions` | Platform-global catalog | No | Read-only grant | — |
| `role_permissions` | Tenant-owned | Required | Required | — |
| `user_role_assignments` | Tenant-owned | Required | Required | F-12 |
| `menus` | Mixed-ownership | NULL hanya baris platform | ADR-001 §3.8 | — |
| `menu_permissions` | Mixed-ownership | NULL hanya baris platform | ADR-001 §3.8 | — |
| `audit_logs` | Mixed-ownership | NULL hanya event platform/pre-context | ADR-001 §3.8; update/delete revoked | F-14 |
| `platform_role_assignments` | Platform-global | No | Tidak ada grant | F-04, F-06, F-13 |
| `support_sessions` | Tenant control-plane | Required | Policy per context (ADR-003 §2.4) | — |
| `tenant_notifications` | Tenant-owned | Required | Baca dengan `audit.read`; tanpa insert | F-15 |

Table tanpa `tenant_id` harus terdaftar sebagai platform/global table dan tidak boleh menjadi jalur akses lintas tenant.

### 7.3 Logical schema

#### `tenants`

```text
id UUID PK
code VARCHAR UNIQUE NOT NULL
name VARCHAR NOT NULL
slug VARCHAR UNIQUE NOT NULL
status ENUM/validated VARCHAR NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
version INTEGER NOT NULL
```

Status demo:

```text
PROVISIONING
ACTIVE
SUSPENDED
ARCHIVED
```

#### `users`

```text
id UUID PK
email_ciphertext BYTEA/JSON envelope NOT NULL
email_blind_index BYTEA UNIQUE NOT NULL
legal_name_ciphertext BYTEA/JSON envelope NULL
status VARCHAR NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
version INTEGER NOT NULL
```

`users` merepresentasikan identity global (ADR-002). Enkripsi memakai key purpose `platform_identity` sebagai pengecualian terkontrol Data Protection SSOT v1.1 §9.1. Admin tenant tidak memiliki read/write path ke tabel ini; nama yang tampil di tenant berasal dari `tenant_member_profiles`.

#### `tenant_member_profiles`

```text
tenant_id UUID NOT NULL
membership_id UUID NOT NULL
display_name_ciphertext BYTEA/JSON envelope NOT NULL   (DEK tenant, AAD memuat tenant_id)
contact_email_ciphertext BYTEA/JSON envelope NOT NULL  (DEK tenant; salinan saat undangan diterima)
contact_email_blind_index_tenant BYTEA NOT NULL        (HMAC key identity_blind_index tenant)
contact_email_captured_at TIMESTAMPTZ NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
version INTEGER NOT NULL
PRIMARY KEY (tenant_id, membership_id)
FK (tenant_id, membership_id) -> tenant_memberships (tenant_id, id)
UNIQUE (tenant_id, contact_email_blind_index_tenant)
```

Contact email adalah sumber email masked dan filter `email exact` pada `GET /members` (ADR-002 v1.1 §2.6). Salinan tidak otomatis mengikuti perubahan email global (di luar scope demo).

#### `user_invitations`

```text
id UUID PK
tenant_id UUID NOT NULL
email_ciphertext BYTEA/JSON envelope NOT NULL          (DEK tenant)
email_blind_index_tenant BYTEA NOT NULL                (HMAC tenant-scoped)
token_hash BYTEA NOT NULL
status VARCHAR NOT NULL  -- PENDING|ACCEPTED|EXPIRED|REVOKED
invited_by UUID NOT NULL
expires_at TIMESTAMPTZ NOT NULL
accepted_membership_id UUID NULL
created_at TIMESTAMPTZ NOT NULL
UNIQUE (tenant_id, id)
UNIQUE (tenant_id, email_blind_index_tenant) WHERE status = 'PENDING'
```

#### `invitation_roles`

```text
tenant_id UUID NOT NULL
invitation_id UUID NOT NULL
role_id UUID NOT NULL
PRIMARY KEY (tenant_id, invitation_id, role_id)
FK (tenant_id, invitation_id) -> user_invitations (tenant_id, id)
FK (tenant_id, role_id) -> roles (tenant_id, id)
```

Role dari tenant lain ditolak oleh composite FK (menggantikan `intended_role_ids UUID[]` v1.2).

#### `auth_selection_tickets`

```text
id UUID PK
user_id UUID NOT NULL
ticket_hash BYTEA UNIQUE NOT NULL
created_at TIMESTAMPTZ NOT NULL
expires_at TIMESTAMPTZ NOT NULL      -- <= created_at + 5 menit
consumed_at TIMESTAMPTZ NULL
CHECK (expires_at <= created_at + interval '5 minutes')
```

Hanya diakses melalui F-05/F-06; baris kedaluwarsa dibersihkan job berkala.

#### `credentials`

```text
user_id UUID PK/FK
password_hash TEXT NOT NULL
password_algorithm VARCHAR NOT NULL
password_parameter_version INTEGER NOT NULL
password_changed_at TIMESTAMPTZ NOT NULL
failed_attempts INTEGER NOT NULL DEFAULT 0
locked_until TIMESTAMPTZ NULL
```

Password disimpan sebagai adaptive salted hash; plaintext password dilarang disimpan atau dicatat.

#### `tenant_memberships`

```text
id UUID PK
tenant_id UUID NOT NULL
user_id UUID NOT NULL
status VARCHAR NOT NULL
joined_at TIMESTAMPTZ NOT NULL
ended_at TIMESTAMPTZ NULL
version INTEGER NOT NULL
UNIQUE (tenant_id, user_id)
UNIQUE (tenant_id, id)
```

#### `roles`

```text
id UUID PK
tenant_id UUID NOT NULL
code VARCHAR NOT NULL
name VARCHAR NOT NULL
description TEXT NULL
is_system BOOLEAN NOT NULL DEFAULT FALSE
is_active BOOLEAN NOT NULL DEFAULT TRUE
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
version INTEGER NOT NULL
UNIQUE (tenant_id, code)
UNIQUE (tenant_id, id)
```

#### `permissions`

```text
id UUID PK
code VARCHAR UNIQUE NOT NULL
name VARCHAR NOT NULL
description TEXT NULL
resource VARCHAR NOT NULL
action VARCHAR NOT NULL
is_active BOOLEAN NOT NULL DEFAULT TRUE
```

#### `role_permissions`

```text
tenant_id UUID NOT NULL
role_id UUID NOT NULL
permission_id UUID NOT NULL
created_at TIMESTAMPTZ NOT NULL
created_by UUID NOT NULL
PRIMARY KEY (tenant_id, role_id, permission_id)
FK (tenant_id, role_id) -> roles (tenant_id, id)
```

#### `user_role_assignments`

```text
id UUID PK
tenant_id UUID NOT NULL
membership_id UUID NOT NULL
role_id UUID NOT NULL
assigned_at TIMESTAMPTZ NOT NULL
assigned_by UUID NOT NULL
ended_at TIMESTAMPTZ NULL
UNIQUE active assignment (tenant_id, membership_id, role_id)
tenant-safe FK for membership and role
```

#### `menus`

```text
id UUID PK
tenant_id UUID NULL
parent_id UUID NULL
code VARCHAR NOT NULL
label VARCHAR NOT NULL
path VARCHAR NULL
icon VARCHAR NULL
sort_order INTEGER NOT NULL DEFAULT 0
is_active BOOLEAN NOT NULL DEFAULT TRUE
is_system BOOLEAN NOT NULL DEFAULT FALSE
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
version INTEGER NOT NULL
```

Constraints:

- platform menu memiliki `tenant_id IS NULL` dan hanya dibuat melalui platform administration/seed;
- tenant menu memiliki `tenant_id NOT NULL`;
- parent dan child harus berada pada ownership scope yang valid;
- hierarchy tidak boleh cycle;
- route internal harus berasal dari allowlist/validated application route;
- external arbitrary URL tidak didukung dalam demo;
- uniqueness code minimal `(tenant ownership scope, code)`.

#### `menu_permissions`

```text
tenant_id UUID NULL
menu_id UUID NOT NULL
permission_id UUID NOT NULL
match_mode VARCHAR NOT NULL DEFAULT 'ANY'
created_at TIMESTAMPTZ NOT NULL
PRIMARY KEY (ownership scope, menu_id, permission_id)
```

`ANY` berarti user dapat melihat menu jika memiliki minimal satu permission yang dipetakan. Dukungan `ALL` boleh ada jika diimplementasikan dan diuji eksplisit.

#### `sessions` dan `refresh_tokens`

```text
sessions:
  id UUID PK
  context_kind VARCHAR NOT NULL          -- TENANT | PLATFORM (v1.3)
  tenant_id UUID NULL
  user_id UUID NOT NULL
  membership_id UUID NULL
  status VARCHAR NOT NULL
  created_at TIMESTAMPTZ NOT NULL
  last_seen_at TIMESTAMPTZ NULL
  expires_at TIMESTAMPTZ NOT NULL
  revoked_at TIMESTAMPTZ NULL
  revocation_reason VARCHAR NULL
  CHECK ((context_kind = 'TENANT') = (tenant_id IS NOT NULL))
  CHECK ((context_kind = 'TENANT') = (membership_id IS NOT NULL))

refresh_tokens:
  id UUID PK
  context_kind VARCHAR NOT NULL          -- sama dengan session
  tenant_id UUID NULL
  session_id UUID NOT NULL
  token_hash BYTEA NOT NULL
  family_id UUID NOT NULL
  issued_at TIMESTAMPTZ NOT NULL
  expires_at TIMESTAMPTZ NOT NULL
  rotated_at TIMESTAMPTZ NULL
  revoked_at TIMESTAMPTZ NULL
  replaced_by_id UUID NULL
  CHECK ((context_kind = 'TENANT') = (tenant_id IS NOT NULL))
```

RLS untuk `app_user` hanya mencakup baris `context_kind = 'TENANT'` milik tenant aktif; baris `PLATFORM` hanya melalui fungsi register F-07–F-10.

Raw refresh token tidak disimpan. Reuse token yang sudah dirotasi mencabut token family/session sesuai policy.

#### `audit_logs`

```text
id UUID PK
tenant_id UUID NULL
occurred_at TIMESTAMPTZ NOT NULL
actor_type VARCHAR NOT NULL
actor_id UUID NULL
action VARCHAR NOT NULL
target_type VARCHAR NULL
target_id UUID NULL
result VARCHAR NOT NULL
reason_code VARCHAR NULL
request_id UUID/VARCHAR NOT NULL
metadata_json JSONB NOT NULL
```

Audit payload tidak boleh memuat password, token, credential, raw email, raw name, authorization header, atau before/after personal data.

Event yang terjadi sebelum tenant context (misalnya `auth.login.failed`) atau yang ditulis dari context platform ke audit tenant (misalnya `support.session.started`) memakai `audit_w.write_event` (register F-14) dengan allowlist action; `UPDATE`/`DELETE` pada `audit_logs` di-revoke dari `app_user`.

#### `tenant_notifications`

```text
id UUID PK
tenant_id UUID NOT NULL
type VARCHAR NOT NULL                 -- SUPPORT_SESSION_STARTED | SUPPORT_SESSION_ENDED
ref_id UUID NOT NULL                  -- support_session_id
created_at TIMESTAMPTZ NOT NULL
read_at TIMESTAMPTZ NULL
read_by_membership_id UUID NULL
UNIQUE (tenant_id, id)
```

Notifikasi keamanan in-app minimal (ADR-003 v1.1 §2.4); insert hanya via F-15; dibaca member dengan `audit.read`.

## 8. Authentication and session flow

### 8.1 Login dan pemilihan context (revisi v1.3)

```text
POST /auth/login (email, password)
  -> normalize email -> platform blind index
  -> F-02 find_identity_for_login                                   [pre-context]
  -> verify Argon2id di aplikasi (constant-work path bila user tidak ada)
  -> F-03 record_login_attempt
  -> F-04 list_login_contexts(user_id)                              [pre-context]
       TENANT: membership aktif pada tenant ACTIVE
       PLATFORM: bila memiliki platform_role_assignments aktif
  -> 0 context  : respons gagal generik + audit (F-14)
  -> 1 context  : F-07 create_session -> access token (context claim) + refresh cookie
  -> >1 context : F-05 create_selection_ticket (TTL <= 5 menit, cookie HttpOnly)
                  respons { selection_required: true }
GET  /auth/contexts           (hanya tiket)   -> daftar context (nama tenant, "Platform")
POST /auth/select-context     (tiket + target) -> F-06 consume -> F-07 create_session
  -> audit auth.login.succeeded (tenant context via writer biasa, platform via F-14)
```

Refresh:

```text
POST /auth/refresh
  -> hash refresh token
  -> F-08 find_refresh_token(hash)                                  [pre-context]
  -> TENANT: verify tenant ACTIVE, membership ACTIVE, session ACTIVE
     PLATFORM: verify platform role masih aktif, session ACTIVE
  -> F-09 rotate_refresh_token atomik; reuse -> F-10 revoke family
  -> issue new access token dengan context_kind yang sama
```

Login response tidak boleh membedakan “email tidak ada”, “password salah”, atau “tidak punya context”. Rate limiting dan lockout/backoff harus tersedia.

### 8.2 Context selection dan switch

- User dengan satu context (satu membership, atau superadmin tanpa membership) masuk otomatis.
- User dengan lebih dari satu context (multi-membership, atau superadmin yang juga member) memilih dari daftar server melalui tiket.
- Tiket tidak dapat dipakai untuk endpoint selain `GET /auth/contexts` dan `POST /auth/select-context`.
- `POST /me/context-switch` memverifikasi target, membuat session baru, dan mencabut session lama; audit `auth.context_switched`.
- Token context PLATFORM hanya diterima `/platform/*`; token TENANT hanya route tenant.
- Logout session PLATFORM mengakhiri support session aktif milik superadmin.

### 8.3 Refresh

- Refresh token diputar pada setiap penggunaan.
- Token lama tidak dapat digunakan kembali.
- Tenant, user, membership, dan session status diverifikasi.
- Reuse terdeteksi menghasilkan revocation dan security audit.

### 8.4 Logout

```text
POST /api/v1/auth/logout
  -> authenticate session/refresh context
  -> revoke current session
  -> revoke active refresh-token family
  -> clear protected cookie/browser state
  -> write audit event
```

Menghapus token hanya di browser bukan logout yang valid.

## 9. Authorization flow

```text
Authenticated request
  -> resolve verified tenant context
  -> verify active tenant and membership
  -> derive active role assignments
  -> derive effective permissions
  -> check endpoint permission
  -> check resource/record scope
  -> set transaction-local DB tenant context
  -> execute use case
  -> audit sensitive action
```

Default decision adalah deny. Permission cache, jika kelak digunakan, harus tenant-scoped dan invalidated setelah assignment berubah. Demo boleh menghitung langsung dari database untuk menghindari cache complexity.

## 10. Dynamic menu resolution

### 10.1 Menu visibility algorithm

Backend `GET /api/v1/me/menu`:

1. memverifikasi session, tenant, dan membership;
2. menghitung effective permissions;
3. mengambil menu platform aktif dan menu tenant aktif;
4. mengevaluasi `menu_permissions`;
5. membuang menu yang tidak memenuhi permission;
6. membuang parent tanpa visible child dan tanpa accessible route sendiri;
7. menyusun hierarchy berdasarkan `parent_id`;
8. mengurutkan `sort_order`, lalu stable secondary order;
9. mengembalikan DTO minimal tanpa internal permission/debug data yang tidak dibutuhkan.

### 10.2 Visibility rules

- Menu tanpa permission mapping bersifat deny-by-default, kecuali secara eksplisit ditandai public-authenticated menu oleh schema/policy.
- Parent tampil jika memiliki route yang diizinkan atau minimal satu visible child.
- Inactive menu dan descendant yang tidak memiliki valid parent tidak ditampilkan.
- Tenant menu tidak terlihat di tenant lain.
- Frontend tetap melakukan route-level UX guard, tetapi backend endpoint selalu melakukan permission guard.
- Perubahan role/permission/menu terlihat setelah effective-permission/menu state diperbarui; demo tanpa cache sebaiknya berlaku pada request berikutnya.

### 10.3 Example response

```json
{
  "success": true,
  "data": [
    {
      "code": "dashboard",
      "label": "Dashboard",
      "path": "/dashboard",
      "icon": "layout-dashboard",
      "children": []
    },
    {
      "code": "administration",
      "label": "Administration",
      "path": null,
      "icon": "settings",
      "children": [
        {
          "code": "members",
          "label": "Members",
          "path": "/administration/members",
          "icon": "users",
          "children": []
        }
      ]
    }
  ],
  "meta": {}
}
```

## 11. API contract

Base URL:

```text
/api/v1
```

### 11.1 Authentication and current user

```text
POST /auth/login
POST /auth/refresh
POST /auth/logout

GET   /me
PATCH /me/profile
GET   /me/permissions
GET   /me/menu
GET   /me/contexts
POST  /me/context-switch
```

Tambahan (v1.3):

```text
GET  /auth/contexts          (hanya dengan tiket pemilihan)
POST /auth/select-context
GET  /notifications/security  (audit.read) -> tenant_notifications tenant aktif
POST /notifications/security/:id/read
```

`PATCH /me/profile` hanya memperbarui `display_name` pada `tenant_member_profiles` untuk tenant aktif.

### 11.1a Invitation

```text
POST /invitations            (members.invite)   -> 202, respons seragam
GET  /invitations            (members.read)     -> status undangan tenant aktif
POST /invitations/:id/revoke (members.invite)
POST /invitations/accept     (public, token + authentication/credential setup)
```

Penerimaan undangan memakai F-11 dan F-12; role diambil dari `invitation_roles`; contact email disalin ke `tenant_member_profiles`.

### 11.2 Platform superadmin (ADR-003)

Semua route di bawah memerlukan platform permission, berjalan dengan `context_kind = platform`, dan diaudit.

```text
GET   /platform/tenants
POST  /platform/tenants
PATCH /platform/tenants/:id/status

GET   /platform/admins
POST  /platform/admins                    (tambah superadmin; tidak untuk diri sendiri)
POST  /platform/admins/:id/revoke         (tolak superadmin terakhir / diri sendiri)

GET   /platform/identities/:id/status
POST  /platform/identities/:id/suspend
POST  /platform/identities/:id/unlock

GET   /platform/audit-logs

POST  /platform/support-sessions          (tenant_id, reason_code, reason_text, scope, duration_minutes <= 60)
GET   /platform/support-sessions          (sesi milik sendiri + riwayat)
POST  /platform/support-sessions/:id/end
```

Token support session memiliki claim `context_kind=support`, `tenant_id`, `support_session_id`, `scope`, dan `exp` ≤ `expires_at`. Selama sesi, superadmin memakai route tenant biasa dengan permission set support (ADR-003 §2.2), bukan permission tenant owner.

Superadmin pertama dibuat melalui bootstrap command server (Infrastructure SSOT v1.5 §8.7.1), bukan seed API.

Platform endpoints memerlukan platform permission dan audit. Tenant administration biasa tidak memakai route platform.

### 11.3 Member administration

```text
GET   /members                   (members.read; filter: status, role, email exact)
GET   /members/:membershipId     (members.read)
PATCH /members/:membershipId/profile   (members.update_profile; display_name only)
POST  /members/:membershipId/suspend   (members.suspend)
PUT   /members/:membershipId/roles     (members.assign_role)
```

v1.0 `POST /users` dan `PATCH /users/:id` dihapus (ADR-002). Resource diidentifikasi dengan `membership_id`, bukan `user_id` global.

### 11.4 Roles and permissions

```text
GET    /roles
GET    /roles/:id
POST   /roles
PATCH  /roles/:id
DELETE /roles/:id
PUT    /roles/:id/permissions

GET    /permissions
```

`DELETE /roles/:id` melakukan archive/deactivation, bukan hard delete jika role pernah digunakan.

### 11.5 Menu administration (OPTIONAL / P2)

Demo wajib menyediakan `GET /me/menu` dari menu seed. Endpoint administrasi berikut hanya diimplementasikan bila kapasitas tersedia setelah seluruh P0/P1 lulus:

```text
GET    /menus
GET    /menus/:id
POST   /menus
PATCH  /menus/:id
DELETE /menus/:id
PUT    /menus/:id/permissions
```

### 11.6 Audit

```text
GET /audit-logs
```

Audit list memiliki bounded pagination, allowlisted filter, tenant scope, dan masking.

### 11.7 HTTP status baseline

| Condition | Status |
|---|---:|
| Success read/update | 200 |
| Created | 201 |
| Validation failure | 400 |
| Authentication required/invalid session | 401 |
| Authenticated but insufficient permission/scope | 403 |
| Resource not found within authorized scope | 404 |
| Version/unique/state conflict | 409 |
| Rate limited | 429 |
| Unexpected internal failure | 500 |

Cross-tenant resource sebaiknya menghasilkan scoped `404` untuk mencegah resource enumeration, kecuali policy API menetapkan respons lain yang tidak membocorkan existence.

## 12. Frontend pages

```text
/login
/select-context
/dashboard
/profile
/invitations/accept
/administration/members
/administration/invitations
/administration/roles
/administration/menus   (P2)
/administration/audit
/platform/tenants
/platform/admins
/platform/audit
/platform/support-sessions
/403
```

### 12.1 Shared UI requirements

- active tenant indicator selalu terlihat setelah login;
- context switcher hanya muncul jika user memiliki lebih dari satu context (membership dan/atau akses platform);
- tenant owner/auditor melihat notifikasi keamanan (support session) pada header/dashboard;
- sidebar dibangun dari `GET /me/menu`, bukan hardcoded permission mapping;
- route transition menampilkan loading state;
- page memiliki loading, empty, error, forbidden, conflict, dan success state yang relevan;
- form memiliki server error mapping dan accessible field label;
- responsive untuk desktop dan mobile viewport dasar;
- keyboard navigation dan visible focus tersedia;
- decrypted profile data tidak disimpan di `localStorage`, URL, analytics, atau console.

## 13. Profile scope

Profile demo minimum:

```text
display_name (tenant member profile; editable)
email (masked, read-only)
active_tenant
membership status
assigned roles
effective permissions (optional developer/admin view)
```

Email dan nama terenkripsi sesuai Data Protection and Field Encryption SSOT. Update email, email verification, phone number, avatar, password change, dan account recovery berada di luar scope kecuali dokumen ini direvisi.

## 14. Data protection

- Demo menggunakan synthetic identities; data pribadi nyata dilarang.
- Password menggunakan adaptive salted hash.
- Email menggunakan randomized field encryption dan normalized tenant/global-safe blind index sesuai identity design.
- Display name tenant menggunakan field encryption dengan DEK tenant; legal name global (opsional) memakai `platform_identity`.
- Raw password, access token, refresh token, invitation token, email, dan nama tidak dicatat di log/audit.
- Refresh token disimpan sebagai keyed hash bila hanya perlu divalidasi.
- `.env`, key, token, dan credential tidak masuk Git.
- Database, backup, dan object/log storage yang digunakan wajib encrypted at rest.
- Data Field Register minimum harus mencatat `users.email`, `users.legal_name`, `tenant_member_profiles.display_name`, `tenant_member_profiles.contact_email`, `user_invitations.email`, credential/token/invitation-token fields, session identifiers, audit actor reference, dan IP/device field jika dikumpulkan — termasuk atribut `processing_role` (Data Protection SSOT v1.1 §13).

## 15. Audit events

Minimum events:

```text
auth.login.succeeded
auth.login.failed
auth.refresh.succeeded
auth.refresh.reuse_detected
auth.logout.succeeded
auth.context_switched
auth.context_selection_ticket_rejected

tenant.created
tenant.status_changed

platform.admin_granted
platform.admin_revoked
platform.identity_suspended
platform.identity_unlocked
support.session.started      (audit platform + audit tenant)
support.session.ended        (audit platform + audit tenant)
support.session.revoked
support.data_revealed        (per field DP-1)
support.mutation             (READ_WRITE, audit tenant)

invitation.created
invitation.revoked
invitation.accepted
member.profile_updated
member.suspended
member.roles_changed

role.created
role.updated
role.archived
role.permissions_changed

menu.created
menu.updated
menu.archived
menu.permissions_changed

authorization.denied
```

Audit event menyimpan actor, tenant, action, target opaque ID, result, reason code, request ID, dan safe metadata. Audit tidak menyimpan secret atau raw personal field.

## 16. Demo seed data

Seed wajib deterministic, idempotent, hanya berjalan pada environment demo/development yang diizinkan, dan tidak mengandung credential production.

### 16.1 Tenants

```text
Tenant Alpha
Tenant Beta
```

### 16.2 Users

| User | Membership | Role purpose |
|---|---|---|
| Demo Superadmin | Platform only (`platform_superadmin`), dibuat via bootstrap command | Login context PLATFORM, tenant registry, admin platform, support session demo |
| Alpha Owner | Tenant Alpha | Full tenant administration |
| Alpha User | Tenant Alpha | Profile/basic menu only |
| Beta Admin | Tenant Beta | Cross-tenant isolation comparison |
| Multi-Tenant User | Alpha + Beta | Pemilihan context via tiket dan context switch |

Demo credentials disediakan melalui secure local/demo provisioning mechanism dan tidak ditulis ke document, source code, commit, atau public deployment.

Seed boleh membuat identitas dan membership secara langsung melalui provisioning service yang hanya aktif di environment demo (bukan melalui API tenant). Seed juga membuat minimal satu undangan `PENDING` di Tenant Alpha untuk Scenario 1; token-nya dikeluarkan melalui channel provisioning yang sama.

### 16.3 Menus

```text
Dashboard
Profile
Administration
|-- Members
|-- Invitations
|-- Roles & Permissions
|-- Menus (P2)
`-- Audit Log
```

Tenant User hanya melihat Dashboard dan Profile. Admin melihat Administration children sesuai permission.

## 17. Implementation phases

### Phase D0 — Infrastructure verification

- Node, PostgreSQL, NestJS health, Prisma, Next.js, dan OpenAPI lulus parent SSOT gate.

### Phase D1 — Tenant and identity schema

- spike Prisma + RLS + pool reuse lulus (go/no-go);
- migration tenant, user, credential, membership, member profile (termasuk contact email), invitation + invitation_roles, audit log, sessions/refresh_tokens mixed-ownership, selection ticket, platform_role_assignments, tiga database role, RLS (termasuk mixed-ownership), encryption fields, dan blind index;
- fungsi dan policy `TO app_auth_definer` sesuai `PRE_CONTEXT_FUNCTION_REGISTER_v1.0.md`, beserta schema inspection test;
- two-tenant isolation test lulus.

### Phase D2 — Authentication and session

- login bercabang TENANT/PLATFORM, tiket pemilihan context, bootstrap superadmin, refresh rotation, reuse detection, logout/revocation, context switch, rate limit, dan audit.

### Phase D3 — RBAC dan superadmin

- roles, permissions, tenant assignments, permission guard, deny-by-default, dan cross-tenant negative tests;
- platform guard, admin platform, break-glass support session (termasuk tenant non-ACTIVE READ_ONLY), dan `tenant_notifications` (ADR-003 v1.1).

### Phase D4 — Dynamic menu

- seeded registry, hierarchy validation, permission mapping, effective menu endpoint, dan parent pruning;
- menu administration CRUD hanya bila P2 diambil.

### Phase D5 — Frontend

- login, invitation acceptance, context selection, shell/sidebar, security notifications, profile, members, invitations, roles, audit, (menus P2), and all UI states.

### Phase D6 — Demo hardening

- seed, build, lint, automated tests, log-leak scan, accessibility smoke test, responsive smoke test, security review, dan demo script.

## 18. Required test matrix

### 18.1 Authentication

- valid and invalid login;
- generic invalid-credential response;
- suspended user, tenant, atau membership ditolak;
- refresh rotation dan expired token;
- refresh-token reuse mencabut session/family;
- logout membuat token lama tidak dapat digunakan;
- rate limit/lockout behavior;
- password/token tidak muncul di log.

### 18.2 Tenant isolation

- Tenant Alpha tidak dapat membaca/mutasi user, role, assignment, menu, session, atau audit Tenant Beta;
- known ID dari tenant lain tidak membuka resource;
- cross-tenant role/member relation ditolak database;
- query tanpa tenant context ditolak RLS;
- connection reuse tidak membawa tenant context sebelumnya;
- context switch hanya untuk active membership atau platform role aktif;
- superadmin tanpa support session tidak memiliki tenant data access (API dan DB);
- pre-context function tidak dapat dipakai untuk enumerasi (hash salah, user_id acak, host tidak terverifikasi);
- tenant tidak dapat menulis baris menu/audit platform; context platform tidak dapat membaca tenant-owned table;
- schema inspection test RLS/FORCE/function/grant lulus;
- (v1.3) fungsi register membaca lintas tenant tanpa `app.current_tenant_id` melalui policy `TO app_auth_definer`, sementara `app_user` pada tabel yang sama mendapat 0 baris;
- (v1.3) tidak ada role runtime/auth dengan `BYPASSRLS`; `app_user` bukan member `app_auth_definer`; tidak ada fungsi/policy di luar register;
- (v1.3) baris session PLATFORM tidak terbaca dari context tenant.

### 18.2a Identity & invitation (baru v1.1)

- `POST /invitations` untuk email baru vs email terdaftar tidak dapat dibedakan (status, body, timing praktis);
- admin tenant tidak memiliki path baca/tulis ke `users`/`credentials`;
- undangan hanya dapat diterima oleh pemilik email; token single-use dan kedaluwarsa;
- perubahan display name di Tenant Alpha tidak terlihat di Tenant Beta untuk Multi-Tenant User;
- role dari tenant lain pada `invitation_roles` ditolak composite FK;
- (v1.3) `GET /members` menampilkan email masked dan filter email exact bekerja tanpa akses ke `users`; contact email Alpha tidak terbaca dari Beta.

### 18.2b Superadmin dan support session (baru v1.2)

- support session hanya membuka satu tenant; akses ke tenant lain tetap ditolak RLS;
- `READ_ONLY` menolak mutasi di guard dan di database (`READ ONLY transaction`);
- sesi kedaluwarsa/diakhiri/di-revoke ditolak pada request berikutnya;
- durasi > 60 menit, sesi ganda, dan perpanjangan ditolak;
- support session tidak dapat mengubah role, membership, undangan, domain, atau entitlement tenant;
- reveal DP-2 tidak tersedia; reveal DP-1 teraudit;
- event `support.session.started/ended` terlihat di audit tenant Alpha dan notifikasi in-app diterima Alpha Owner;
- superadmin terakhir tidak dapat dicabut; superadmin tidak dapat mengubah assignment dirinya;
- tenant role tidak dapat memperoleh `platform.*`;
- bootstrap command idempotent dan teraudit;
- (v1.3) support session ke tenant SUSPENDED dipaksa READ_ONLY; PURGED ditolak;
- (v1.3) event support ke audit tenant dan `tenant_notifications` hanya melalui F-14/F-15;
- (v1.3) logout session PLATFORM mengakhiri support session aktif.

### 18.2c Login context (baru v1.3)

- Demo Superadmin (tanpa membership) login langsung ke context PLATFORM;
- Multi-Tenant User wajib memilih context; tiket kedaluwarsa (> 5 menit) atau dipakai ulang ditolak;
- tiket tidak dapat memanggil endpoint selain `/auth/contexts` dan `/auth/select-context`;
- token PLATFORM ditolak di route tenant; token TENANT ditolak di `/platform/*`;
- user tanpa context mendapat respons gagal generik yang sama dengan password salah;
- refresh context PLATFORM gagal setelah role platform dicabut.

### 18.3 Authorization

- no role/no permission menghasilkan deny;
- endpoint yang URL-nya diketahui tetap `403`/scoped `404`;
- role permission change mengubah effective authorization;
- tenant user tidak dapat memberi dirinya permission lebih tinggi;
- tenant role tidak dapat memperoleh platform permission;
- archived role tidak menghasilkan permission aktif.

### 18.4 Dynamic menu

- admin dan user menerima menu berbeda;
- inactive menu tidak tampil;
- parent tanpa visible child dan tanpa route tidak tampil;
- tenant-specific menu tidak tampil lintas tenant;
- cyclic hierarchy ditolak;
- invalid route ditolak;
- permission change tercermin pada menu request berikutnya;
- hidden menu endpoint tetap dilindungi backend.

### 18.5 Data protection and audit

- raw database/dump tidak menampilkan email, nama, password, raw refresh token, atau raw invitation token;
- same plaintext menghasilkan randomized ciphertext berbeda;
- email exact lookup bekerja melalui blind index;
- cross-tenant/key-context substitution gagal;
- API list meminimalkan/masking data;
- log/audit/error tidak memuat personal plaintext atau secret;
- mandatory events tercatat dengan request ID dan tenant scope.

## 19. Demo acceptance scenarios

### Scenario 1 — Tenant Owner

1. Login sebagai Alpha Owner.
2. Tenant Alpha aktif dan terlihat jelas.
3. Menu Administration terlihat.
4. Owner membuat role demo, memberikan permission, dan assign ke Alpha User.
5. Owner mengundang email baru; undangan diterima melalui demo provisioning channel; member baru tampil dengan role yang dituju.
6. Perubahan menghasilkan audit events.

### Scenario 2 — Dynamic permission

1. Login sebagai Alpha User.
2. Hanya Dashboard dan Profile terlihat.
3. Direct call ke endpoint Members menghasilkan deny.
4. Alpha Owner menambahkan `members.read` melalui role.
5. Setelah effective state diperbarui, menu Members tampil dan endpoint dapat diakses read-only.

### Scenario 3 — Tenant isolation

1. Login sebagai Beta Admin.
2. Member/menu/role Alpha tidak terlihat.
3. Penggunaan known Alpha resource ID menghasilkan scoped not-found/deny.
4. Mengundang email milik Alpha Owner menghasilkan respons yang sama dengan email baru.
5. Database-level isolation test menunjukkan RLS menolak access.

### Scenario 4 — Context selection dan switch

1. Login sebagai Multi-Tenant User; aplikasi meminta pemilihan context.
2. Pilihan hanya Alpha dan Beta; tiket pemilihan kedaluwarsa bila dibiarkan > 5 menit.
3. Menu dan permission berubah sesuai tenant aktif.
4. Alpha resource tidak dapat digunakan setelah context berpindah ke Beta.
5. Switch menghasilkan audit event.

### Scenario 5 — Logout

1. Logout dari active session.
2. Cookie/browser state dibersihkan.
3. Refresh token lama ditolak.
4. Protected endpoint menghasilkan `401`.
5. Audit logout tersedia tanpa token/raw personal data.

### Scenario 6 — Superadmin dan break-glass support (baru v1.2, revisi v1.3)

1. Login sebagai Demo Superadmin (tanpa membership) langsung ke context PLATFORM; console platform menampilkan Tenant Alpha dan Beta.
2. Superadmin suspend Tenant Beta; membuka support session ke Beta hanya tersedia READ_ONLY; reactivate Beta; audit platform tercatat.
3. Superadmin mencoba membuka `/administration/members` Tenant Alpha tanpa sesi → ditolak.
4. Superadmin membuka support session READ_ONLY ke Tenant Alpha dengan alasan; banner "Mode support — sisa n menit" tampil.
5. Daftar member Alpha terlihat masked; percobaan mengubah role ditolak.
6. Percobaan membaca data Tenant Beta dalam sesi yang sama ditolak.
7. Sesi diakhiri; request berikutnya ditolak.
8. Login sebagai Alpha Owner: audit tenant menampilkan `support.session.started/ended` dan ada notifikasi in-app.

## 20. Global acceptance criteria

Demo Foundation diterima jika:

- frontend, backend, database, health, dan OpenAPI berjalan pada port baseline;
- migration dapat dijalankan dari clean database;
- seed menghasilkan dua tenant dan actor demo secara idempotent;
- login, context selection, refresh, logout, profile, invitation, context switch, member, role, permission, effective menu, dan audit flow bekerja;
- pre-context function register lengkap dan test negatifnya lulus;
- superadmin dan break-glass support session memenuhi test §18.2b;
- login context, tiket pemilihan, dan register pre-context memenuhi test §18.2 dan §18.2c;
- authorization ditegakkan backend dan default-deny;
- dynamic menu ditentukan backend dari effective permissions;
- cross-tenant API, repository, relation, dan RLS tests lulus;
- password/token hashing serta email/name encryption lulus Data Protection policy;
- log/audit tidak membocorkan secret atau personal plaintext;
- build, lint, unit, integration, E2E/API smoke, accessibility, dan responsive smoke tests lulus;
- tidak ada unresolved critical/high security defect;
- demo evidence dapat ditelusuri ke commit/release yang diuji.

## 21. Definition of Done

SaaS Demo Foundation v1.3 dinyatakan **DONE** apabila:

1. Phase D0–D6 lulus dengan evidence;
2. seluruh endpoint memiliki DTO validation, OpenAPI contract, permission requirement, dan consistent error response;
3. schema, tenant ownership, RLS, constraints, indexes, migration, serta rollback/mitigation terdokumentasi dan diuji;
4. login/session/logout dan refresh rotation bekerja end-to-end;
5. RBAC dan dynamic menu tidak bergantung pada hardcoded role di frontend/backend business guard;
6. two-tenant negative isolation suite lulus;
7. profile personal fields dan authentication materials dilindungi sesuai encryption SSOT;
8. audit events lengkap dan ter-redact;
9. UI memiliki loading, empty, error, forbidden, conflict, success, responsive, dan basic accessibility behavior;
10. demo script dapat dijalankan ulang dari clean baseline oleh engineer lain;
11. dokumentasi tetap menyatakan bahwa demo bukan production readiness atau compliance certification;
12. Product/Architecture, Technical, Security/Privacy, dan Operations sign-off dicatat sesuai scope yang benar.

## 22. Approval record

| Role | Name | Decision | Date | Evidence |
|---|---|---|---|---|
| Product/Architecture Direction | `<REQUESTER_PLACEHOLDER>` | Demo scope requested | 2026-09-16 | This SSOT |
| Technical Approver | `<TECHNICAL_APPROVER_PLACEHOLDER>` | Pending | — | — |
| Security/Privacy Reviewer | `<SECURITY_PRIVACY_PLACEHOLDER>` | Pending | — | — |
| Operations Reviewer | `<OPERATIONS_PLACEHOLDER>` | Pending | — | — |

Permintaan demo scope tidak berarti production, legal, security, privacy, atau operations approval.

## 23. Change log

| Version | Date | Summary | Approval |
|---|---|---|---|
| 1.0 | 2026-09-16 | Initial SaaS demo foundation for login, logout, profile, tenant isolation, RBAC, dynamic menu, session, and audit | Product/architecture direction; specialist review pending |
| 1.1 | 2026-09-16 | ADR-002 identity/invitation; members API; tenant member profile; klasifikasi tabel mengikuti Infra v1.3; pre-context login/refresh/audit; mixed-ownership tests; menu admin → P2; organization di luar scope demo; open decision email ditutup | Proposed; specialist review pending |
| 1.2 | 2026-09-16 | Superadmin platform & break-glass support session (ADR-003): permission, tabel, API, halaman, audit events, seed, test, Scenario 6 | Proposed; specialist review pending |
| 1.3 | 2026-09-16 | Opsi A + register pre-context; login context TENANT/PLATFORM + tiket; sessions mixed-ownership; `invitation_roles`, `auth_selection_tickets`, `tenant_notifications`; contact email member; route contexts; test §18.2c | Proposed; specialist review pending |

## 24. Open implementation decisions

- cookie versus authorization-header delivery strategy;
- exact access/refresh TTL and idle timeout;
- Argon2id parameter set;
- demo key mechanism (Data Protection SSOT v1.1 §9.2 opsi C atau A-dev) dan encryption library;
- ~~whether email identity is globally unique or tenant-scoped~~ — **ditutup v1.1 oleh ADR-002 (global identity, invitation-only)**;
- TTL undangan (ADR-002 open decision);
- ~~tenant-switch session strategy~~ — **ditetapkan v1.3:** session baru per context, session lama dicabut;
- isi final `SUPPORT_READ_SET`/`SUPPORT_WRITE_SET` dan daftar `reason_code` (ADR-003);
- **known limitation demo:** MFA superadmin di luar scope demo, tetapi wajib sebelum production;
- icon registry/library;
- final UI component system;
- E2E test framework;
- CI/CD platform;
- deployment host and secret manager.

Open decision tidak boleh diisi dengan asumsi diam-diam. Keputusan yang memengaruhi security, schema, atau public contract harus dicatat melalui change control.
