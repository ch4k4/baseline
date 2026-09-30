---
title: "SaaS Demo Foundation SSOT"
document_id: "SAAS-DEMO-FOUNDATION-SSOT"
edition: "2.9 (consolidated final)"
status: "Consolidated Baseline — Proposed; specialist approval pending"
owner: "<OWNER_PLACEHOLDER>"
last_updated: "2026-09-28"
implementation_scope: "Authentication, context selection, invitation, profile, SaaS tenancy, RBAC, platform superadmin with break-glass support session, dynamic menu, session, and audit"
related_documents:
  - "README.md"
  - "ARCHITECTURE_DECISIONS.md"
  - "INFRASTRUCTURE_SSOT.md"
  - "GENERAL_FEATURE_BASE_SSOT.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT.md"
  - "SAAS_DEMO_SPRINT_PLAN.md"
supersedes_archive: "_archive/ (SAAS_DEMO_FOUNDATION_SSOT v1.0–v1.3)"
change_control: "Perubahan normatif MUST diperbarui di dokumen ini sebelum implementasi dan dicatat di bagian Riwayat serta README.md §5."
---

# SaaS Demo Foundation SSOT

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

owners.manage

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
- Administrasi anggota tenant memakai permission `members.*`; tidak ada permission tenant untuk membuat atau mengubah identitas global.
- `menus.create/update/archive/assign_permission` hanya diseed bila menu administration P2 diimplementasikan.
- `menus.read` adalah permission **administrasi menu** (P2), bukan syarat memanggil `GET /me/menu`. Route itu sengaja tidak ber-permission: anggota yang belum diberi role apa pun harus tetap menerima kerangka dan dasbornya (Scenario 2), dan menuntut permission di sana menghasilkan lingkaran — tidak ada navigasi yang menuntun ke izin untuk melihat navigasi. Deskripsi katalognya berbunyi demikian sejak migrasi 0021, dan bunyinya diuji.
- Assignment role/permission tidak boleh melampaui tenant atau kewenangan actor.
- Tenant Owner bukan bypass terhadap RLS atau tenant boundary.
- `owners.manage` adalah **penanda owner**: tidak membuka endpoint apa pun dan hanya dipegang `tenant_owner`. Karena assignment tidak boleh melampaui kewenangan actor, actor tanpa `owners.manage` tidak dapat memberi atau mencabut role yang memuatnya, menangguhkan atau mengaktifkan kembali pemegangnya, maupun memasangnya ke role lain. Tidak ada pengecualian berdasarkan nama role.

## 6. Baseline roles

| Role | Scope | Baseline permission |
|---|---|---|
| `platform_superadmin` | Platform | Seluruh `platform.*`; tidak implicit tenant data access; akses data tenant via support session (ADR-003) |
| `tenant_owner` | Tenant | Seluruh tenant permission dalam demo, termasuk `owners.manage` |
| `tenant_admin` | Tenant | Profile, member, invitation, role, permission, (menu bila P2), dan audit administration yang ditetapkan seed; **tanpa** `owners.manage` |
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
audit_event_types

crypto_keys

platform_role_assignments
support_sessions
tenant_notifications
```

### 7.2 Tenant ownership classification

Klasifikasi mengikuti **Infrastructure SSOT §8.3 (Table Ownership Register)**; akses pre-context/cross-context mengikuti **`ARCHITECTURE_DECISIONS.md` Lampiran A** (ID fungsi F-xx). Tabel di bawah adalah subset demo dan tidak boleh berbeda dari kedua sumber tersebut.

| Table | Class | `tenant_id` | RLS untuk `app_user` | Register |
|---|---|---:|---|---|
| `tenants` | Tenant control-plane | Row identity | Platform policy + baris sendiri | F-01, F-04, F-11, F-12, F-16 |
| `tenant_domains` | Tenant control-plane | Required | Required | F-01 |
| `users` | Platform-global | No | Tidak ada grant | F-02, F-12, F-16 |
| `credentials` | Platform-global secret | No | Tidak ada grant | F-02, F-03, F-16 |
| `auth_selection_tickets` | Platform-global transient | No | Tidak ada grant | F-05, F-06 |
| `sessions` | Mixed-ownership (`context_kind`) | Required untuk TENANT; NULL untuk PLATFORM | Baris TENANT saja | F-07–F-10 |
| `refresh_tokens` | Mixed-ownership (`context_kind`) | idem | Baris TENANT saja | F-07–F-10 |
| `tenant_memberships` | Tenant-owned | Required | Required | F-04, F-06, F-12, F-15 |
| `tenant_member_profiles` | Tenant-owned | Required | Required | F-12 |
| `user_invitations` | Tenant-owned | Required | Required | F-11, F-12, F-16 |
| `invitation_roles` | Tenant-owned | Required | Required | F-12 |
| `roles` | Tenant-owned | Required | Required | — |
| `permissions` | Platform-global catalog | No | Read-only grant | — |
| `role_permissions` | Tenant-owned | Required | Required | — |
| `user_role_assignments` | Tenant-owned | Required | Required | F-12 |
| `menus` | Mixed-ownership | NULL hanya baris platform | Baca saja, policy per context; tanpa grant tulis | F-20 |
| `menu_permissions` | Mixed-ownership | NULL hanya baris platform | Baca saja, policy per context; tanpa grant tulis | — |
| `audit_logs` | Mixed-ownership | NULL hanya event platform/pre-context | ADR-001 §3.8; update/delete revoked | F-14 |
| `audit_event_types` | Platform-global catalog | No | Read-only grant | — |
| `crypto_keys` | Mixed-ownership | NULL hanya kunci platform | Tidak ada grant | — |
| `platform_role_assignments` | Platform-global | No | Tidak ada grant | F-04, F-06, F-13 |
| `support_sessions` | Tenant control-plane | Required | Policy per context (ADR-003 §2.4) | — |
| `tenant_notifications` | Tenant-owned | Required | Baca dengan `audit.read`; tanpa insert | F-15 |

Table tanpa `tenant_id` harus terdaftar sebagai platform/global table dan tidak boleh menjadi jalur akses lintas tenant.

### 7.3 Logical schema

Bagian ini mengikuti implementasi demo: kolom, tipe, dan constraint di bawah adalah yang benar-benar ada di `db/migrations/*.sql`. Kalau keduanya berbeda, yang berlaku adalah aturan README §4 — dokumen diperbaiki lewat kenaikan edisi, bukan dibiarkan berbeda. Sejak migrasi 0021 tidak ada lagi tabel yang berstatus rencana: seluruh blok di bawah adalah tabel yang benar-benar ada.

Default `gen_random_uuid()`, `now()`, dan `clock_timestamp()` ditulis apa adanya karena menentukan siapa yang membuat nilai: database, bukan aplikasi.

#### `tenants`

```text
id UUID PK DEFAULT gen_random_uuid()
slug VARCHAR(63) NOT NULL UNIQUE
name VARCHAR(255) NOT NULL
status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
CHECK (status IN ('PROVISIONING','ACTIVE','SUSPENDED','ARCHIVED'))
```

Tidak ada kolom `code` maupun `version`: identitas publik tenant adalah `slug`, dan tenant belum punya mutasi ber-optimistic-locking dalam demo.

#### `users`

```text
id UUID PK DEFAULT gen_random_uuid()
status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
email_ciphertext BYTEA NOT NULL          (envelope v1; DEK platform_identity)
email_key_version INTEGER NOT NULL
email_blind_index BYTEA NOT NULL UNIQUE  (HMAC platform_identity_blind_index, 32 byte)
CHECK (status IN ('ACTIVE','SUSPENDED','LOCKED','ARCHIVED'))
CHECK (octet_length(email_ciphertext) >= 29 AND get_byte(email_ciphertext, 0) = 1)
CHECK (octet_length(email_blind_index) = 32)
CHECK (email_key_version >= 1)
```

`users` merepresentasikan identity global (ADR-002). Enkripsi memakai key purpose `platform_identity` sebagai pengecualian terkontrol Data Protection SSOT §9.1. Admin tenant tidak memiliki read/write path ke tabel ini; nama yang tampil di tenant berasal dari `tenant_member_profiles`. Nama legal tidak disimpan dalam demo.

CHECK atas ciphertext adalah penjaga bentuk envelope: byte pertama = versi 1, panjang minimum = nonce + tag. Kolom yang diisi plaintext ditolak database, bukan hanya oleh kode.

#### `tenant_member_profiles`

```text
id UUID PK DEFAULT gen_random_uuid()
tenant_id UUID NOT NULL
membership_id UUID NOT NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
display_name_ciphertext BYTEA NOT NULL    (DEK tenant identity; AAD memuat tenant_id)
display_name_key_version INTEGER NOT NULL
contact_email_ciphertext BYTEA NOT NULL   (DEK tenant; salinan saat undangan diterima)
contact_email_key_version INTEGER NOT NULL
contact_email_blind_index BYTEA NOT NULL  (HMAC identity_blind_index tenant, 32 byte)
UNIQUE (tenant_id, membership_id)
UNIQUE (tenant_id, contact_email_blind_index)
FK (tenant_id, membership_id) -> tenant_memberships (tenant_id, id) ON DELETE CASCADE
FK (tenant_id) -> tenants (id)
CHECK bentuk envelope untuk kedua ciphertext; CHECK octet_length(contact_email_blind_index) = 32
```

Contact email adalah sumber email masked dan filter `email exact` pada `GET /members` (ADR-002 §2.6). Salinan tidak otomatis mengikuti perubahan email global (di luar scope demo).

Primary key adalah `id` tersendiri, dengan `UNIQUE (tenant_id, membership_id)` sebagai penjamin satu profil per anggota: `id` dipakai sebagai record id dalam AAD enkripsi, sehingga harus stabil dan tidak majemuk.

#### `user_invitations`

```text
id UUID PK DEFAULT gen_random_uuid()
tenant_id UUID NOT NULL
email_ciphertext BYTEA NOT NULL           (DEK tenant)
email_key_version INTEGER NOT NULL
email_blind_index BYTEA NOT NULL          (HMAC tenant-scoped, 32 byte)
identity_hint BYTEA NOT NULL              (blind index global; dipakai F-11/F-12/F-16)
invited_by_membership_id UUID NOT NULL
token_hash BYTEA NOT NULL UNIQUE          (32 byte)
status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
expires_at TIMESTAMPTZ NOT NULL
accepted_membership_id UUID NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE (tenant_id, id)
UNIQUE (tenant_id, email_blind_index) WHERE status = 'PENDING'   (partial index)
FK (tenant_id, invited_by_membership_id)   -> tenant_memberships (tenant_id, id)
FK (tenant_id, accepted_membership_id)     -> tenant_memberships (tenant_id, id)
CHECK (status IN ('PENDING','ACCEPTED','EXPIRED','REVOKED'))
CHECK ((status = 'ACCEPTED') = (accepted_membership_id IS NOT NULL))
CHECK (expires_at > updated_at AND expires_at <= updated_at + interval '7 days')
```

`identity_hint` ada karena undangan harus dapat dicocokkan dengan identitas global tanpa membuka email: F-16 menolak mendaftarkan email lain lewat token undangan orang lain.

Status `EXPIRED` tidak ditulis job apa pun dalam demo; kedaluwarsa dihitung dari `expires_at` saat dibaca (D-23).

#### `invitation_roles`

```text
tenant_id UUID NOT NULL
invitation_id UUID NOT NULL
role_id UUID NOT NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
PRIMARY KEY (tenant_id, invitation_id, role_id)
FK (tenant_id, invitation_id) -> user_invitations (tenant_id, id)
FK (tenant_id, role_id) -> roles (tenant_id, id)
```

Role dari tenant lain ditolak oleh composite FK (tidak memakai array `UUID[]` yang tidak dapat diberi FK). Tenant hanya boleh menulis baris ini selama undangannya `PENDING` (policy, migrasi 0014).

#### `auth_selection_tickets`

```text
id UUID PK DEFAULT gen_random_uuid()
user_id UUID NOT NULL
token_hash BYTEA NOT NULL UNIQUE
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
expires_at TIMESTAMPTZ NOT NULL
consumed_at TIMESTAMPTZ NULL
FK (user_id) -> users (id) ON DELETE CASCADE
CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
```

Hanya diakses melalui F-05/F-06; baris kedaluwarsa dibersihkan job berkala (belum ada dalam demo).

#### `credentials`

```text
id UUID PK DEFAULT gen_random_uuid()
user_id UUID NOT NULL UNIQUE
password_hash TEXT NOT NULL
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
FK (user_id) -> users (id) ON DELETE CASCADE
```

Password disimpan sebagai salted hash; plaintext password dilarang disimpan atau dicatat. Demo memakai scrypt, bukan argon2id (D-02), sehingga kolom parameter algoritma belum ada. Penguncian akun tidak disimpan di sini: hitungan percobaan gagal dibaca dari `audit_logs` (Lampiran A F-17), sehingga restart proses tidak menihilkan kuncian.

#### `tenant_memberships`

```text
id UUID PK DEFAULT gen_random_uuid()
tenant_id UUID NOT NULL
user_id UUID NOT NULL
status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
version INTEGER NOT NULL DEFAULT 1
UNIQUE (tenant_id, user_id)
UNIQUE (tenant_id, id)
FK (tenant_id) -> tenants (id); FK (user_id) -> users (id)
CHECK (status IN ('ACTIVE','SUSPENDED','ENDED'))
CHECK (version >= 1)
```

`version` adalah optimistic locking untuk mutasi anggota (§11.3). Tidak ada kolom `joined_at`/`ended_at` terpisah: `created_at` dan `status` sudah memenuhi kebutuhan demo.

#### `roles`

```text
id UUID PK DEFAULT gen_random_uuid()
tenant_id UUID NOT NULL
code VARCHAR(64) NOT NULL
name VARCHAR(100) NOT NULL
is_system BOOLEAN NOT NULL DEFAULT FALSE
archived_at TIMESTAMPTZ NULL
version INTEGER NOT NULL DEFAULT 1
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE (tenant_id, code)
UNIQUE (tenant_id, id)
FK (tenant_id) -> tenants (id)
CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$')
CHECK (NOT (is_system AND archived_at IS NOT NULL))
CHECK (version >= 1)
```

Arsip diwakili `archived_at`, bukan `is_active`: waktunya ikut tercatat. Role sistem tidak dapat diarsipkan maupun diubah tenant (policy, migrasi 0013).

#### `permissions`

```text
code VARCHAR(64) PK
scope VARCHAR(10) NOT NULL          -- TENANT | PLATFORM
description VARCHAR(200) NOT NULL
retired_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE (code, scope)                -- target composite FK dari role_permissions
CHECK (scope IN ('TENANT','PLATFORM'))
CHECK (code ~ '^[a-z_]+(\.[a-z_]+)+$')
CHECK ((scope = 'PLATFORM') = (code LIKE 'platform.%'))
```

Kode permission adalah primary key: kode itulah yang dipakai guard dan yang ditulis di dokumen, jadi tidak ada id kedua yang harus dijaga tetap selaras. `UNIQUE (code, scope)` tampak berlebihan di sebelah primary key, tetapi itulah yang membuat `role_permissions` dapat memakai composite FK `(permission_code, permission_scope = 'TENANT')`, sehingga permission platform tidak dapat dipasang ke role tenant — ditolak database, bukan validasi aplikasi.

Katalog tidak dapat ditulis siapa pun saat runtime (tidak ada grant tulis, RLS `FORCE` tanpa policy tulis). Menambah permission adalah migration.

#### `role_permissions`

```text
tenant_id UUID NOT NULL
role_id UUID NOT NULL
permission_code VARCHAR(64) NOT NULL
permission_scope VARCHAR(10) NOT NULL DEFAULT 'TENANT'
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
PRIMARY KEY (tenant_id, role_id, permission_code)
FK (tenant_id, role_id) -> roles (tenant_id, id)
FK (permission_code, permission_scope) -> permissions (code, scope)
CHECK (permission_scope = 'TENANT')
```

Tidak ada kolom `created_by`: pemberi permission pada role tercatat di `audit_logs` (`role.permissions_replaced`), bukan didenormalisasi ke baris.

#### `user_role_assignments`

```text
id UUID PK DEFAULT gen_random_uuid()
tenant_id UUID NOT NULL
membership_id UUID NOT NULL
role_id UUID NOT NULL
assigned_by_membership_id UUID NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
ended_at TIMESTAMPTZ NULL
UNIQUE (tenant_id, id)
FK (tenant_id, membership_id)              -> tenant_memberships (tenant_id, id)
FK (tenant_id, role_id)                    -> roles (tenant_id, id)
FK (tenant_id, assigned_by_membership_id)  -> tenant_memberships (tenant_id, id)
CHECK (ended_at IS NULL OR ended_at >= created_at)
```

`assigned_by_membership_id` boleh NULL: pemberinya dapat berupa proses seed, dan membership pemberi dapat dihapus tanpa menghapus jejak penugasan.

Satu assignment aktif per `(tenant, membership, role)` ditegakkan oleh partial unique index, bukan oleh `UNIQUE` biasa (baris historis dengan `ended_at` terisi harus tetap boleh berulang):

```sql
CREATE UNIQUE INDEX user_role_assignments_active_uq
  ON user_role_assignments (tenant_id, membership_id, role_id)
  WHERE ended_at IS NULL;
```

Permission efektif dihitung view `effective_permissions` (`security_invoker`): membership `ACTIVE` x assignment aktif x role belum diarsipkan x permission `TENANT` belum pensiun.

#### `crypto_keys`

```text
id UUID PK DEFAULT gen_random_uuid()
tenant_id UUID NULL                  -- NULL untuk kunci platform
purpose VARCHAR(40) NOT NULL
key_version INTEGER NOT NULL
wrapped_dek BYTEA NOT NULL           -- DEK terbungkus KEK (61 byte, envelope v1)
status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
FK (tenant_id) -> tenants (id)
UNIQUE (COALESCE(tenant_id, sentinel-nol), purpose) WHERE status = 'ACTIVE'
UNIQUE (COALESCE(tenant_id, sentinel-nol), purpose, key_version)
CHECK (purpose IN ('platform_identity','platform_identity_blind_index',
                   'platform_audit_identifier','identity','identity_blind_index'))
CHECK ((purpose LIKE 'platform_%') = (tenant_id IS NULL))
CHECK (status IN ('ACTIVE','RETIRED'))
CHECK (octet_length(wrapped_dek) = 61 AND get_byte(wrapped_dek, 0) = 1)
```

Penyimpanan DEK terbungkus (Data Protection SSOT §9). Database tidak pernah memegang KEK maupun DEK terbuka: yang tersimpan hanya hasil pembungkusan. CHECK `purpose` x `tenant_id` membuat kunci platform tidak dapat diberi pemilik tenant dan sebaliknya. Rotasi kunci belum ada (D-15), sehingga `RETIRED` belum pernah dipakai.

#### `sessions` dan `refresh_tokens`

```text
sessions:
  id UUID PK DEFAULT gen_random_uuid()
  context_kind VARCHAR(10) NOT NULL          -- TENANT | PLATFORM
  tenant_id UUID NULL
  user_id UUID NOT NULL
  membership_id UUID NULL
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  last_seen_at TIMESTAMPTZ NULL
  expires_at TIMESTAMPTZ NOT NULL
  revoked_at TIMESTAMPTZ NULL
  revocation_reason VARCHAR(50) NULL
  UNIQUE (tenant_id, id)
  CHECK (context_kind IN ('TENANT','PLATFORM'))
  CHECK ((context_kind = 'TENANT') = (tenant_id IS NOT NULL))
  CHECK ((context_kind = 'TENANT') = (membership_id IS NOT NULL))
  FK (user_id)                  -> users (id)
  FK (tenant_id)                -> tenants (id)
  FK (tenant_id, membership_id) -> tenant_memberships (tenant_id, id)   -- MATCH SIMPLE

refresh_tokens:
  id UUID PK DEFAULT gen_random_uuid()
  context_kind VARCHAR(10) NOT NULL          -- sama dengan session
  tenant_id UUID NULL
  session_id UUID NOT NULL
  token_hash BYTEA NOT NULL UNIQUE
  family_id UUID NOT NULL
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
  expires_at TIMESTAMPTZ NOT NULL
  rotated_at TIMESTAMPTZ NULL
  revoked_at TIMESTAMPTZ NULL
  replaced_by_id UUID NULL
  CHECK (context_kind IN ('TENANT','PLATFORM'))
  CHECK ((context_kind = 'TENANT') = (tenant_id IS NOT NULL))
  FK (session_id)             -> sessions (id) ON DELETE CASCADE
  FK (tenant_id, session_id)  -> sessions (tenant_id, id)               -- MATCH SIMPLE
  FK (tenant_id)              -> tenants (id)
  FK (replaced_by_id)         -> refresh_tokens (id)
```

Integritas referensial tidak boleh diserahkan ke RLS: RLS menyaring baris yang **terbaca**, bukan baris yang **boleh ditulis sebagai referensi**. Tanpa composite FK di atas, satu baris `sessions` dapat menunjuk `membership_id` milik tenant lain dan database tidak menolaknya.

Catatan MATCH SIMPLE: untuk baris `context_kind = 'PLATFORM'`, `tenant_id` bernilai NULL sehingga composite FK tidak dievaluasi. Karena itu FK tunggal (`user_id`, `session_id`) tetap wajib ada agar jalur platform tidak kehilangan integritas. `UNIQUE (tenant_id, id)` pada `sessions` berfungsi sebagai candidate key target dan tidak melemahkan primary key `id`.

RLS untuk `app_user` hanya mencakup baris `context_kind = 'TENANT'` milik tenant aktif; baris `PLATFORM` hanya melalui fungsi Lampiran A F-07–F-10.

Raw refresh token tidak disimpan. Reuse token yang sudah dirotasi mencabut token family/session sesuai policy.

#### `audit_logs`

```text
id UUID PK DEFAULT gen_random_uuid()
occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
tenant_id UUID NULL
event_type VARCHAR(64) NOT NULL       -- nama event §15
outcome VARCHAR(16) NOT NULL          -- SUCCESS | FAILURE
actor_user_id UUID NULL
actor_session_id UUID NULL
actor_identifier_hash BYTEA NULL      -- HMAC berkunci (platform_audit_identifier)
subject_type VARCHAR(64) NULL
subject_id UUID NULL
detail JSONB NOT NULL DEFAULT '{}'
FK (event_type)    -> audit_event_types (code)
FK (tenant_id)     -> tenants (id)
FK (actor_user_id) -> users (id) ON DELETE SET NULL
CHECK (outcome IN ('SUCCESS','FAILURE'))
```

Hasil ada di `outcome`, alasan kegagalan sebagai reason code di `detail.reason` (§15). Pelaku yang belum dikenal (login gagal) diwakili `actor_identifier_hash`, bukan email. Tidak ada `request_id` dalam demo.

Audit payload tidak boleh memuat password, token, credential, raw email, raw name, authorization header, atau before/after personal data. Kunci `email`, `password`, `token`, `ticket`, dan `password_hash` di `detail` ditolak fungsi penulis (Lampiran A F-14).

Event yang terjadi sebelum tenant context (misalnya `auth.login` dengan outcome `FAILURE`) atau yang ditulis dari context platform ke audit tenant (misalnya `support.session.started`) memakai fungsi penulis audit terdaftar (Lampiran A F-14); `UPDATE`/`DELETE` pada `audit_logs` di-revoke dari `app_user`, dan `app_user` tidak punya `INSERT` sama sekali.

Allowlist nama event **tidak** berupa daftar di dalam fungsi penulis, melainkan katalog `audit_event_types` dengan foreign key dari `audit_logs.event_type`. Aturan yang dipasang di tabel berlaku untuk setiap penulis audit, termasuk yang ditambahkan kemudian (F-15).

#### `audit_event_types`

```text
code VARCHAR(64) PK          -- nama event, §15
description VARCHAR(200) NOT NULL
retired_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
CHECK (code ~ '^[a-z_]+(\.[a-z_]+)+$')
```

Katalog global, read-only untuk tenant. Menambah nama event adalah migration, sama seperti katalog permission.

#### `menus`

```text
id UUID PK DEFAULT gen_random_uuid()
tenant_id UUID NULL                          -- REFERENCES tenants; NULL = menu platform
owner_key UUID NOT NULL GENERATED ALWAYS AS
  (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED
parent_id UUID NULL
context_kind VARCHAR(10) NOT NULL DEFAULT 'TENANT'   -- TENANT | PLATFORM
code VARCHAR(64) NOT NULL
label VARCHAR(80) NOT NULL
path VARCHAR(120) NULL
icon VARCHAR(40) NULL
sort_order INTEGER NOT NULL DEFAULT 0
is_active BOOLEAN NOT NULL DEFAULT TRUE
is_system BOOLEAN NOT NULL DEFAULT FALSE
is_public_authenticated BOOLEAN NOT NULL DEFAULT FALSE
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
version INTEGER NOT NULL DEFAULT 1
UNIQUE (owner_key, id)
UNIQUE (owner_key, code)
UNIQUE (owner_key, id, context_kind)         -- sasaran composite FK dari menu_permissions
FK (owner_key, parent_id) -> menus (owner_key, id)
CHECK (context_kind IN ('TENANT','PLATFORM'))
CHECK (tenant_id IS NULL OR context_kind = 'TENANT')
CHECK (parent_id IS NULL OR parent_id <> id)
CHECK (path IS NULL OR path ~ '^/[a-z0-9][a-z0-9/_-]*$')
CHECK (code ~ '^[a-z][a-z0-9-]*$')
CHECK (sort_order >= 0)
INDEX (owner_key, parent_id, sort_order)
```

`owner_key` adalah materialisasi "ownership scope" sebagai kolom nyata: `tenant_id` untuk tenant menu, dan UUID sentinel nol untuk platform menu (`tenant_id IS NULL`). Kolom ini ada karena PostgreSQL tidak dapat memakai ekspresi sebagai target foreign key maupun sebagai kolom unique constraint. Nilai sentinel tidak pernah dipakai sebagai `tenants.id`.

`context_kind` menempel pada MENU, bukan hanya pada permission yang dipetakan padanya: menu platform boleh ber-context `TENANT` (navigasi tenant yang sama untuk semua tenant, mixed-ownership ADR-001 §3.8) atau `PLATFORM` (navigasi konsol platform). Menu milik tenant tidak dapat menjadi menu konsol platform — itu CHECK, bukan konvensi.

`is_public_authenticated` adalah **satu-satunya** pengecualian deny-by-default (§10.2), dan ia dinyatakan per baris. Pengecualian yang hidup di kode akan tumbuh; pengecualian yang berupa kolom harus ditulis pada baris yang memintanya.

Constraints, dan siapa yang menegakkannya:

- parent dan child berada pada ownership scope yang sama — composite FK `(owner_key, parent_id)`;
- hierarchy tidak boleh cycle dan tidak boleh lebih dari 10 tingkat — trigger `menus_hierarchy_guard` (Lampiran A **F-20**), karena CHECK dan FK hanya melihat satu baris;
- route internal saja — CHECK `menus_path_ck` menolak skema yang dapat dieksekusi (`javascript:`), URL absolut (`https://...`, `//host`), dan penelusuran direktori (`..`). Yang ditolak bukan "URL yang aneh" melainkan segala yang bukan path aplikasi: menu yang dapat menunjuk ke luar aplikasi adalah permukaan phishing di dalam navigasi yang dipercaya pengguna;
- `code` boleh memuat tanda hubung karena ia dipakai juga di luar database (mengikuti gaya route, dan menjadi `data-testid` navigasi). Satu pengenal, satu ejaan.

RLS: `app_user` hanya memperoleh `SELECT`. Tidak ada grant INSERT/UPDATE/DELETE sama sekali — administrasi menu adalah P2 (§11.5), dan menyatakannya lewat GRANT membuat pernyataan itu berlaku juga bagi kode yang keliru. Policy `tenant_read` melayani context `tenant` DAN `support` (baris `context_kind = 'TENANT'` milik platform atau tenant aktif); policy `platform_read` hanya context `platform` (baris `PLATFORM` tanpa tenant).

Seed migrasi 0021 memuat 8 menu sistem milik platform: 6 menu navigasi tenant (`dashboard` terbuka, grup `administration` dengan `members`, `invitations`, `roles`, `security`) dan 2 menu konsol platform (`platform-admins`, `platform-support`). Menu `Profile` pada §16.3 belum ada karena halaman `/profile` belum dibuat (DEMO-0206): menu yang menunjuk halaman yang tidak ada menawarkan jalan buntu.

#### `menu_permissions`

```text
tenant_id UUID NULL                          -- REFERENCES tenants
owner_key UUID NOT NULL GENERATED ALWAYS AS
  (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED
menu_id UUID NOT NULL
context_kind VARCHAR(10) NOT NULL            -- disalin dari menunya
permission_code VARCHAR(64) NOT NULL
permission_scope VARCHAR(10) NOT NULL
match_mode VARCHAR(4) NOT NULL DEFAULT 'ANY' -- ANY | ALL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
PRIMARY KEY (owner_key, menu_id, permission_code)
FK (owner_key, menu_id, context_kind) -> menus (owner_key, id, context_kind)
FK (permission_code, permission_scope) -> permissions (code, scope)
CHECK (permission_scope = context_kind)
CHECK (match_mode IN ('ANY','ALL'))
```

`ANY` berarti user melihat menu bila memiliki minimal satu permission yang dipetakan; `ALL` menuntut seluruhnya. Keduanya diimplementasikan dan diuji eksplisit (`ALL` di API slice 15 #7).

Dua kolom untuk satu nilai (`context_kind` dan `permission_scope`) terlihat berlebih, dan justru itu yang membuat KEDUA sisi dapat dijaga foreign key: scope permission dipaksa sama dengan context menu, sehingga menu konsol platform tidak dapat dipetakan ke permission tenant (selalu tak terlihat, tanpa pesan) maupun sebaliknya (terlihat oleh orang yang tidak berhak membuka halamannya). Pola yang sama dengan `role_permissions` dan `platform_role_permissions`.

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

Notifikasi keamanan in-app minimal (ADR-003 §2.4); insert hanya via F-15; dibaca member dengan `audit.read`.

Ada di database sejak migrasi 0019 (DEMO-0313). Sejak migrasi 0020 (DEMO-0312) `ref_id` adalah
FOREIGN KEY **komposit** `(tenant_id, ref_id) -> support_sessions (tenant_id, id)`: notifikasi
sebuah tenant hanya dapat menunjuk sesi support milik tenant itu.

#### `support_sessions`

```text
id UUID PK
tenant_id UUID NOT NULL                      -- REFERENCES tenants
superadmin_user_id UUID NOT NULL             -- REFERENCES users
platform_session_id UUID NOT NULL            -- REFERENCES sessions; sesi mati bersama session ini
scope VARCHAR(12) NOT NULL                   -- READ_ONLY | READ_WRITE
reason_code VARCHAR(48) NOT NULL             -- allowlist CHECK (4 nilai)
reason_text_ciphertext BYTEA NOT NULL        -- DEK PLATFORM, purpose platform_support_reason
reason_text_key_version INTEGER NOT NULL
ticket_reference VARCHAR(64) NULL            -- CHECK tanpa '@' (bukan tempat data pribadi)
started_at TIMESTAMPTZ NOT NULL DEFAULT now()
expires_at TIMESTAMPTZ NOT NULL              -- CHECK: > started_at DAN <= started_at + 60 menit
ended_at TIMESTAMPTZ NULL
ended_by UUID NULL                           -- REFERENCES users
end_reason VARCHAR(24) NULL                  -- MANUAL | EXPIRED | PLATFORM_LOGOUT | REVOKED
status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE' -- ACTIVE | ENDED | EXPIRED | REVOKED
UNIQUE (tenant_id, id)
UNIQUE (superadmin_user_id) WHERE status = 'ACTIVE'
CHECK (scope = 'READ_ONLY' OR reason_code = 'DATA_CORRECTION_REQUESTED_BY_TENANT')
CHECK ((status = 'ACTIVE') = (ended_at IS NULL))
```

Support session break-glass (ADR-003 §2.2), ada sejak migrasi 0020 (DEMO-0312). `expires_at`
tidak punya grant UPDATE untuk `app_user`, jadi "tidak dapat diperpanjang" adalah hak kolom -
bukan pemeriksaan aplikasi.

## 8. Authentication and session flow

### 8.1 Login dan pemilihan context

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
  -> audit auth.select_context SUCCESS (tenant context via writer biasa, platform via F-14)
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
- `POST /me/context-switch` memverifikasi target, membuat session baru, dan mencabut session lama; audit `auth.context_switch`.
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

Backend `GET /api/v1/me/menu` (tanpa permission; session sah sudah cukup, termasuk sesi support):

1. memverifikasi session, tenant, dan membership;
2. menghitung effective permissions;
3. mengambil menu platform aktif dan menu tenant aktif;
4. mengevaluasi `menu_permissions`;
5. membuang menu yang tidak memenuhi permission;
6. membuang parent tanpa visible child dan tanpa accessible route sendiri;
7. menyusun hierarchy berdasarkan `parent_id`;
8. mengurutkan `sort_order`, lalu stable secondary order;
9. mengembalikan DTO minimal tanpa internal permission/debug data yang tidak dibutuhkan.

Tiga hal yang **tidak** dilakukan, dan itu disengaja:

- tidak ada peta nama role ke menu — yang dibaca adalah permission efektif backend (§10.2);
- tidak ada cache — hak yang baru dicabut harus hilang dari navigasi pada permintaan berikutnya, dan cache menukar sifat itu dengan satu query yang dihemat;
- tidak ada kode permission di keluaran — navigasi adalah petunjuk tampilan, dan membocorkan peta hak akses lewatnya memberi penyerang daftar yang justru disembunyikan respons 403.

Ketiga context memakai satu pintu yang sama; yang berbeda hanya DARI MANA permission datang (`tenant`: permission efektif membership; `platform`: permission platform; `support`: `SUPPORT_READ_SET`/`SUPPORT_WRITE_SET` ADR-003 §2.2, bukan membership — sesi support tidak punya membership). Penyaringan barisnya dikerjakan policy RLS per context, bukan klausa `WHERE` di aplikasi, sehingga kode yang keliru tidak dapat meminta menu konsol platform dari session tenant.

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
  "menu": [
    {
      "code": "dashboard",
      "label": "Dasbor",
      "path": "/dashboard",
      "icon": "home",
      "children": []
    },
    {
      "code": "administration",
      "label": "Administrasi",
      "path": null,
      "icon": "settings",
      "children": [
        {
          "code": "members",
          "label": "Anggota",
          "path": "/administration/members",
          "icon": "users",
          "children": []
        }
      ]
    }
  ]
}
```

Bentuk di atas adalah yang benar-benar dikembalikan implementasi. Demo **tidak** memakai amplop `{ success, data, meta }` di endpoint mana pun — contoh edisi sebelumnya adalah satu-satunya tempat amplop itu muncul di dokumen ini, dan menyelaraskannya dengan satu endpoint saja justru akan membuat `GET /me/menu` menjadi pengecualian. Keputusan amplop respons seragam belum diambil; bila kelak diambil, ia berlaku untuk seluruh endpoint sekaligus melalui change control.

Setiap butir memuat tepat lima kunci (`code`, `label`, `path`, `icon`, `children`) — tidak ada `id`, `sort_order`, `is_active`, maupun kode permission, dan tes menuntut daftar kunci itu persis, bukan sekadar "tidak ada permission".

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

Tambahan:

```text
GET  /auth/contexts          (hanya dengan tiket pemilihan)
POST /auth/select-context
GET  /notifications/security  (audit.read) -> tenant_notifications tenant aktif
POST /notifications/security/:id/read
GET  /support-sessions        (audit.read) -> support_sessions tenant aktif (sisi TENANT)
```

`GET /support-sessions` adalah sisi tenant dari ADR-003 §2.4: notifikasi memberi tahu bahwa
sesuatu terjadi, daftar ini memberi tahu APA - scope, `reason_code`, nomor tiket, kapan mulai dan
kapan berakhir. Teks alasan TIDAK termasuk: kuncinya DEK platform (ADR-003 §2.4), jadi tenant
tidak dapat membukanya. Tenant tidak dapat membuat, mengubah, maupun mengakhiri sesi dari sini;
mengakhiri sesi support adalah tindakan platform. Route ini juga dipanggil DARI context support -
dengan hasil berbeda: policy hanya memperlihatkan baris sesi yang sedang berjalan.

`PATCH /me/profile` hanya memperbarui `display_name` pada `tenant_member_profiles` untuk tenant aktif.

Bentuk permintaan pemilihan context (DEMO-0311): `POST /auth/select-context` menerima
`{ ticket, kind: "TENANT" | "PLATFORM", tenantId? }`. `kind` boleh tidak dikirim dan berarti
`TENANT`, sehingga bentuk permintaan sebelum DEMO-0311 tetap berlaku; `kind: "PLATFORM"` yang
ikut membawa `tenantId` ditolak `400` - permintaan yang isinya bertentangan lebih baik gagal
daripada ditafsirkan. `GET /me/contexts` dan `GET /auth/contexts` mengembalikan satu baris per
context beserta `kind`; baris `PLATFORM` tidak punya `tenantId`, `tenantSlug`, maupun
`tenantName`, jadi pemakainya WAJIB menyaring sebelum menawarkan perpindahan tenant.

`GET /me/permissions` mengembalikan `kind` bersama `tenantId` dan daftar permission. Untuk
session `PLATFORM` isinya `{ kind: "PLATFORM", tenantId: null, permissions: [] }`: hak platform
TIDAK dikembalikan di jalur ini, karena jalur ini untuk tampilan tenant dan yang memutuskan
route platform tetap guard-nya. Tanpa `kind`, jawaban itu tidak dapat dibedakan dari anggota
tenant tanpa hak apa pun, dan frontend merendernya sebagai kerangka tenant kosong - jalan
buntu, bukan penolakan.

### 11.1a Invitation

```text
POST /invitations            (members.invite)   -> 202, respons seragam
GET  /invitations            (members.read)     -> status undangan tenant aktif
POST /invitations/:id/revoke (members.invite)
POST /invitations/accept     (public, token + authentication/credential setup)
```

Penerimaan undangan memakai F-11 dan F-12; role diambil dari `invitation_roles` (tersedia sejak Phase D3; sebelum itu undangan diterima tanpa role dan membership bersifat default-deny); contact email disalin ke `tenant_member_profiles`.

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

Superadmin pertama dibuat melalui bootstrap command server (Infrastructure SSOT §8.7.1), bukan seed API.

Platform endpoints memerlukan platform permission dan audit. Tenant administration biasa tidak memakai route platform.

### 11.3 Member administration

```text
GET   /members                   (members.read; filter: status, role, email exact)
GET   /members/:membershipId     (members.read)
PATCH /members/:membershipId/profile   (members.update_profile; display_name only)
POST  /members/:membershipId/suspend     (members.suspend)
POST  /members/:membershipId/reactivate  (members.suspend)
PUT   /members/:membershipId/roles       (members.assign_role)
```

Suspend dan reactivate memakai aturan yang sama: tidak untuk membership actor sendiri; actor harus memegang seluruh permission yang dipegang target lewat role aktifnya (dinilai dari role yang dipegang, bukan effective permission, karena effective permission anggota yang ditangguhkan kosong); optimistic locking dengan `version`; audit. Suspend mencabut session target di tenant itu; reactivate tidak menghidupkan session lama, sehingga target login ulang.

Tidak ada `POST /users` atau `PATCH /users/:id` (ADR-002). Resource diidentifikasi dengan `membership_id`, bukan `user_id` global.

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
- tenant owner/auditor melihat notifikasi keamanan (support session) pada header/dashboard, dan daftar sesi dukungan atas tenantnya pada layar Keamanan;
- selama support session berjalan, banner PERMANEN terlihat di setiap halaman tenant: nama tenant, scope, sisa waktu, dan tombol mengakhiri sesi (ADR-003 §2.2 butir 8). Di mode support, tombol keluar dan pemindah tenant tidak ditampilkan - keduanya route identitas yang ditolak API untuk sesi support, dan tombol yang pasti gagal lebih buruk daripada tombol yang tidak ada;
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
- Data Field Register minimum harus mencatat `users.email`, `users.legal_name`, `tenant_member_profiles.display_name`, `tenant_member_profiles.contact_email`, `user_invitations.email`, credential/token/invitation-token fields, session identifiers, audit actor reference, dan IP/device field jika dikumpulkan — termasuk atribut `processing_role` (Data Protection SSOT §13).

## 15. Audit events

Konvensi nama: `<domain>.<aksi>`. Hasil disimpan di kolom `outcome` (`SUCCESS`/`FAILURE`), **bukan** di nama event; alasan kegagalan disimpan sebagai reason code di metadata (`detail.reason`). Satu nama per aksi membuat penghitungan kegagalan (rate limiting) dan pencarian audit cukup memakai satu nama. Pengecualian: kejadian keamanan yang harus dapat dipasangi alarm tanpa membaca metadata mendapat nama sendiri (`auth.refresh.reuse_detected`).

Daftar ini adalah allowlist: isinya sama dengan katalog `audit_event_types` (§7.3), dan `audit_logs` menolak nama di luar katalog.

Minimum events:

```text
auth.login                    (SUCCESS | FAILURE; reason IDENTITY_NOT_FOUND, BAD_PASSWORD, IDENTITY_NOT_ACTIVE, NO_ACTIVE_CONTEXT)
auth.login.context_required   (identitas lintas tenant; tiket diterbitkan)
auth.login.throttled          (FAILURE; rate limit)
auth.select_context           (SUCCESS | FAILURE; reason TICKET_INVALID, NOT_A_MEMBER)
auth.context_switch           (SUCCESS | FAILURE; reason NOT_A_MEMBER)
auth.refresh                  (SUCCESS | FAILURE; reason EXPIRED, INVALID, SESSION_GONE)
auth.refresh.reuse_detected   (FAILURE; seluruh family token dicabut)
auth.logout

identity.created              (identitas baru saat menerima undangan)

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
member.reactivated
member.roles_replaced

role.created
role.updated
role.archived
role.permissions_replaced

menu.created
menu.updated
menu.archived
menu.permissions_replaced

authz.denied                  (permission, method, pola route; tanpa id dari URL)
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
Dasbor                       (terbuka bagi setiap session sah)
Administrasi                 (grup tanpa route; muncul hanya bila ada anak yang terlihat)
|-- Anggota                  members.read
|-- Undangan                 members.read
|-- Role                     roles.read
`-- Keamanan                 audit.read

Konsol platform (context PLATFORM):
|-- Admin platform           platform.admins.read
`-- Sesi dukungan            platform.support.start_read
```

Tenant User hanya melihat Dasbor: grup Administrasi dipangkas karena tak satu pun anaknya terlihat. Admin melihat anak-anak Administrasi sesuai permission.

Dua penyimpangan dari rancangan awal, dicatat apa adanya: menu **Profile** belum ada karena halaman `/profile` belum dibuat (DEMO-0206), dan **Audit Log** hadir sebagai **Keamanan** (`/administration/notifications`) — layar yang sudah ada dan yang memang dijaga `audit.read`. Menu **Menus (P2)** tidak diseed, sejalan dengan §11.5. Undangan dipetakan ke `members.read` mengikuti `GET /invitations` (§11.1a), bukan ke `members.invite`: memetakannya ke hak mengundang akan menyembunyikan daftar dari auditor yang justru boleh melihatnya.

## 17. Implementation phases

### Phase D0 — Infrastructure verification

- Node, PostgreSQL, NestJS health, Prisma, Next.js, dan OpenAPI lulus parent SSOT gate.

### Phase D1 — Tenant and identity schema

- spike Prisma + RLS + pool reuse lulus (go/no-go);
- urutan migration wajib: crypto adapter → `users`/`credentials` → tenant, membership, member profile (termasuk contact email), invitation, selection ticket, audit log, sessions/refresh_tokens mixed-ownership, platform_role_assignments, tiga database role, RLS (termasuk mixed-ownership), encryption fields, dan blind index;
- `invitation_roles` dan tabel RBAC (`roles`, `role_permissions`, `user_role_assignments`) dibuat di Phase D3, bukan di sini, karena bergantung pada permission catalog;
- fungsi dan policy `TO app_auth_definer` sesuai `ARCHITECTURE_DECISIONS.md` Lampiran A, beserta schema inspection test;
- two-tenant isolation test lulus.

### Phase D2 — Authentication and session

- login bercabang TENANT/PLATFORM, tiket pemilihan context, bootstrap superadmin, refresh rotation, reuse detection, logout/revocation, context switch, rate limit, dan audit.

### Phase D3 — RBAC dan superadmin

- roles, permissions, tenant assignments, `invitation_roles` + increment penerimaan undangan, permission guard, deny-by-default, dan cross-tenant negative tests;
- platform guard, admin platform, break-glass support session (termasuk tenant non-ACTIVE READ_ONLY), dan `tenant_notifications` (ADR-003).

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
- fungsi register membaca lintas tenant tanpa `app.current_tenant_id` melalui policy `TO app_auth_definer`, sementara `app_user` pada tabel yang sama mendapat 0 baris;
- tidak ada role runtime/auth dengan `BYPASSRLS`; `app_user` bukan member `app_auth_definer`; tidak ada fungsi/policy di luar register;
- baris session PLATFORM tidak terbaca dari context tenant.

### 18.2a Identity & invitation

- `POST /invitations` untuk email baru vs email terdaftar tidak dapat dibedakan (status, body, timing praktis);
- admin tenant tidak memiliki path baca/tulis ke `users`/`credentials`;
- undangan hanya dapat diterima oleh pemilik email; token single-use dan kedaluwarsa;
- perubahan display name di Tenant Alpha tidak terlihat di Tenant Beta untuk Multi-Tenant User;
- role dari tenant lain pada `invitation_roles` ditolak composite FK;
- `GET /members` menampilkan email masked dan filter email exact bekerja tanpa akses ke `users`; contact email Alpha tidak terbaca dari Beta.

### 18.2b Superadmin dan support session

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
- support session ke tenant SUSPENDED dipaksa READ_ONLY; PURGED ditolak;
- event support ke audit tenant dan `tenant_notifications` hanya melalui F-14/F-15;
- logout session PLATFORM mengakhiri support session aktif.

### 18.2c Login context

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
- actor tanpa `owners.manage` tidak dapat memberi/mencabut role owner, maupun menangguhkan/mengaktifkan kembali pemegangnya.

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

### Scenario 6 — Superadmin dan break-glass support

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

SaaS Demo Foundation dinyatakan **DONE** apabila:

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

## 24. Open implementation decisions

- cookie versus authorization-header delivery strategy;
- exact access/refresh TTL and idle timeout;
- Argon2id parameter set;
- demo key mechanism (Data Protection SSOT §9.2 opsi C atau A-dev) dan encryption library;
- ~~whether email identity is globally unique or tenant-scoped~~ — **ditutup oleh ADR-002 (global identity, invitation-only)**;
- TTL undangan (ADR-002 open decision);
- ~~tenant-switch session strategy~~ — **ditetapkan:** session baru per context, session lama dicabut;
- isi final `SUPPORT_READ_SET`/`SUPPORT_WRITE_SET` dan daftar `reason_code` (ADR-003);
- **known limitation demo:** MFA superadmin di luar scope demo, tetapi wajib sebelum production;
- icon registry/library;
- final UI component system;
- E2E test framework;
- CI/CD platform;
- deployment host and secret manager.

Open decision tidak boleh diisi dengan asumsi diam-diam. Keputusan yang memengaruhi security, schema, atau public contract harus dicatat melalui change control.

## Riwayat

| Edisi | Tanggal | Ringkasan |
|---|---|---|
| 2.0 | 2026-09-16 | Edisi final hasil konsolidasi dari SaaS Demo Foundation SSOT v1.3; penanda revisi dan change log berlapis dihapus; isi normatif tidak diubah selain perapian rujukan. Riwayat keputusan: `README.md` §5; versi lengkap sebelumnya: `_archive/` |
| 2.1 | 2026-09-19 | Constraint konseptual diubah menjadi objek database nyata: partial unique index untuk assignment role aktif, kolom `owner_key` (generated) pada `menus`/`menu_permissions` menggantikan "ownership scope", composite FK tenant-safe pada `sessions`/`refresh_tokens` beserta `UNIQUE (tenant_id, id)` dan catatan MATCH SIMPLE untuk baris PLATFORM |
| 2.2 | 2026-09-22 | Table Ownership Register: kolom fungsi pre-context untuk `tenants`, `users`, `credentials`, dan `user_invitations` mengikuti Lampiran A edisi 2.1 (F-16 baru; F-12 membaca `tenants` dan `users`). Tidak ada perubahan klasifikasi maupun kontrol |
| 2.3 | 2026-09-22 | §5: permission penanda `owners.manage` ditambahkan ke katalog beserta aturannya; §6: hanya `tenant_owner` yang memegangnya; §11.3: `POST /members/:membershipId/reactivate` dan aturan bersama suspend/reactivate; §15: `member.reactivated`; §18.3: kasus uji owner. Keputusan pemilik proyek (D-27, D-28) |
| 2.4 | 2026-09-22 | §15 ditulis ulang dengan konvensi `<domain>.<aksi>` + `outcome` + reason code, sesuai implementasi; nama hasil-dalam-nama (`*.succeeded`, `*.failed`, `*_changed`, `authorization.denied`, `auth.context_selection_ticket_rejected`) diganti; `auth.refresh.reuse_detected` dipertahankan sebagai nama tersendiri; §7.3 dan §8 contoh nama event diselaraskan. Keputusan pemilik proyek (D-29) |
| 2.5 | 2026-09-23 | §7.1/§7.2/§7.3: katalog `audit_event_types` (platform-global, read-only untuk tenant) sebagai penegak allowlist nama event lewat foreign key dari `audit_logs`; §15 dinyatakan sebagai isi katalog itu. Keputusan pemilik proyek (D-30) |
| 2.6 | 2026-09-23 | §7.3 diselaraskan dengan implementasi (D-31): kolom, tipe, constraint, dan partial index setiap tabel mengikuti `db/migrations`; `crypto_keys` ditambahkan ke §7.1/§7.2/§7.3; tabel yang belum dibuat (`menus`, `menu_permissions`, `tenant_notifications`) ditandai rencana; `menu_permissions` merujuk permission lewat `code`. Keputusan pemilik proyek |
| 2.9 | 2026-09-28 | §7.3: `menus` dan `menu_permissions` ditulis sesuai implementasi (migrasi 0021) dan tidak lagi berstatus rencana — `context_kind` pada menu, `is_public_authenticated` sebagai satu-satunya pengecualian deny-by-default, CHECK route/kode, trigger hierarki F-20, dan GRANT baca-saja; §7.2 kolom RLS/register kedua tabel disesuaikan; §5 menegaskan `menus.read` adalah permission administrasi menu dan BUKAN syarat `GET /me/menu`; §10.1 mencatat ketiga context memakai satu resolver dengan sumber permission berbeda dan tiga hal yang sengaja tidak dilakukan; §10.3 contoh respons diganti dengan bentuk yang benar-benar dikembalikan (tanpa amplop `success/data/meta`, yang memang tidak dipakai endpoint mana pun); §16.3 seed menu sesuai migrasi beserta dua penyimpangan dari rancangan awal (Profile menunggu DEMO-0206, Audit Log hadir sebagai Keamanan). Keputusan pemilik proyek (DEMO-0409 Bagian A); review Security pending |
| 2.8 | 2026-09-27 | §7.3: blok `support_sessions` ditambahkan sesuai implementasi (migrasi 0020) dan `tenant_notifications` tidak lagi berstatus rencana, dengan FK komposit `(tenant_id, ref_id)`; §11.1 menambah `GET /support-sessions` sisi tenant beserta batasnya (tanpa teks alasan, tanpa aksi); §12.1 mencatat banner mode support permanen dan hilangnya tombol keluar/pemindah tenant di mode itu. Keputusan pemilik proyek (slice 14, DEMO-0312); review Security pending |
| 2.7 | 2026-09-26 | §11.1: bentuk permintaan `POST /auth/select-context` (`kind` TENANT/PLATFORM, `tenantId` hanya untuk TENANT), bentuk jawaban `GET /me/contexts` dan `GET /auth/contexts` (satu baris per context beserta `kind`; baris PLATFORM tanpa tenant), dan `kind` pada `GET /me/permissions` dicatat sesuai implementasi. Hak platform tidak dikembalikan lewat `/me/permissions`. Keputusan pemilik proyek (slice 13, DEMO-0311); review Security pending |
