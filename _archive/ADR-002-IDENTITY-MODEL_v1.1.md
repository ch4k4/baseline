---
title: "ADR-002 — Identity Model for Multi-Tenant SaaS"
adr_id: "ADR-002"
version: "1.1"
status: "Proposed; Technical and Security/Privacy Review Pending"
decision_date: "2026-09-16"
decision_owner: "<REQUESTER_PLACEHOLDER>"
technical_approver: "<TECHNICAL_APPROVER_PLACEHOLDER>"
security_privacy_approver: "<SECURITY_PRIVACY_APPROVER_PLACEHOLDER>"
supersedes: "ADR-002-IDENTITY-MODEL_v1.0.md"
related_adr:
  - "ADR-001-SAAS-MULTI-TENANCY_v1.3.md"
  - "ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.1.md"
related_ssot:
  - "DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md"
  - "GENERAL_FEATURE_BASE_SSOT_v1.4.md"
  - "SAAS_DEMO_FOUNDATION_SSOT_v1.3.md"
  - "PRE_CONTEXT_FUNCTION_REGISTER_v1.0.md"
review_reference: "REVIEW_BASELINE_DOCS_2026-09-16.md §1.2–1.4; REVIEW_BASELINE_DOCS_v2_2026-09-16.md §1.3, §1.9"
---

# ADR-002 — Identity Model v1.1

> **Perubahan v1.1:** salinan email kontak per tenant pada `tenant_member_profiles` agar daftar member dapat menampilkan email masked dan mencari email exact tanpa jalur ke `users` (§2.1, §2.6); `invitation_roles` menggantikan `intended_role_ids UUID[]` agar role lintas tenant ditolak composite FK; `accepted_membership_id`; `UNIQUE (tenant_id, id)` pada membership; permission `members.invite`; penerimaan undangan melalui fungsi register F-11/F-12.

## 1. Context

SaaS Demo Foundation v1.0 menetapkan `users` sebagai identitas global dengan `email_blind_index UNIQUE` global, sementara admin tenant dapat `POST /users` dan `PATCH /users/:id`. Review menemukan:

1. **Enumerasi lintas tenant** — respons konflik saat membuat user dengan email yang sudah ada membocorkan bahwa orang tersebut pengguna platform.
2. **Penulisan lintas tenant** — admin Tenant A dapat mengubah nama identitas yang juga tampil di Tenant B.
3. **Account linking tanpa persetujuan** — tidak jelas apakah identitas yang sudah ada otomatis dilampirkan ke tenant baru.
4. **Offboarding** — data identitas dienkripsi dengan kunci platform sehingga tidak dapat di-crypto-shred per tenant.
5. **Kontradiksi dokumen** — keputusan "email global vs per tenant" tercatat sebagai open decision padahal skema sudah memutuskannya.

## 2. Decision

```text
Identity scope        : Global platform identity (satu orang = satu login)
Login key             : Email ternormalisasi, unik global via platform blind index
Tenant onboarding     : Invitation-only; tenant admin tidak membuat identitas
Account linking       : Hanya setelah pemilik email menerima undangan
Tenant-facing profile : Per tenant (tenant_member_profiles), dienkripsi DEK tenant
Global identity edit  : Hanya oleh pemilik identitas (atau platform flow teraudit)
Response uniformity   : Invite/create selalu memberi respons yang sama
```

### 2.1 Entitas

```text
users                      (platform-global)
  id, email_ciphertext, email_blind_index UNIQUE, legal_name_ciphertext NULL,
  status, created_at, updated_at, version

credentials                (platform-global, secret)
  user_id, password_hash, algorithm, parameter_version, ...

user_invitations           (tenant-owned, RLS)
  id, tenant_id, email_ciphertext, email_blind_index_tenant, invited_by,
  token_hash, status (PENDING|ACCEPTED|EXPIRED|REVOKED),
  expires_at, accepted_membership_id NULL, created_at
  UNIQUE (tenant_id, id)
  UNIQUE (tenant_id, email_blind_index_tenant) WHERE status = 'PENDING'

invitation_roles           (tenant-owned, RLS)                          -- v1.1
  tenant_id, invitation_id, role_id
  PK (tenant_id, invitation_id, role_id)
  FK (tenant_id, invitation_id) -> user_invitations (tenant_id, id)
  FK (tenant_id, role_id)       -> roles (tenant_id, id)

tenant_memberships         (tenant-owned, RLS)
  id, tenant_id, user_id, status, joined_at, ended_at, version
  UNIQUE (tenant_id, user_id)
  UNIQUE (tenant_id, id)                                                -- v1.1

tenant_member_profiles     (tenant-owned, RLS)
  tenant_id, membership_id, display_name_ciphertext,
  display_name_search_tokens NULL (lihat §2.5), job_title NULL,
  contact_email_ciphertext,               (DEK tenant; v1.1)
  contact_email_blind_index_tenant,       (HMAC tenant-scoped; v1.1)
  contact_email_source ('INVITATION'), contact_email_captured_at, version
  PK (tenant_id, membership_id)
  FK (tenant_id, membership_id) -> tenant_memberships (tenant_id, id)
  UNIQUE (tenant_id, contact_email_blind_index_tenant)
```

### 2.2 Invitation flow

```text
Tenant admin (members.invite) submits email + intended roles
  -> normalize email
  -> compute tenant-scoped blind index for invitation dedup
  -> create/refresh invitation + invitation_roles (idempotent per tenant+email)
  -> respond 202 Accepted with identical body regardless of whether
     the email already has a platform identity
  -> deliver single-use invitation token (hash stored)

Recipient opens link
  -> F-11 find_invitation_for_acceptance(token_hash)             [pre-context]
  -> if identity exists: must authenticate as that identity
  -> if not: create identity + credential (email verified by token possession)
  -> server checks normalized identity email == invitation email (decrypt + compare,
     re-checked via blind index inside F-12)
  -> explicit "Join <tenant name>" confirmation
  -> F-12 accept_invitation: membership + tenant_member_profile (display name,
     contact email copy) + role assignments from invitation_roles (atomic)
  -> audit: invitation.accepted, membership.created
```

Aturan:

- Respons API invite tidak pernah membedakan "email baru" dan "email sudah terdaftar".
- Admin tenant hanya melihat status undangan miliknya (`PENDING/ACCEPTED/EXPIRED/REVOKED`), bukan status identitas global.
- Token undangan: acak entropi tinggi, disimpan sebagai keyed hash, single-use, TTL terbatas (nilai final: open decision §6).
- Pencocokan identitas saat penerimaan dilakukan server-side; tenant tidak pernah menerima `user_id` global sebelum undangan diterima.
- Pada demo tanpa email provider, token undangan dikeluarkan melalui secure local/demo provisioning channel (bukan dicatat di log).

### 2.3 Profile edit boundaries

| Data | Tempat | Siapa boleh mengubah |
|---|---|---|
| Email login | `users` | Pemilik identitas melalui flow verifikasi (di luar scope demo) |
| Legal name (opsional) | `users` | Pemilik identitas |
| Display name di tenant | `tenant_member_profiles` | Pemilik identitas **atau** admin tenant dengan permission `members.update_profile` |
| Job title, unit | `tenant_member_profiles` / modul Organization | Admin tenant sesuai permission |
| Status membership | `tenant_memberships` | Admin tenant (`members.suspend`) |
| Status identitas global | `users` | Platform flow teraudit saja |
| Contact email di tenant (v1.1) | `tenant_member_profiles` | Diisi otomatis saat undangan diterima; tidak dapat diubah admin tenant pada baseline |

Admin tenant **tidak dapat** mengubah field di `users` dan `credentials`.

### 2.4 Encryption keys

- `users.email_ciphertext`, `users.legal_name_ciphertext`: key purpose `platform_identity`; AAD = `platform` + table + field + record_id + schema version.
- `users.email_blind_index`: HMAC dengan key `platform_identity_blind_index`; tidak mengandung tenant (lookup login harus global).
- `user_invitations.email_*` dan `tenant_member_profiles.*` (termasuk `contact_email_*`): DEK tenant dengan key purpose `identity`; AAD memuat `tenant_id`; blind index tenant memakai key `identity_blind_index` milik tenant.
- Offboarding tenant dapat crypto-shred DEK tenant; identitas global dihapus hanya bila tidak ada membership tersisa dan retention/legal hold terpenuhi.

Ketentuan ini dicatat sebagai pengecualian terkontrol dalam Data Protection SSOT v1.1 §9.1.

### 2.5 Pencarian nama di administrasi tenant

Keputusan baseline: **exact/prefix-token search terbatas pada `display_name` tenant** menggunakan keyed search token per kata (HMAC per token kata yang dinormalisasi, prefix minimal 3 karakter dibatasi jumlahnya), memakai key `identity_search` milik tenant.

- Pencarian substring/fuzzy tidak didukung.
- Sorting berdasarkan nama dilakukan pada halaman hasil yang sudah didekripsi (bounded page size), bukan pada database.
- Risiko inferensi (frekuensi token) diterima untuk `display_name` karena bersifat DP-1 dan scoped per tenant; **tidak** berlaku untuk field DP-2.
- Demo Foundation boleh menunda fitur ini (pencarian hanya berdasarkan email exact); keputusan ini tetap wajib diuji sebelum production.

### 2.6 Email member di administrasi tenant (baru v1.1)

Admin tenant membutuhkan email member untuk mengenali dan mencari orang. v1.0 tidak menyediakan sumber data yang sah untuk itu, karena admin tidak memiliki jalur ke `users`.

Keputusan: **salinan per tenant** (`contact_email_*`) disimpan saat undangan diterima.

- `GET /members` menampilkan email **masked** dari salinan ini; filter `email exact` memakai `contact_email_blind_index_tenant`.
- Salinan **tidak** otomatis mengikuti perubahan email global. Perubahan email global (di luar scope demo) wajib memutuskan kebijakan sinkronisasi: propagasi ke seluruh tenant dengan audit, atau salinan tetap sebagai "email saat bergabung". Keputusan ini tercatat di §6.
- Salinan ikut di-crypto-shred saat offboarding tenant.
- Undangan yang sudah `ACCEPTED`/`EXPIRED`/`REVOKED` tidak menjadi sumber email member; retensi `user_invitations.email_*` ditetapkan (default usulan: dihapus/di-null-kan 30 hari setelah status final — nilai final Legal/DPO).

Alternatif yang tidak dipilih: identity service menyediakan email masked dari `users` untuk member tenant aktif. Lebih sinkron, tetapi membuka jalur baca tenant → identitas global yang harus diaudit per request dan melemahkan prinsip ADR ini.

## 3. Alternatives considered

| Alternative | Alasan tidak dipilih |
|---|---|
| Identitas per tenant (email unik per tenant) | Pengguna multi-tenant perlu banyak kredensial; tenant switch tidak mungkin tanpa login ulang; tetap dapat dipertimbangkan untuk tenant premium dengan IdP sendiri |
| Global identity + admin create langsung (v1.0) | Enumerasi, penulisan lintas tenant, linking tanpa persetujuan |
| Global identity + nama hanya di `users` | Admin tenant tidak dapat mengelola nama tampilan; crypto-shred per tenant tidak mungkin |
| Deterministic encryption untuk nama agar bisa dicari | Dilarang Data Protection SSOT §8.2 |

## 4. Consequences

Positive:

- tidak ada sinyal eksistensi identitas lintas tenant pada API tenant;
- persetujuan eksplisit sebelum identitas tergabung ke tenant;
- data tampilan tenant dapat dihapus/di-shred saat offboarding;
- tenant switch tetap satu login.

Negative:

- onboarding user memerlukan email/token delivery (demo memakai channel lokal);
- admin tidak dapat langsung "membuat user siap pakai";
- dua nama (legal vs display) dapat berbeda dan harus dijelaskan di UI;
- search token menambah kolom, key purpose, dan test.

## 5. Mandatory tests

- invite untuk email baru vs email terdaftar menghasilkan status code, body, dan waktu respons yang tidak dapat dibedakan secara praktis;
- admin Tenant A tidak dapat membaca/mengubah `users`, `credentials`, atau profil Tenant B;
- undangan tidak dapat diterima oleh identitas lain dari email tujuan;
- token undangan single-use, kedaluwarsa, dan tidak muncul di log;
- penerimaan undangan atomik (membership + profile + contact email copy + roles);
- role pada `invitation_roles` yang berasal dari tenant lain ditolak composite FK (bukan hanya validasi aplikasi);
- `GET /members` menampilkan email masked dan filter email exact bekerja tanpa query ke `users`;
- contact email Tenant A tidak terbaca dari Tenant B untuk Multi-Tenant User;
- offboarding tenant menghapus/men-shred profil tenant tanpa merusak membership di tenant lain.

## 6. Open decisions

- TTL undangan dan kebijakan re-send;
- apakah admin boleh mengubah `display_name` atau hanya pemilik;
- flow perubahan email global, verifikasinya, dan kebijakan sinkronisasi ke `contact_email_*` per tenant;
- retensi `user_invitations.email_*` setelah status final;
- tier IdP/SSO per tenant (akan menjadi ADR terpisah);
- batas jumlah search token per nama.

## 7. Approval

| Role | Decision | Date |
|---|---|---|
| Product/Architecture Direction | Proposed | 2026-09-16 |
| Technical | Pending | — |
| Security/Privacy | Pending | — |

## 8. Change log

| Version | Date | Summary |
|---|---|---|
| 1.0 | 2026-09-16 | Initial identity model: global identity, invitation-only onboarding, tenant member profile, key purposes, name search decision |
| 1.0-e1 | 2026-09-16 | Editorial: Sinkronisasi referensi ke versi berlaku per `DOCUMENT_VERSION_INDEX.md`; tanpa perubahan normatif |
| 1.1 | 2026-09-16 | Contact email copy per tenant; `invitation_roles` dengan composite FK; `accepted_membership_id`; `UNIQUE (tenant_id, id)`; `members.invite`; penerimaan via register F-11/F-12 |
