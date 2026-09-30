---
title: "ADR-001 — SaaS Multi-Tenancy Architecture"
adr_id: "ADR-001"
version: "1.3"
status: "Accepted as Product/Architecture Direction; v1.1–v1.3 Revisions Proposed; Implementation and Specialist Reviews Pending"
decision_date: "2026-09-16"
revision_date: "2026-09-16"
decision_owner: "<REQUESTER_PLACEHOLDER>"
technical_approver: "<TECHNICAL_APPROVER_PLACEHOLDER>"
security_privacy_approver: "<SECURITY_PRIVACY_APPROVER_PLACEHOLDER>"
operations_approver: "<OPERATIONS_APPROVER_PLACEHOLDER>"
supersedes: "ADR-001-SAAS-MULTI-TENANCY_v1.2.md"
related_adr:
  - "ADR-002-IDENTITY-MODEL_v1.1.md"
  - "ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.1.md"
related_ssot:
  - "INFRASTRUCTURE_SSOT_v1.5.md"
  - "GENERAL_FEATURE_BASE_SSOT_v1.4.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md"
  - "PRE_CONTEXT_FUNCTION_REGISTER_v1.0.md"
review_reference: "REVIEW_BASELINE_DOCS_v2_2026-09-16.md"
---

# ADR-001 — SaaS Multi-Tenancy Architecture v1.3

> **Perubahan v1.3 (Opsi A):** fungsi `SECURITY DEFINER` milik `app_auth_definer` memperoleh akses baris melalui **policy `TO app_auth_definer`** (bukan `BYPASSRLS`) — memperbaiki desain v1.1–v1.2 yang membuat fungsi pre-context selalu mendapat 0 baris; daftar fungsi dan policy dipindah ke `PRE_CONTEXT_FUNCTION_REGISTER_v1.0.md` sebagai sumber tunggal; jalur tulis audit/notifikasi lintas context (§3.8); session mixed-ownership untuk context platform (§3.1); batas kepercayaan GUC (§3.10, §6); kontrol 15–17.

> **Perubahan v1.2:** §3.5 merujuk ADR-003 (superadmin + break-glass support session); context kind `support` ditambahkan; kontrol wajib 14.

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
Pre-context path : Narrow SECURITY DEFINER functions + policy TO app_auth_definer (Opsi A; tanpa BYPASSRLS)
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
| Tenant-owned | `tenant_memberships`, `roles`, organization, files, task, domain record | `tenant_id NOT NULL`, tenant-safe constraints, RLS |
| Mixed-ownership | `menus`, `audit_logs`, `sessions`, `refresh_tokens` (baris `PLATFORM` tanpa `tenant_id`, v1.3) | `tenant_id` nullable **hanya** untuk baris platform; policy terpisah §3.8 |
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

Platform admin tidak memperoleh implicit tenant-data access. Tenant support access menggunakan permission khusus, explicit tenant selection, documented reason, bounded session, audit, dan approval/policy sesuai sensitivity. Desain superadmin dan break-glass support session ditetapkan pada **ADR-003**: superadmin memiliki kewenangan platform penuh, tetapi akses ke data tenant hanya melalui support session berbatas waktu (maks. 60 menit), beralasan, default READ_ONLY, teraudit, dan terlihat oleh tenant. Tidak ada role bypass RLS dan tidak ada impersonation.

Operasi platform (`/platform/*`) berjalan dengan context `app.context_kind = 'platform'` dan hanya dapat menyentuh tabel control-plane serta baris platform melalui policy §3.8. Context platform **tidak** membuka tenant-owned table.

Context kind yang sah (v1.2): `tenant` (request tenant biasa), `platform` (route `/platform/*`), `support` (support session ADR-003: `app.current_tenant_id` = tenant sesi, RLS berlaku normal, READ_ONLY dipaksa dengan `SET TRANSACTION READ ONLY`).

### 3.6 Lifecycle

```text
PROVISIONING -> ACTIVE -> SUSPENDED -> CLOSING -> ARCHIVED -> PURGED
                  ^           |
                  +-----------+  (authorized reactivation)
```

Provisioning idempotent membuat tenant, domain/slug, owner membership, role, settings, entitlement, dan audit record. Organization default dibuat hanya bila modul Organization aktif pada scope implementasi. Suspension memblokir access tanpa menghapus data. Purge memerlukan retention/legal-hold check, authorization, export/offboarding completion, dan purge evidence.

### 3.7 Pre-context access path (revisi v1.3 — Opsi A)

Beberapa operasi harus membaca atau menulis data sebelum tenant context terverifikasi (resolusi host, login, pemilihan context, refresh token, penerimaan undangan, audit login gagal) atau menulis lintas context (audit/notifikasi tenant dari context platform). Operasi tersebut **hanya** boleh melalui fungsi PostgreSQL `SECURITY DEFINER` yang terdaftar.

**Koreksi v1.3.** v1.1–v1.2 menetapkan fungsi dimiliki `app_auth_definer` tanpa `BYPASSRLS` dan tanpa policy khusus. Karena fungsi `SECURITY DEFINER` berjalan dengan hak pemilik fungsi dan RLS tetap berlaku pada role yang bukan pemilik tabel, seluruh fungsi tersebut akan mendapat 0 baris saat `app.current_tenant_id` kosong. Desain itu tidak dapat diimplementasikan.

**Keputusan (Opsi A):**

```text
app_auth_definer : NOLOGIN, NOBYPASSRLS, bukan pemilik tabel
                   -> akses baris HANYA dari policy "CREATE POLICY ... TO app_auth_definer"
                      per tabel & per operasi, dengan column-level grant
app_user         : EXECUTE pada fungsi terdaftar; tidak tercakup policy tersebut;
                   tidak dapat SET ROLE app_auth_definer
```

Contoh indikatif:

```sql
CREATE POLICY auth_definer_read_memberships ON tenant_memberships
  FOR SELECT TO app_auth_definer
  USING (status = 'ACTIVE');

GRANT SELECT (id, tenant_id, user_id, status, joined_at)
  ON tenant_memberships TO app_auth_definer;
```

**Sumber tunggal.** Daftar fungsi, policy `TO app_auth_definer`, kolom yang di-grant, dan test negatif ditetapkan di **`PRE_CONTEXT_FUNCTION_REGISTER_v1.0.md`**. ADR ini, Infrastructure SSOT, Demo Foundation, dan Sprint Plan tidak memuat daftar fungsi sendiri.

Aturan wajib:

1. Fungsi dimiliki `app_auth_definer` (bukan `app_owner`, bukan superuser); `REVOKE ALL FROM PUBLIC`; `app_user` hanya `EXECUTE`.
2. Setiap fungsi menetapkan `search_path` eksplisit; tidak ada dynamic SQL; parameter bertipe tetap.
3. Policy `TO app_auth_definer` dibuat per operasi (tidak memakai `FOR ALL`) dan hanya untuk tabel/kolom yang tercantum di register.
4. Output minimum; tidak ada plaintext/ciphertext personal kecuali dicantumkan di register beserta alasan.
5. Tidak ada fungsi yang menerima `tenant_id` dari client lalu mengembalikan data tenant-owned tanpa bukti kepemilikan (hash token, user_id terverifikasi, atau membership aktif).
6. Rate limit dan audit berlaku di lapisan aplikasi di atas fungsi.
7. Schema inspection test di CI membandingkan database aktual dengan register (fungsi, policy, grant kolom, `pg_auth_members`, `rolbypassrls`).
8. Penambahan/perubahan entri register memerlukan review Security dan kenaikan versi register sebelum migration.

Dilarang: `BYPASSRLS` pada role apa pun yang dipakai atau dimiliki aplikasi (termasuk `app_auth_definer`), koneksi `app_owner` dari runtime, mematikan `FORCE`, klausa policy yang membuka akses saat context kosong untuk `app_user`, dan membuat `app_user` member dari `app_auth_definer`.

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

`audit_logs`: tenant hanya membaca baris `tenant_id = current`; baris platform hanya dibaca pada context platform dengan permission audit platform; `UPDATE`/`DELETE` di-`REVOKE` dari role runtime.

**Jalur tulis lintas context (v1.3).** Event yang harus tercatat di tenant lain dari context yang berbeda — misalnya `support.session.started` ditulis dari context platform ke audit tenant, atau `auth.login.failed` sebelum context — **tidak** memakai policy `app_user`. Event tersebut ditulis melalui fungsi audit writer dan notifikasi terdaftar (register F-14, F-15) dengan allowlist `action`/`type` dan validasi metadata.

**Session (v1.3).** `sessions` dan `refresh_tokens` memiliki kolom `context_kind` (`TENANT` | `PLATFORM`). Baris `TENANT` wajib `tenant_id NOT NULL` dan tercakup policy tenant; baris `PLATFORM` memiliki `tenant_id IS NULL` dan hanya dibaca/ditulis melalui fungsi register. Constraint: `CHECK ((context_kind = 'TENANT') = (tenant_id IS NOT NULL))`. Detail alur di ADR-003 v1.1 §2.6.

`app.context_kind` ditetapkan server-side oleh guard route (tenant/platform/support) di dalam unit-of-work wrapper, transaction-local, dan tidak dapat dipengaruhi input client. Pola SQL di atas bersifat indikatif; implementasi final wajib ditinjau Security. Batas kepercayaan mekanisme ini dijelaskan di §3.10.

### 3.9 ORM transaction pattern (baru v1.1)

- Prisma tidak merepresentasikan policy RLS, `FORCE`, function, dan grant di schema model. Objek tersebut ditulis sebagai SQL di dalam migration terversi dan diverifikasi oleh schema inspection test.
- Satu **unit of work = satu interactive transaction**; statement pertama selalu `set_config('app.current_tenant_id', <verified>, true)` (dan `app.context_kind` bila perlu).
- Query tenant-owned di luar unit-of-work wrapper dilarang dan dideteksi lewat test/lint.
- Nested transaction tidak digunakan; service yang sudah berada dalam unit of work menerima transaction client.
- Timeout transaksi ditetapkan eksplisit dan diuji.
- Pola ini wajib dibuktikan oleh spike terukur (Sprint Plan DEMO-0100) sebelum domain table dibuat, termasuk bukti bahwa fungsi `SECURITY DEFINER` membaca baris lintas tenant melalui policy `TO app_auth_definer` sementara `app_user` tetap mendapat 0 baris. Jika spike gagal, keputusan kembali ke ADR (bukan diselesaikan di code).

### 3.10 Batas kepercayaan tenant context (baru v1.3)

`app.current_tenant_id`, `app.context_kind`, dan `SET TRANSACTION READ ONLY` ditetapkan oleh **aplikasi** melalui koneksi `app_user`. Konsekuensinya:

| Ancaman | Dilindungi RLS/GUC? |
|---|---|
| Bug repository lupa filter `tenant_id` | **Ya** — RLS menolak baris tenant lain |
| Raw query baru tanpa filter | **Ya**, selama melewati unit-of-work wrapper |
| Kode yang sengaja/keliru memanggil `set_config` dengan tenant lain atau `context_kind = 'platform'` | **Tidak** |
| SQL injection yang dapat menjalankan statement arbitrer | **Tidak** (dapat mengubah GUC atau membuka transaksi baru) |
| Kredensial `app_user` bocor | **Tidak** |

RLS berbasis GUC adalah **pertahanan terhadap bug aplikasi**, bukan terhadap aplikasi yang sudah dikompromikan. `SET TRANSACTION READ ONLY` pada support session hanya mencegah mutasi di dalam unit of work tersebut; kode di luar wrapper dapat membuka transaksi read-write.

Mitigasi wajib:

- `set_config('app.` hanya boleh muncul di modul unit-of-work; lint/test CI menolak kemunculan di tempat lain;
- seluruh query parameterized; raw SQL string concatenation dilarang (lint);
- `app_user` tanpa `CREATE`, `TRUNCATE`, `ALTER`, `REFERENCES` pada schema aplikasi;
- telemetry: query ke tabel tenant-owned di luar wrapper dan perubahan `context_kind` ke `platform` dari route non-platform memicu alert;
- threat model mencatat batas ini secara eksplisit.

Opsi penguatan (belum baseline, memerlukan ADR): verifikasi signed context claim di database, atau pemisahan koneksi/role untuk context platform.

## 4. Alternatives considered

### 4.1 Database per tenant

Tidak dipilih sebagai baseline karena meningkatkan provisioning, migration orchestration, connection management, monitoring, backup, dan operational cost. Model ini dapat dipertimbangkan untuk regulated/premium isolation tier melalui ADR baru, termasuk desain portability tenant.

### 4.2 Schema per tenant

Tidak dipilih karena schema proliferation, migration complexity, connection/search-path risk, dan tooling overhead meningkat seiring tenant count.

### 4.3 Shared schema without RLS

Ditolak. Application filter saja terlalu mudah terlewat pada raw query, new repository, maintenance path, atau refactor.

### 4.4 Organization as tenant

Ditolak. Organization adalah business hierarchy; tenant adalah isolation dan lifecycle boundary.

### 4.5 Pre-context via role runtime dengan `BYPASSRLS`

Ditolak. Role bypass memberikan akses baca seluruh tabel tenant ke seluruh code path yang memakai koneksi tersebut.

### 4.6 Opsi B — `app_auth_definer` NOLOGIN dengan `BYPASSRLS` (dievaluasi v1.3)

Tidak dipilih. Lebih sederhana (tanpa policy per tabel), tetapi setiap fungsi definer — termasuk fungsi yang kelak ditulis ceroboh — dapat membaca **seluruh** baris dan kolom semua tabel. Opsi A membatasi akses fungsi ke tabel, operasi, dan kolom yang terdaftar, sehingga kesalahan satu fungsi tidak otomatis membuka tabel lain. Biaya Opsi A: policy dan grant kolom harus dijaga sinkron dengan register (dimitigasi schema inspection test).

### 4.7 Pre-context via role login kedua `app_auth` dengan pool terpisah

Tidak dipilih. Menambah pool koneksi kedua dan tetap memerlukan policy per tabel; tidak memberi keuntungan isolasi dibanding Opsi A.

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
- `SECURITY DEFINER` function dan policy `TO app_auth_definer` adalah permukaan serangan baru dan wajib direview serta disinkronkan dengan register;
- RLS berbasis GUC tidak melindungi dari aplikasi yang sudah dikompromikan (§3.10);
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
14. **(v1.2)** Test ADR-003 §5 lulus: superadmin tanpa support session tidak membaca tenant-owned table; support session terbatas satu tenant, durasi, dan scope; MFA superadmin aktif sebelum production.
15. **(v1.3)** Register test CI (`PRE_CONTEXT_FUNCTION_REGISTER` §5) lulus: fungsi membaca lintas tenant via policy `TO app_auth_definer`, `app_user` tetap 0 baris, tidak ada role runtime/auth dengan `BYPASSRLS`, tidak ada fungsi/policy di luar register.
16. **(v1.3)** Lint `set_config('app.` di luar unit-of-work dan raw SQL concatenation berjalan di CI.
17. **(v1.3)** Session `PLATFORM` dan `TENANT` terpisah dengan constraint; tenant tidak dapat membaca session platform.

## 8. Implementation sequence

```text
0. ORM + RLS + pool-reuse spike (go/no-go)
1. Tenant schema and lifecycle
2. Database runtime-role separation (app_owner / app_auth_definer / app_user)
3. Pre-context function register, functions, and policies TO app_auth_definer
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
- `PRE_CONTEXT_FUNCTION_REGISTER` dan hasil schema inspection + test negatifnya;
- API and repository negative tests;
- connection-pool reuse test;
- object-storage/search/cache/job isolation test;
- provisioning lifecycle test report;
- threat model and security review;
- backup/restore rehearsal record;
- OpenAPI and operational runbook;
- traceable commit/release identifier.

## 10. Approval boundary

Keputusan untuk menggunakan SaaS multi-tenancy telah diadopsi sebagai product/architecture direction pada 2026-09-16. Revisi v1.1–v1.3 berstatus **Proposed** sampai disetujui Technical dan Security/Privacy. Keputusan ini **tidak** dengan sendirinya membuktikan correctness implementasi, security/privacy approval, operational readiness, regulatory compliance, atau production acceptance.

| Role | Decision | Date |
|---|---|---|
| Product/Architecture Direction | Adopted (v1.0); v1.1–v1.3 proposed; Opsi A dipilih (v1.3) | 2026-09-16 |
| Technical | Pending | — |
| Security/Privacy | Pending | — |
| Operations | Pending | — |

## 11. Change log

| Version | Date | Summary | Approval |
|---|---|---|---|
| 1.0 | 2026-09-16 | Initial multi-tenancy decision | Product/architecture direction adopted |
| 1.1 | 2026-09-16 | Pre-context SECURITY DEFINER path, mixed-ownership policy, ORM transaction pattern, reactivation path, kontrol 11–13, sequence dengan spike; referensi ke ADR-002 dan SSOT versi terbaru | Proposed; Technical/Security pending |
| 1.2 | 2026-09-16 | Rujukan ADR-003 superadmin & break-glass; context kind `support`; kontrol 14 | Proposed |
| 1.3 | 2026-09-16 | Opsi A: policy `TO app_auth_definer` (koreksi fungsi definer kena RLS); register sebagai sumber tunggal; jalur tulis lintas context; session mixed-ownership; batas kepercayaan GUC; kontrol 15–17 | Proposed |
