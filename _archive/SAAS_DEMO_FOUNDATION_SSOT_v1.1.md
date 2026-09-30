---
title: "SaaS Demo Foundation SSOT"
document_id: "SAAS-DEMO-FOUNDATION-SSOT"
version: "1.1"
status: "SUPERSEDED"
original_status: "Proposed Demo Baseline / Ready for Refinement after ADR-001 v1.1 and ADR-002 Review"
superseded_by: "SAAS_DEMO_FOUNDATION_SSOT_v1.3.md"
superseded_date: "2026-09-16"
owner: "<OWNER_PLACEHOLDER>"
last_updated: "2026-09-16"
supersedes: "SAAS_DEMO_FOUNDATION_SSOT_v1.0.md"
implementation_scope: "Authentication, invitation, profile, SaaS tenancy, RBAC, dynamic menu, session, and audit"
parent_documents:
  - "INFRASTRUCTURE_SSOT_v1.3.md"
  - "GENERAL_FEATURE_BASE_SSOT_v1.3.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md"
  - "ADR-001-SAAS-MULTI-TENANCY_v1.1.md"
  - "ADR-002-IDENTITY-MODEL_v1.0.md"
review_reference: "REVIEW_BASELINE_DOCS_2026-09-16.md"
change_control: "Perubahan scope, tenant boundary, authentication flow, permission model, menu visibility rule, database schema, atau acceptance criteria MUST diperbarui di dokumen ini sebelum implementasi."
---

> ⚠️ **SUPERSEDED — ARSIP, BUKAN DOKUMEN AKTIF.**
> Versi berlaku: [`SAAS_DEMO_FOUNDATION_SSOT_v1.3.md`](./SAAS_DEMO_FOUNDATION_SSOT_v1.3.md). Lihat `DOCUMENT_VERSION_INDEX.md`.
> Isi dan referensi versi di bawah bersifat historis dan **tidak boleh** dijadikan dasar implementasi, ticket, atau review.

# SaaS Demo Foundation SSOT v1.1

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

SaaS Tenancy
|-- Tenant registry
|-- Tenant membership
|-- Active tenant context
|-- Tenant switch
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
| Platform Administrator | Mengelola tenant untuk keperluan demo; tidak otomatis memperoleh akses data tenant |
| Tenant Owner | Administrator tertinggi dalam satu tenant |
| Tenant Administrator | Mengundang member, mengelola profil tenant member, role, dan permission assignment sesuai permission; tidak dapat membuat/mengubah identitas global |
| Tenant User | Mengakses profile dan menu yang diberikan melalui role |
| Auditor/Viewer | Read-only terhadap data IAM/audit yang diizinkan |

Platform Administrator menggunakan route dan permission platform terpisah. Tenant Owner dan Tenant Administrator tetap dibatasi tenant aktif.

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
| `platform_admin` | Platform | `platform.tenants.*`; tidak implicit tenant data access |
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
roles
permissions
role_permissions
user_role_assignments

menus
menu_permissions

audit_logs
```

### 7.2 Tenant ownership classification

Klasifikasi mengikuti **Infrastructure SSOT v1.3 §8.3 (Table Ownership Register)**; tabel di bawah adalah subset demo dan tidak boleh berbeda dari register tersebut.

| Table | Class | `tenant_id` | RLS | Pre-context path (ADR-001 §3.7) |
|---|---|---:|---:|---|
| `tenants` | Tenant control-plane | Row identity | Platform policy + baris sendiri | resolve host, list memberships |
| `tenant_domains` | Tenant control-plane | Required | Required | resolve host |
| `users` | Platform-global | No | Tidak ada grant langsung ke `app_user` | identity lookup function |
| `credentials` | Platform-global secret | No | Tidak ada grant langsung | auth function |
| `sessions` | Tenant-owned | Required | Required | refresh/revoke function |
| `refresh_tokens` | Tenant-owned | Required | Required | find/rotate/revoke function |
| `tenant_memberships` | Tenant-owned | Required | Required | list memberships |
| `tenant_member_profiles` | Tenant-owned | Required | Required | — |
| `user_invitations` | Tenant-owned | Required | Required | accept invitation function |
| `roles` | Tenant-owned | Required | Required | — |
| `permissions` | Platform-global catalog | No | Read-only grant | — |
| `role_permissions` | Tenant-owned | Required | Required | — |
| `user_role_assignments` | Tenant-owned | Required | Required | — |
| `menus` | Mixed-ownership | NULL hanya baris platform | ADR-001 §3.8 | — |
| `menu_permissions` | Mixed-ownership | NULL hanya baris platform | ADR-001 §3.8 | — |
| `audit_logs` | Mixed-ownership | NULL hanya event platform/pre-context | ADR-001 §3.8; update/delete revoked | pre-context audit writer |

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
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
version INTEGER NOT NULL
PRIMARY KEY (tenant_id, membership_id)
FK (tenant_id, membership_id) -> tenant_memberships (tenant_id, id)
```

#### `user_invitations`

```text
id UUID PK
tenant_id UUID NOT NULL
email_ciphertext BYTEA/JSON envelope NOT NULL          (DEK tenant)
email_blind_index_tenant BYTEA NOT NULL                (HMAC tenant-scoped)
intended_role_ids UUID[] NOT NULL
token_hash BYTEA NOT NULL
status VARCHAR NOT NULL  -- PENDING|ACCEPTED|EXPIRED|REVOKED
invited_by UUID NOT NULL
expires_at TIMESTAMPTZ NOT NULL
accepted_membership_id UUID NULL
created_at TIMESTAMPTZ NOT NULL
UNIQUE (tenant_id, email_blind_index_tenant) WHERE status = 'PENDING'
```

`intended_role_ids` divalidasi terhadap `roles` tenant yang sama saat undangan dibuat dan saat diterima.

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
  tenant_id UUID NOT NULL
  user_id UUID NOT NULL
  membership_id UUID NOT NULL
  status VARCHAR NOT NULL
  created_at TIMESTAMPTZ NOT NULL
  last_seen_at TIMESTAMPTZ NULL
  expires_at TIMESTAMPTZ NOT NULL
  revoked_at TIMESTAMPTZ NULL
  revocation_reason VARCHAR NULL

refresh_tokens:
  id UUID PK
  tenant_id UUID NOT NULL
  session_id UUID NOT NULL
  token_hash BYTEA NOT NULL
  family_id UUID NOT NULL
  issued_at TIMESTAMPTZ NOT NULL
  expires_at TIMESTAMPTZ NOT NULL
  rotated_at TIMESTAMPTZ NULL
  revoked_at TIMESTAMPTZ NULL
  replaced_by_id UUID NULL
```

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

Event yang terjadi sebelum tenant context (misalnya `auth.login.failed` untuk email tidak dikenal) ditulis melalui `audit.write_pre_context_event` dengan `tenant_id` NULL atau hasil resolusi host; `UPDATE`/`DELETE` pada `audit_logs` di-revoke dari `app_user`.

## 8. Authentication and session flow

### 8.1 Login

```text
User submits email + password
  -> normalize email
  -> identity function: locate user by platform blind index        [pre-context]
  -> verify password hash (constant-work path bila user tidak ada)
  -> auth.list_active_memberships(user_id)                          [pre-context]
  -> select verified active tenant (auto bila satu; else pilih)
  -> open tenant unit of work (set_config tenant)
  -> create session + refresh token (tenant-owned, RLS)
  -> issue short-lived access token
  -> set protected cookie/return approved token response
  -> record audit event (tenant context, atau pre-context writer bila gagal)
```

Refresh:

```text
POST /auth/refresh
  -> hash refresh token
  -> auth.find_refresh_token(hash)                                  [pre-context]
  -> verify tenant ACTIVE, membership ACTIVE, session ACTIVE
  -> auth.rotate_refresh_token(...) atomik; reuse -> revoke family
  -> issue new access token
```

Login response tidak boleh membedakan “email tidak ada” dan “password salah”. Rate limiting dan lockout/backoff harus tersedia.

### 8.2 Active tenant selection

- Jika user hanya memiliki satu active membership, tenant dapat dipilih otomatis.
- Jika user memiliki beberapa membership, user memilih dari server-provided membership list.
- Tenant selector dari client tidak dipercaya sebelum membership, tenant status, dan session diverifikasi.
- Tenant switch membuat tenant context/access token baru dan dapat memakai session baru atau session transition yang diaudit.

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
GET   /me/tenants
POST  /me/tenant-switch
```

`PATCH /me/profile` hanya memperbarui `display_name` pada `tenant_member_profiles` untuk tenant aktif.

### 11.1a Invitation

```text
POST /invitations            (members.invite)   -> 202, respons seragam
GET  /invitations            (members.read)     -> status undangan tenant aktif
POST /invitations/:id/revoke (members.invite)
POST /invitations/accept     (public, token + authentication/credential setup)
```

### 11.2 Tenant administration

```text
GET   /platform/tenants
POST  /platform/tenants
PATCH /platform/tenants/:id/status
```

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
/select-tenant
/dashboard
/profile
/invitations/accept
/administration/members
/administration/invitations
/administration/roles
/administration/menus   (P2)
/administration/audit
/403
```

### 12.1 Shared UI requirements

- active tenant indicator selalu terlihat setelah login;
- tenant switcher hanya muncul jika user memiliki lebih dari satu membership;
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
- Data Field Register minimum harus mencatat `users.email`, `users.legal_name`, `tenant_member_profiles.display_name`, `user_invitations.email`, credential/token/invitation-token fields, session identifiers, audit actor reference, dan IP/device field jika dikumpulkan — termasuk atribut `processing_role` (Data Protection SSOT v1.1 §13).

## 15. Audit events

Minimum events:

```text
auth.login.succeeded
auth.login.failed
auth.refresh.succeeded
auth.refresh.reuse_detected
auth.logout.succeeded
auth.tenant_switched

tenant.created
tenant.status_changed

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
| Demo Platform Admin | Platform only | Tenant registry demo |
| Alpha Owner | Tenant Alpha | Full tenant administration |
| Alpha User | Tenant Alpha | Profile/basic menu only |
| Beta Admin | Tenant Beta | Cross-tenant isolation comparison |
| Multi-Tenant User | Alpha + Beta | Tenant-switch demonstration |

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
- migration tenant, user, credential, membership, member profile, invitation, audit log, tiga database role, RLS (termasuk mixed-ownership), encryption fields, dan blind index;
- pre-context functions dan register-nya;
- two-tenant isolation test lulus.

### Phase D2 — Authentication and session

- login, refresh rotation, reuse detection, logout/revocation, tenant selection, rate limit, dan audit.

### Phase D3 — RBAC

- roles, permissions, tenant assignments, permission guard, deny-by-default, dan cross-tenant negative tests.

### Phase D4 — Dynamic menu

- seeded registry, hierarchy validation, permission mapping, effective menu endpoint, dan parent pruning;
- menu administration CRUD hanya bila P2 diambil.

### Phase D5 — Frontend

- login, invitation acceptance, tenant selection, shell/sidebar, profile, members, invitations, roles, audit, (menus P2), and all UI states.

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
- tenant switch hanya untuk active membership;
- platform admin tidak memiliki implicit tenant data access;
- pre-context function tidak dapat dipakai untuk enumerasi (hash salah, user_id acak, host tidak terverifikasi);
- tenant tidak dapat menulis baris menu/audit platform; context platform tidak dapat membaca tenant-owned table;
- schema inspection test RLS/FORCE/function/grant lulus.

### 18.2a Identity & invitation (baru v1.1)

- `POST /invitations` untuk email baru vs email terdaftar tidak dapat dibedakan (status, body, timing praktis);
- admin tenant tidak memiliki path baca/tulis ke `users`/`credentials`;
- undangan hanya dapat diterima oleh pemilik email; token single-use dan kedaluwarsa;
- perubahan display name di Tenant Alpha tidak terlihat di Tenant Beta untuk Multi-Tenant User;
- intended role dari tenant lain ditolak.

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

### Scenario 4 — Tenant switch

1. Login sebagai Multi-Tenant User.
2. Pilihan hanya Alpha dan Beta.
3. Menu dan permission berubah sesuai tenant aktif.
4. Alpha resource tidak dapat digunakan setelah context berpindah ke Beta.
5. Switch menghasilkan audit event.

### Scenario 5 — Logout

1. Logout dari active session.
2. Cookie/browser state dibersihkan.
3. Refresh token lama ditolak.
4. Protected endpoint menghasilkan `401`.
5. Audit logout tersedia tanpa token/raw personal data.

## 20. Global acceptance criteria

Demo Foundation diterima jika:

- frontend, backend, database, health, dan OpenAPI berjalan pada port baseline;
- migration dapat dijalankan dari clean database;
- seed menghasilkan dua tenant dan actor demo secara idempotent;
- login, refresh, logout, profile, invitation, tenant switch, member, role, permission, effective menu, dan audit flow bekerja;
- pre-context function register lengkap dan test negatifnya lulus;
- authorization ditegakkan backend dan default-deny;
- dynamic menu ditentukan backend dari effective permissions;
- cross-tenant API, repository, relation, dan RLS tests lulus;
- password/token hashing serta email/name encryption lulus Data Protection policy;
- log/audit tidak membocorkan secret atau personal plaintext;
- build, lint, unit, integration, E2E/API smoke, accessibility, dan responsive smoke tests lulus;
- tidak ada unresolved critical/high security defect;
- demo evidence dapat ditelusuri ke commit/release yang diuji.

## 21. Definition of Done

SaaS Demo Foundation v1.1 dinyatakan **DONE** apabila:

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

## 24. Open implementation decisions

- cookie versus authorization-header delivery strategy;
- exact access/refresh TTL and idle timeout;
- Argon2id parameter set;
- demo key mechanism (Data Protection SSOT v1.1 §9.2 opsi C atau A-dev) dan encryption library;
- ~~whether email identity is globally unique or tenant-scoped~~ — **ditutup v1.1 oleh ADR-002 (global identity, invitation-only)**;
- TTL undangan (ADR-002 open decision);
- tenant-switch session strategy;
- icon registry/library;
- final UI component system;
- E2E test framework;
- CI/CD platform;
- deployment host and secret manager.

Open decision tidak boleh diisi dengan asumsi diam-diam. Keputusan yang memengaruhi security, schema, atau public contract harus dicatat melalui change control.
