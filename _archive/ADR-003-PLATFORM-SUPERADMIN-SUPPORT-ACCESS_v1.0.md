---
title: "ADR-003 — Platform Superadmin and Break-Glass Support Access"
adr_id: "ADR-003"
version: "1.0"
status: "SUPERSEDED"
original_status: "Proposed; Product Direction Chosen (break-glass); Technical and Security/Privacy Review Pending"
superseded_by: "ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.1.md"
superseded_date: "2026-09-16"
decision_date: "2026-09-16"
decision_owner: "<REQUESTER_PLACEHOLDER>"
technical_approver: "<TECHNICAL_APPROVER_PLACEHOLDER>"
security_privacy_approver: "<SECURITY_PRIVACY_APPROVER_PLACEHOLDER>"
supersedes: null
related_adr:
  - "ADR-001-SAAS-MULTI-TENANCY_v1.2.md"
  - "ADR-002-IDENTITY-MODEL_v1.0.md"
related_ssot:
  - "INFRASTRUCTURE_SSOT_v1.4.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md"
  - "SAAS_DEMO_FOUNDATION_SSOT_v1.2.md"
---

> ⚠️ **SUPERSEDED — ARSIP, BUKAN DOKUMEN AKTIF.**
> Versi berlaku: [`ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.1.md`](./ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.1.md). Lihat `DOCUMENT_VERSION_INDEX.md`.
> Isi dan referensi versi di bawah bersifat historis dan **tidak boleh** dijadikan dasar implementasi, ticket, atau review.

# ADR-003 — Platform Superadmin and Break-Glass Support Access v1.0

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
  -> buat support_sessions row (ACTIVE) + audit platform + audit tenant
  -> notifikasi in-app ke tenant owner (dan kontak keamanan tenant bila ada)
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

### 2.3 Enforcement di database

- Support session **tidak** memakai role bypass. Transaksi berjalan sebagai `app_user` dengan `app.current_tenant_id` = tenant sesi, sehingga RLS berlaku persis seperti request tenant biasa (tidak bisa menyentuh tenant lain).
- `READ_ONLY` ditegakkan dengan `SET TRANSACTION READ ONLY` di awal unit of work (lapisan kedua setelah permission set).
- Audit writer menambahkan `support_session_id` dan `actor_type = PLATFORM_SUPPORT`.
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

RLS `support_sessions`:

- context platform: baca semua, insert/update baris sesinya sendiri melalui service;
- context tenant: tenant owner/auditor dengan `audit.read` membaca baris `tenant_id = current` (tanpa `reason_text` raw bila policy menentukan masking);
- context support: baca baris sesi aktif sendiri saja.

`reason_text` dienkripsi karena dapat memuat detail kasus yang menyebut orang.

### 2.5 Pengelolaan superadmin

- Superadmin pertama dibuat melalui **bootstrap command** di server (sekali, idempotent, teraudit), bukan melalui API publik atau seed production.
- Superadmin berikutnya ditambahkan oleh superadmin lain melalui `platform.admins.manage`; tidak dapat menambah/menghapus dirinya sendiri.
- Minimal **dua** superadmin aktif direkomendasikan untuk production; sistem menolak pencabutan superadmin terakhir.
- **MFA wajib** untuk superadmin sebelum production (MFA berada di luar scope demo; demo mencatatnya sebagai known limitation).
- Review daftar superadmin berkala (misalnya per kuartal) — nilai final Operations.
- Pemulihan saat seluruh akun superadmin hilang: prosedur offline di server (bootstrap command dengan akses host + dua orang saksi) — didokumentasikan di runbook, bukan fitur aplikasi.

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
- bootstrap command idempotent dan teraudit.

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
