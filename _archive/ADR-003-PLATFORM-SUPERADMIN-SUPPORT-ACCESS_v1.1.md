---
title: "ADR-003 — Platform Superadmin and Break-Glass Support Access"
adr_id: "ADR-003"
version: "1.1"
status: "Proposed; Product Direction Chosen (break-glass); v1.1 Revisions Proposed; Technical and Security/Privacy Review Pending"
decision_date: "2026-09-16"
decision_owner: "<REQUESTER_PLACEHOLDER>"
technical_approver: "<TECHNICAL_APPROVER_PLACEHOLDER>"
security_privacy_approver: "<SECURITY_PRIVACY_APPROVER_PLACEHOLDER>"
supersedes: "ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.0.md"
related_adr:
  - "ADR-001-SAAS-MULTI-TENANCY_v1.3.md"
  - "ADR-002-IDENTITY-MODEL_v1.1.md"
related_ssot:
  - "INFRASTRUCTURE_SSOT_v1.5.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md"
  - "SAAS_DEMO_FOUNDATION_SSOT_v1.3.md"
  - "PRE_CONTEXT_FUNCTION_REGISTER_v1.0.md"
review_reference: "REVIEW_BASELINE_DOCS_v2_2026-09-16.md §1.2, §1.4–1.7"
---

# ADR-003 — Platform Superadmin and Break-Glass Support Access v1.1

> **Perubahan v1.1:** alur login dan session untuk context platform serta tiket pemilihan context (§2.6) — v1.0 tidak menyediakan tempat menyimpan session superadmin; support session boleh dibuka ke tenant non-ACTIVE sebagai pengecualian eksplisit (§2.2 aturan 10); jalur tulis audit tenant dan notifikasi in-app minimal melalui fungsi register F-14/F-15 (§2.3, §2.4); penegasan batas kepercayaan `READ ONLY` (§2.3).

## 1. Context

Platform membutuhkan **superadmin**: pihak tertinggi yang mengelola seluruh platform (tenant, status, entitlement, identitas global, admin platform, audit platform).

ADR-001 menetapkan platform admin **tidak** memiliki akses implisit ke data tenant, dan break-glass "harus dibentuk sebelum production" tanpa desain. Tanpa desain, dua risiko muncul:

1. superadmin tidak dapat membantu tenant saat ada masalah (support macet); atau
2. developer memberi superadmin akses penuh permanen melalui bypass RLS (kebocoran besar jika akun superadmin dibobol, dan sulit dipertanggungjawabkan saat platform berperan sebagai Prosesor data tenant — Data Protection SSOT v1.1 §2.1).

Product direction yang dipilih (2026-09-16): **superadmin ada dengan kewenangan platform penuh; akses ke data tenant melalui break-glass support session — tanpa approval orang kedua pada baseline.**

## 2. Decision

```text
Role                 : platform_superadmin (platform-global, bukan tenant role)
Platform powers      : penuh atas control-plane platform
Tenant data access   : TIDAK implisit
Support access       : break-glass support session
                       = pilih tenant + alasan + durasi terbatas + scope
Default scope        : READ_ONLY
Max duration         : 60 menit per sesi (tidak dapat diperpanjang; sesi baru = alasan baru)
Approval             : tidak diperlukan pada baseline (dapat dinaikkan via ADR baru)
Transparency         : tenant owner melihat event sesi support di audit tenant + notifikasi in-app
Impersonation        : DILARANG (tidak login sebagai user tenant)
DB enforcement       : RLS tetap aktif; READ_ONLY dipaksa SET TRANSACTION READ ONLY
```

### 2.1 Kewenangan superadmin (tanpa support session)

| Area | Permission | Catatan |
|---|---|---|
| Tenant registry | `platform.tenants.read`, `platform.tenants.create`, `platform.tenants.update_status` | Termasuk suspend/reactivate; purge mengikuti guard retention/legal hold |
| Domain & entitlement | `platform.tenant_domains.manage`, `platform.entitlements.manage` | Hanya tabel control-plane |
| Identitas global | `platform.identities.read_status`, `platform.identities.suspend`, `platform.identities.unlock` | Status akun saja; tidak membaca email/nama plaintext kecuali reveal teraudit untuk kasus akun yang dilaporkan |
| Admin platform | `platform.admins.read`, `platform.admins.manage` | Tidak dapat menghapus superadmin terakhir; tidak dapat mengubah assignment dirinya sendiri |
| Menu & reference data global | `platform.menus.manage`, `platform.reference_data.manage` | Baris `tenant_id IS NULL` saja (ADR-001 §3.8) |
| Audit platform | `platform.audit.read` | Event platform dan pre-context; bukan audit tenant |
| Permission catalog | `platform.permissions.read` | Katalog read-only; perubahan via migration |
| Support session | `platform.support.start_read`, `platform.support.start_write` | §2.2 |

Superadmin **tidak** dapat melalui jalur platform biasa:

- membaca/mengubah tabel tenant-owned (member profile, role tenant, domain record, file, audit tenant);
- membuat membership, undangan, atau role assignment di tenant;
- membaca credential, token, atau key material;
- login sebagai user lain (impersonation).

### 2.2 Break-glass support session

```text
Superadmin (MFA wajib sebelum production)
  -> POST /api/v1/platform/support-sessions
       { tenant_id, reason_code, reason_text, scope: READ_ONLY|READ_WRITE,
         duration_minutes <= 60, ticket_reference? }
  -> validasi: tenant ada (status apa pun kecuali PURGED), permission sesuai scope,
     reason_text minimal, tidak ada sesi aktif lain milik superadmin yang sama
  -> buat support_sessions row (ACTIVE)
  -> audit platform + audit tenant via audit_w.write_event (register F-14)
  -> notifikasi in-app ke tenant owner via audit_w.notify_tenant_security_event (F-15)
  -> terbitkan access token khusus:
       claims: context_kind=support, tenant_id, support_session_id, scope, exp
  -> setiap request dalam sesi:
       verify session ACTIVE & belum kedaluwarsa
       unit of work: set_config tenant + context_kind=support + support_session_id
       READ_ONLY -> SET TRANSACTION READ ONLY
       effective permissions = SUPPORT_READ_SET atau SUPPORT_WRITE_SET (bukan tenant_owner)
       audit per request: support_session_id, route, target, result
  -> berakhir: kedaluwarsa, POST /platform/support-sessions/:id/end, atau revoke
       -> audit support.session.ended (platform + tenant)
```

Aturan:

1. **Scope default READ_ONLY.** `READ_WRITE` memerlukan permission terpisah `platform.support.start_write` dan `reason_code` dari daftar yang mengizinkan perubahan (misalnya `DATA_CORRECTION_REQUESTED_BY_TENANT`).
2. **Permission set tetap.** `SUPPORT_READ_SET` = permission `*.read` tenant yang disetujui (tanpa `audit.export`, tanpa reveal DP-2). `SUPPORT_WRITE_SET` = `SUPPORT_READ_SET` + daftar mutasi yang disetujui. Keduanya didefinisikan di kode + test, bukan dapat diubah runtime.
3. **Masking default.** Field DP-1 ditampilkan masked. Reveal DP-1 per field memerlukan aksi eksplisit, alasan, dan audit. **Reveal DP-2 tidak tersedia** di support session baseline.
4. **Tidak ada perubahan keamanan tenant** dalam support session: tidak dapat mengubah role/permission, membership, undangan, domain, atau entitlement tenant (itu jalur platform §2.1 atau tindakan tenant owner).
5. **Durasi.** Maksimal 60 menit; tidak dapat diperpanjang; sesi baru membutuhkan alasan baru. Sesi otomatis berakhir bila tenant di-purge atau superadmin di-suspend.
6. **Satu sesi aktif per superadmin.**
7. **Transparansi.** Event `support.session.started`, `support.session.ended`, dan setiap mutasi `READ_WRITE` terlihat di audit tenant. Tenant owner menerima notifikasi in-app saat sesi dimulai.
8. **UI.** Banner permanen: "Mode support — Tenant <nama> — READ_ONLY — sisa <n> menit — Akhiri sesi". Tombol aksi yang tidak diizinkan tidak ditampilkan dan tetap ditolak backend.
9. **Rate & alerting.** Setiap sesi memicu security telemetry; jumlah sesi per superadmin per hari dimonitor.
10. **Status tenant (v1.1).** Support session boleh dibuka ke tenant berstatus `ACTIVE`, `SUSPENDED`, `CLOSING`, atau `ARCHIVED` — kebutuhan support justru sering muncul saat tenant disuspend. Untuk status selain `ACTIVE`, scope **dipaksa READ_ONLY**. Ini adalah pengecualian eksplisit terhadap verifikasi "tenant ACTIVE" pada request protected (Infrastructure SSOT v1.5 §8.6), berlaku hanya untuk context `support`. Tenant `PURGED` ditolak.

### 2.3 Enforcement di database

- Support session **tidak** memakai role bypass. Transaksi berjalan sebagai `app_user` dengan `app.current_tenant_id` = tenant sesi, sehingga RLS berlaku persis seperti request tenant biasa (tidak bisa menyentuh tenant lain).
- `READ_ONLY` diterapkan dengan `SET TRANSACTION READ ONLY` di awal unit of work sebagai lapisan kedua setelah permission set. **Batas (v1.1):** mekanisme ini diset oleh aplikasi dan hanya mencegah mutasi di dalam unit of work tersebut; tidak melindungi dari kode di luar wrapper atau aplikasi yang dikompromikan (ADR-001 v1.3 §3.10). Pengujian "ditolak di database" berarti terbukti pada jalur wrapper, bukan jaminan terhadap semua jalur.
- Audit per request dalam sesi ditulis dengan `support_session_id` dan `actor_type = PLATFORM_SUPPORT` melalui audit writer tenant context biasa.
- Event yang ditulis **dari context platform ke tenant** (started/ended/revoked) memakai fungsi `audit_w.write_event` (F-14); notifikasi memakai `audit_w.notify_tenant_security_event` (F-15). Policy `app_user` tidak diperluas.
- Validasi sesi (ACTIVE, belum kedaluwarsa, milik actor) dilakukan pada setiap request, bukan hanya saat token diterbitkan.

### 2.4 Entitas

```text
platform_role_assignments        (platform-global)
  id, user_id, role_code ('platform_superadmin'), granted_by, granted_at,
  revoked_at NULL, revoked_by NULL, reason
  UNIQUE (user_id, role_code) WHERE revoked_at IS NULL

support_sessions                 (tenant control-plane; tenant_id NOT NULL)
  id, tenant_id, superadmin_user_id, scope (READ_ONLY|READ_WRITE),
  reason_code, reason_text_ciphertext (DEK tenant), ticket_reference NULL,
  started_at, expires_at, ended_at NULL, end_reason NULL,
  status (ACTIVE|ENDED|EXPIRED|REVOKED)
  UNIQUE (superadmin_user_id) WHERE status = 'ACTIVE'
```

tenant_notifications             (tenant-owned; v1.1 — minimal in-app notice)
  id, tenant_id, type ('SUPPORT_SESSION_STARTED'|'SUPPORT_SESSION_ENDED'),
  ref_id (support_session_id), audience ('TENANT_SECURITY_READERS'),
  created_at, read_at NULL, read_by_membership_id NULL
  UNIQUE (tenant_id, id)

RLS `support_sessions`:

- context platform: baca semua, insert/update baris sesinya sendiri melalui service;
- context tenant: tenant owner/auditor dengan `audit.read` membaca baris `tenant_id = current` (tanpa `reason_text` raw bila policy menentukan masking);
- context support: baca baris sesi aktif sendiri saja.

`reason_text` dienkripsi karena dapat memuat detail kasus yang menyebut orang.

`tenant_notifications` (v1.1) adalah notifikasi in-app minimal untuk event keamanan tenant, bukan modul Notifications penuh (General Feature Base §12). Dibaca oleh member tenant yang memiliki `audit.read`; insert hanya melalui F-15; `read_at` dapat diperbarui oleh pembaca. Modul Notifications penuh tetap di luar scope demo.

### 2.5 Pengelolaan superadmin

- Superadmin pertama dibuat melalui **bootstrap command** di server (sekali, idempotent, teraudit), bukan melalui API publik atau seed production.
- Superadmin berikutnya ditambahkan oleh superadmin lain melalui `platform.admins.manage`; tidak dapat menambah/menghapus dirinya sendiri.
- Minimal **dua** superadmin aktif direkomendasikan untuk production; sistem menolak pencabutan superadmin terakhir.
- **MFA wajib** untuk superadmin sebelum production (MFA berada di luar scope demo; demo mencatatnya sebagai known limitation).
- Review daftar superadmin berkala (misalnya per kuartal) — nilai final Operations.
- Pemulihan saat seluruh akun superadmin hilang: prosedur offline di server (bootstrap command dengan akses host + dua orang saksi) — didokumentasikan di runbook, bukan fitur aplikasi.

### 2.6 Login, session, dan pemilihan context (baru v1.1)

v1.0 tidak mendefinisikan session untuk superadmin, padahal `sessions.tenant_id` wajib diisi dan superadmin tidak memiliki membership tenant. User multi-membership juga tidak memiliki status di antara "password terverifikasi" dan "tenant dipilih".

Keputusan:

```text
POST /auth/login (email, password)
  -> F-02 find_identity_for_login + verifikasi Argon2id di aplikasi + F-03
  -> F-04 list_login_contexts(user_id)
       contexts = membership aktif (TENANT) + PLATFORM bila has_platform_role
  -> jumlah context:
       0  -> respons generik gagal login (tidak membedakan) + audit via F-14
       1  -> F-07 create_session langsung pada context tersebut
       >1 -> F-05 create_selection_ticket (hash, TTL ≤ 5 menit, sekali pakai)
             respons: { selection_required: true, contexts: [...] } + ticket (cookie HttpOnly)
POST /auth/select-context (ticket, target_kind TENANT|PLATFORM, tenant_id?)
  -> F-06 consume_selection_ticket -> F-07 create_session
POST /me/context-switch (target)   (sudah login)
  -> verifikasi membership/role -> session baru, session lama dicabut (F-10)
```

Aturan:

1. `sessions` dan `refresh_tokens` memiliki `context_kind` (`TENANT` | `PLATFORM`) dengan `CHECK ((context_kind = 'TENANT') = (tenant_id IS NOT NULL))` (ADR-001 v1.3 §3.8).
2. Access token context `PLATFORM` hanya diterima route `/platform/*`; context `TENANT` hanya route tenant; token `support` hanya diterbitkan dari session `PLATFORM` yang aktif dan tidak dapat di-refresh.
3. Superadmin **boleh** juga menjadi member tenant biasa (misalnya tenant internal), tetapi context `TENANT` miliknya tidak membawa permission platform, dan context `PLATFORM` tidak membawa data tenant.
4. Tiket pemilihan tidak dapat dipakai untuk memanggil endpoint lain selain `GET /auth/contexts` dan `POST /auth/select-context`.
5. Mengakhiri session `PLATFORM` (logout/revoke) otomatis mengakhiri support session aktif milik superadmin tersebut.
6. `GET /me/tenants` digantikan `GET /me/contexts` yang mengembalikan membership aktif dan akses platform (bila ada).

## 3. Alternatives considered

| Alternative | Keputusan | Alasan |
|---|---|---|
| Superadmin akses penuh permanen (bypass RLS) | Ditolak | Satu akun bocor = seluruh data semua tenant bocor; bertentangan dengan ADR-001; sulit dipertanggungjawabkan sebagai Prosesor |
| Break-glass + approval orang kedua / tenant owner | Tidak dipilih untuk baseline | Paling aman, tetapi memperlambat support darurat dan membutuhkan minimal dua operator aktif; dapat diaktifkan untuk tenant/tier tertentu melalui ADR baru |
| Impersonation (login sebagai user tenant) | Ditolak | Audit mengaburkan siapa pelaku sebenarnya; berisiko menyalahgunakan permission user |
| Superadmin sebagai member di setiap tenant | Ditolak | Membuat akses implisit permanen dan mengacaukan data membership tenant |

## 4. Consequences

Positive:

- superadmin tetap berkuasa penuh atas platform dan dapat membantu tenant;
- akses ke data tenant selalu punya alasan, batas waktu, jejak audit, dan terlihat oleh tenant;
- dampak akun superadmin yang dibobol dibatasi oleh durasi, scope, masking, dan alerting;
- RLS tidak memiliki pengecualian baru.

Negative:

- support butuh satu langkah tambahan (buka sesi, tulis alasan);
- tanpa approval orang kedua, superadmin nakal tetap bisa membaca data tenant (terdeteksi setelah kejadian, bukan dicegah);
- banner, token khusus, dan permission set menambah kerja implementasi dan test;
- MFA menjadi prasyarat production.

## 5. Mandatory tests

- superadmin tanpa support session tidak dapat membaca tabel tenant-owned (API dan DB);
- support session hanya membuka satu tenant; tenant lain tetap ditolak RLS;
- `READ_ONLY` menolak mutasi di guard **dan** di database (`READ ONLY transaction`);
- sesi kedaluwarsa/di-revoke langsung ditolak pada request berikutnya;
- tidak dapat membuka dua sesi aktif; tidak dapat memperpanjang;
- support session tidak dapat mengubah role, membership, undangan, domain, entitlement tenant;
- reveal DP-2 tidak tersedia; reveal DP-1 teraudit;
- event started/ended terlihat di audit tenant dan notifikasi tenant owner terkirim;
- tenant role tidak dapat memperoleh permission `platform.*`;
- superadmin terakhir tidak dapat dicabut; superadmin tidak dapat mengubah assignment dirinya;
- bootstrap command idempotent dan teraudit;
- (v1.1) superadmin tanpa membership dapat login dan memperoleh session `PLATFORM`; session `PLATFORM` tidak terbaca dari context tenant;
- (v1.1) user dengan >1 context wajib memilih; tiket kedaluwarsa/dipakai ulang ditolak; tiket tidak dapat memanggil endpoint lain;
- (v1.1) token context `PLATFORM` ditolak di route tenant dan sebaliknya;
- (v1.1) support session ke tenant `SUSPENDED` hanya READ_ONLY; `PURGED` ditolak;
- (v1.1) logout session `PLATFORM` mengakhiri support session aktif;
- (v1.1) `tenant_notifications` hanya dapat di-insert via F-15 dan hanya dibaca member dengan `audit.read`.

## 6. Open decisions

- daftar final `reason_code` dan pemetaan ke scope;
- isi final `SUPPORT_READ_SET` dan `SUPPORT_WRITE_SET`;
- durasi maksimum (60 menit baseline) dan idle timeout sesi;
- apakah tenant tier tertentu mewajibkan approval tenant owner;
- mekanisme MFA superadmin (TOTP/WebAuthn) — terkait ADR MFA/SSO mendatang;
- kanal notifikasi selain in-app (email) setelah provider tersedia.

## 7. Approval

| Role | Decision | Date |
|---|---|---|
| Product Direction | Break-glass tanpa approval kedua dipilih | 2026-09-16 |
| Technical | Pending | — |
| Security/Privacy | Pending | — |
| Legal/DPO | Pending (dampak peran Prosesor) | — |

## 8. Change log

| Version | Date | Summary |
|---|---|---|
| 1.0 | 2026-09-16 | Initial superadmin role, platform permissions, break-glass support session, DB enforcement, superadmin lifecycle |
| 1.1 | 2026-09-16 | Login/session context PLATFORM + tiket pemilihan context; pengecualian status tenant untuk support; `tenant_notifications` minimal; audit/notifikasi lintas context via register F-14/F-15; batas kepercayaan READ ONLY |
