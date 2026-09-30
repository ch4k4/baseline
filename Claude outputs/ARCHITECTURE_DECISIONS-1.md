---
title: "Architecture Decision Records — SaaS Multi-Tenant Baseline"
document_id: "ARCHITECTURE-DECISIONS"
edition: "2.10 (consolidated final)"
status: "Consolidated Baseline — Proposed; Technical, Security/Privacy, Operations, dan Legal/DPO approval pending"
last_updated: "2026-09-29"
contains:
  - "ADR-001 SaaS Multi-Tenancy Architecture"
  - "ADR-002 Identity Model"
  - "ADR-003 Platform Superadmin and Break-Glass Support Access"
  - "Lampiran A — Pre-context & Cross-context Database Access Register"
related_documents:
  - "README.md"
  - "INFRASTRUCTURE_SSOT.md"
  - "GENERAL_FEATURE_BASE_SSOT.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT.md"
  - "SAAS_DEMO_FOUNDATION_SSOT.md"
  - "SAAS_DEMO_SPRINT_PLAN.md"
supersedes_archive: "_archive/ (ADR-001 v1.0–v1.3, ADR-002 v1.0–v1.1, ADR-003 v1.0–v1.1, PRE_CONTEXT_FUNCTION_REGISTER v1.0)"
---

# Architecture Decision Records — SaaS Multi-Tenant Baseline

Dokumen ini menggabungkan seluruh keputusan arsitektur yang berlaku. Edisi 2.0 adalah edisi bersih hasil konsolidasi; riwayat revisi dan temuan review diringkas di `README.md` §5–§6, dan versi lengkap sebelumnya disimpan di `_archive/`.

**Cara membaca rujukan:**

- "ADR-001 §3.7" merujuk bagian 3.7 pada ADR-001 di dokumen ini.
- Rujukan § tanpa awalan di dalam sebuah ADR merujuk bagian ADR yang sama.
- "Lampiran A F-07" merujuk fungsi F-07 pada register di Lampiran A. Lampiran A adalah **satu-satunya** daftar resmi fungsi `SECURITY DEFINER` dan policy `TO app_auth_definer`.

| Bagian | Isi |
|---|---|
| ADR-001 | Shared schema + `tenant_id` + RLS, pre-context access (Opsi A), mixed-ownership rows, pola ORM, batas kepercayaan GUC |
| ADR-002 | Identitas global, onboarding via undangan, profil dan contact email per tenant, kunci enkripsi identitas |
| ADR-003 | Superadmin platform, login context PLATFORM, break-glass support session, notifikasi keamanan tenant |
| Lampiran A | Register fungsi dan policy akses database sebelum/lintas tenant context, beserta test CI |

## ADR-001 — SaaS Multi-Tenancy Architecture

### 1. Context

Platform akan digunakan sebagai SaaS lintas industri dan melayani beberapa customer independen dalam satu platform. Setiap customer memerlukan isolation boundary untuk data, identity membership, configuration, entitlement, file, integration, background processing, reporting, dan audit.

Model awal hanya mendukung organisasi sebagai struktur bisnis. Organization tidak cukup sebagai tenant boundary karena satu tenant dapat mempunyai lebih dari satu organization dan platform operation dapat berada di luar organization.

Review 2026-09-16 menemukan bahwa desain awal mewajibkan RLS fail-closed pada tabel yang harus dibaca **sebelum** tenant diketahui (resolusi domain, login, refresh token, audit login gagal). Tanpa jalur terkontrol, implementasi akan macet atau menambal dengan bypass RLS yang tidak aman.

### 2. Decision

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

### 3. Decision details

#### 3.1 Data classification by ownership

Setiap table harus diklasifikasikan sebelum migration:

| Class | Contoh | Requirement |
|---|---|---|
| Platform-global | `permissions`, platform roles, system registry, `users` (identitas global, lihat ADR-002) | Tidak memiliki `tenant_id`; akses hanya lewat service/function yang ditetapkan |
| Tenant control-plane | `tenants`, `tenant_domains`, `tenant_entitlements` | Explicit access policy; baris beridentitas tenant; pembacaan pre-context hanya lewat §3.7 |
| Tenant-owned | `tenant_memberships`, `roles`, organization, files, task, domain record | `tenant_id NOT NULL`, tenant-safe constraints, RLS |
| Mixed-ownership | `menus`, `audit_logs`, `sessions`, `refresh_tokens` (baris `PLATFORM` tanpa `tenant_id`) | `tenant_id` nullable **hanya** untuk baris platform; policy terpisah §3.8 |
| Operational | outbox, job, webhook delivery, export | Tenant-owned bila berasal dari tenant; tenant context wajib |

Global table dan mixed-ownership table harus terdaftar eksplisit dalam **Table Ownership Register** (Infrastructure SSOT §8.3). Table tanpa `tenant_id` tidak boleh muncul karena kelalaian.

#### 3.2 Tenant resolution

Tenant aktif ditentukan server-side dari verified domain/selector, authenticated session, dan active tenant membership. Client-supplied `tenant_id` pada body/query/header tidak dipercaya sebagai authority.

Tenant switch hanya dapat dilakukan terhadap active membership dan menghasilkan token/session context baru. Tenant status dan membership diverifikasi kembali pada protected request sesuai session strategy. Biaya query verifikasi per request diterima secara sadar; access token tidak diperlakukan sebagai sepenuhnya stateless.

#### 3.3 Database enforcement

- Runtime account (`app_user`) bukan owner, bukan superuser, dan tanpa `BYPASSRLS`.
- Tenant-owned table memakai `ENABLE ROW LEVEL SECURITY` serta `FORCE ROW LEVEL SECURITY`.
- Backend menetapkan tenant context transaction-local dengan `set_config(..., true)`/`SET LOCAL` sebelum query.
- RLS policy menggunakan current tenant context untuk `USING` dan `WITH CHECK`.
- Application repository tetap memfilter tenant; RLS menjadi lapisan kedua.
- Unique constraint, foreign key, dan index tenant-owned memasukkan tenant scope.
- Composite foreign key digunakan bila diperlukan untuk menolak relasi lintas tenant.
- Connection pooling test wajib membuktikan context tidak bocor antar request.
- Policy RLS, `FORCE`, function, dan grant dikelola sebagai SQL migration terversi (lihat §3.9).

#### 3.4 Non-database enforcement

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

#### 3.5 Platform and support access

Platform admin tidak memperoleh implicit tenant-data access. Tenant support access menggunakan permission khusus, explicit tenant selection, documented reason, bounded session, audit, dan approval/policy sesuai sensitivity. Desain superadmin dan break-glass support session ditetapkan pada **ADR-003**: superadmin memiliki kewenangan platform penuh, tetapi akses ke data tenant hanya melalui support session berbatas waktu (maks. 60 menit), beralasan, default READ_ONLY, teraudit, dan terlihat oleh tenant. Tidak ada role bypass RLS dan tidak ada impersonation.

Operasi platform (`/platform/*`) berjalan dengan context `app.context_kind = 'platform'` dan hanya dapat menyentuh tabel control-plane serta baris platform melalui policy §3.8. Context platform **tidak** membuka tenant-owned table.

Context kind yang sah: `tenant` (request tenant biasa), `platform` (route `/platform/*`), `support` (support session ADR-003: `app.current_tenant_id` = tenant sesi, RLS berlaku normal, READ_ONLY dipaksa dengan `SET TRANSACTION READ ONLY`).

#### 3.6 Lifecycle

```text
PROVISIONING -> ACTIVE -> SUSPENDED -> CLOSING -> ARCHIVED -> PURGED
                  ^           |
                  +-----------+  (authorized reactivation)
```

Provisioning idempotent membuat tenant, domain/slug, owner membership, role, settings, entitlement, dan audit record. Organization default dibuat hanya bila modul Organization aktif pada scope implementasi. Suspension memblokir access tanpa menghapus data. Purge memerlukan retention/legal-hold check, authorization, export/offboarding completion, dan purge evidence.

#### 3.7 Pre-context access path

Beberapa operasi harus membaca atau menulis data sebelum tenant context terverifikasi (resolusi host, login, pemilihan context, refresh token, penerimaan undangan, audit login gagal) atau menulis lintas context (audit/notifikasi tenant dari context platform). Operasi tersebut **hanya** boleh melalui fungsi PostgreSQL `SECURITY DEFINER` yang terdaftar.

Catatan desain: fungsi `SECURITY DEFINER` berjalan dengan hak pemilik fungsi, dan RLS tetap berlaku pada role yang bukan pemilik tabel dan tidak memiliki `BYPASSRLS`. Tanpa policy khusus, fungsi pre-context akan selalu mendapat 0 baris saat `app.current_tenant_id` kosong. Karena itu akses baris diberikan secara eksplisit (Opsi A).

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

**Sumber tunggal.** Daftar fungsi, policy `TO app_auth_definer`, kolom yang di-grant, dan test negatif ditetapkan di **Lampiran A**. ADR ini, Infrastructure SSOT, Demo Foundation, dan Sprint Plan tidak memuat daftar fungsi sendiri.

Aturan wajib:

1. Fungsi dimiliki `app_auth_definer` (bukan `app_owner`, bukan superuser); `REVOKE ALL FROM PUBLIC`; `app_user` hanya `EXECUTE`.
2. Setiap fungsi menetapkan `search_path` eksplisit; tidak ada dynamic SQL; parameter bertipe tetap.
3. Policy `TO app_auth_definer` dibuat per operasi (tidak memakai `FOR ALL`) dan hanya untuk tabel/kolom yang tercantum di register.
4. Output minimum; tidak ada plaintext/ciphertext personal kecuali dicantumkan di register beserta alasan.
5. Tidak ada fungsi yang menerima `tenant_id` dari client lalu mengembalikan data tenant-owned tanpa bukti kepemilikan (hash token, user_id terverifikasi, atau membership aktif).
6. Rate limit dan audit berlaku di lapisan aplikasi di atas fungsi.
7. Schema inspection test di CI membandingkan database aktual dengan register (fungsi, policy, grant kolom, `pg_auth_members`, `rolbypassrls`).
8. Penambahan/perubahan entri register memerlukan review Security dan pembaruan Lampiran A (dicatat di bagian Riwayat) sebelum migration.

Dilarang: `BYPASSRLS` pada role apa pun yang dipakai atau dimiliki aplikasi (termasuk `app_auth_definer`), koneksi `app_owner` dari runtime, mematikan `FORCE`, klausa policy yang membuka akses saat context kosong untuk `app_user`, dan membuat `app_user` member dari `app_auth_definer`.

#### 3.8 Mixed-ownership rows

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

**Jalur tulis lintas context.** Event yang harus tercatat di tenant lain dari context yang berbeda — misalnya `support.session.started` ditulis dari context platform ke audit tenant, atau `auth.login` dengan outcome `FAILURE` sebelum context — **tidak** memakai policy `app_user`. Event tersebut ditulis melalui fungsi audit writer dan notifikasi terdaftar (Lampiran A F-14, F-15) dengan validasi metadata; allowlist nama event ditegakkan katalog `audit_event_types` beserta foreign key dari `audit_logs`, sehingga berlaku untuk setiap penulis.

**Session.** `sessions` dan `refresh_tokens` memiliki kolom `context_kind` (`TENANT` | `PLATFORM`). Baris `TENANT` wajib `tenant_id NOT NULL` dan tercakup policy tenant; baris `PLATFORM` memiliki `tenant_id IS NULL` dan hanya dibaca/ditulis melalui fungsi register. Constraint: `CHECK ((context_kind = 'TENANT') = (tenant_id IS NOT NULL))`. Detail alur di ADR-003 §2.6.

`app.context_kind` ditetapkan server-side oleh guard route (tenant/platform/support) di dalam unit-of-work wrapper, transaction-local, dan tidak dapat dipengaruhi input client. Pola SQL di atas bersifat indikatif; implementasi final wajib ditinjau Security. Batas kepercayaan mekanisme ini dijelaskan di §3.10.

#### 3.9 ORM transaction pattern

- Prisma tidak merepresentasikan policy RLS, `FORCE`, function, dan grant di schema model. Objek tersebut ditulis sebagai SQL di dalam migration terversi dan diverifikasi oleh schema inspection test.
- Satu **unit of work = satu interactive transaction**; statement pertama selalu `set_config('app.current_tenant_id', <verified>, true)` (dan `app.context_kind` bila perlu).
- Query tenant-owned di luar unit-of-work wrapper dilarang dan dideteksi lewat test/lint.
- Nested transaction tidak digunakan; service yang sudah berada dalam unit of work menerima transaction client.
- Timeout transaksi ditetapkan eksplisit dan diuji.
- Pola ini wajib dibuktikan oleh spike terukur (Sprint Plan DEMO-0100) sebelum domain table dibuat, termasuk bukti bahwa fungsi `SECURITY DEFINER` membaca baris lintas tenant melalui policy `TO app_auth_definer` sementara `app_user` tetap mendapat 0 baris. Jika spike gagal, keputusan kembali ke ADR (bukan diselesaikan di code).

#### 3.10 Batas kepercayaan tenant context

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

#### 3.11 Baseline sebagai skema yang dipasang (multiproduk)

Keputusan pemilik proyek 2026-09-28: baseline ini bukan satu aplikasi, melainkan **fondasi
untuk beberapa produk, masing-masing dengan databasenya sendiri**. Baseline dipasang ke
database tiap produk sebagai skema + paket; produk menambahkan migrasi, permission, dan
menunya sendiri di atasnya.

Yang berubah karena keputusan ini:

1. **Migrasi wajib punya ledger.** Sampai 2026-09-28 satu-satunya cara memasang perubahan
   skema adalah `reset` - hapus database, bangun dari nol. Untuk database produk yang berisi
   data itu berarti baseline tidak dapat dinaikkan versinya sama sekali di tempat ia dipakai.
   Ledger `schema_migrations` (migrasi 0001b) memuat kolom `component`, sehingga migrasi
   baseline dan migrasi produk hidup berdampingan dengan urutan nomor masing-masing;
   checksum setiap berkas yang sudah dipasang diperiksa, karena dua database yang mengaku
   berada di versi sama padahal isinya berbeda adalah cacat yang paling sulit dilacak.
   Rincian operasional: Infrastructure SSOT §8.4.
2. **Test register harus dapat dijalankan terhadap database produk.** `api/test/register.test.ts`
   karena itu tidak membaca dokumen normatif dan tidak bergantung pada data seed: ia
   membandingkan database aktual dengan `db/register.json`. Pemasangan baseline di produk baru
   dinyatakan sah hanya bila test itu lulus di sana.
3. **Isolasi tenant tetap satu model, tetapi batas produk BUKAN batas tenant.** Satu produk
   tetap multi-tenant dengan RLS seperti ADR ini menetapkan. Database per produk tidak
   menggantikan `tenant_id`, dan bukan pengganti §3.3.

Yang **belum** diputuskan dan tidak boleh terbentuk diam-diam oleh kode (open decision):

- **identitas lintas produk.** Satu orang yang memakai dua produk: satu identitas bersama
  (butuh identity provider terpisah, dan ADR-002 §2.1 tidak lagi cukup) atau identitas per
  produk (login berbeda per produk)? Ini keputusan terbesar yang tersisa;
- **audit lintas produk** dan pelaporan gabungan;
- **namespace permission per komponen** (`hr.*`, `pos.*`) beserta aturan siapa yang boleh
  menambah entri katalog - hari ini katalog `permissions` hanya dapat diubah migrasi baseline;
- **entitlement modul per tenant**: permission `platform.entitlements.manage` ada di katalog
  sejak slice 10, dan tidak ada apa pun di belakangnya;
- **cara baseline didistribusikan** (paket npm, submodule, salinan) dan bagaimana produk
  mengetahui versi baseline yang dipasangnya.

### 4. Alternatives considered

#### 4.1 Database per tenant

Tidak dipilih sebagai baseline karena meningkatkan provisioning, migration orchestration, connection management, monitoring, backup, dan operational cost. Model ini dapat dipertimbangkan untuk regulated/premium isolation tier melalui ADR baru, termasuk desain portability tenant.

#### 4.2 Schema per tenant

Tidak dipilih karena schema proliferation, migration complexity, connection/search-path risk, dan tooling overhead meningkat seiring tenant count.

#### 4.3 Shared schema without RLS

Ditolak. Application filter saja terlalu mudah terlewat pada raw query, new repository, maintenance path, atau refactor.

#### 4.4 Organization as tenant

Ditolak. Organization adalah business hierarchy; tenant adalah isolation dan lifecycle boundary.

#### 4.5 Pre-context via role runtime dengan `BYPASSRLS`

Ditolak. Role bypass memberikan akses baca seluruh tabel tenant ke seluruh code path yang memakai koneksi tersebut.

#### 4.6 Opsi B — `app_auth_definer` NOLOGIN dengan `BYPASSRLS` (dievaluasi)

Tidak dipilih. Lebih sederhana (tanpa policy per tabel), tetapi setiap fungsi definer — termasuk fungsi yang kelak ditulis ceroboh — dapat membaca **seluruh** baris dan kolom semua tabel. Opsi A membatasi akses fungsi ke tabel, operasi, dan kolom yang terdaftar, sehingga kesalahan satu fungsi tidak otomatis membuka tabel lain. Biaya Opsi A: policy dan grant kolom harus dijaga sinkron dengan register (dimitigasi schema inspection test).

#### 4.7 Pre-context via role login kedua `app_auth` dengan pool terpisah

Tidak dipilih. Menambah pool koneksi kedua dan tetap memerlukan policy per tabel; tidak memberi keuntungan isolasi dibanding Opsi A.

### 5. Positive consequences

- onboarding tenant tidak memerlukan database/schema baru;
- migration dan observability lebih sederhana dibanding database-per-tenant;
- resource utilization lebih efisien;
- shared feature dapat digunakan konsisten lintas industri;
- RLS dan tenant-safe constraint mengurangi risiko query lintas tenant;
- satu user dapat memiliki membership pada beberapa tenant secara eksplisit;
- jalur pre-context kecil, dapat direview, dan dapat diuji secara negatif.

### 6. Negative consequences and risks

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

### 7. Mandatory controls before production

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
11. Pre-context Function Register lengkap; setiap function memiliki test negatif (enumeration, wrong hash, suspended tenant, cross-tenant token).
12. Mixed-ownership policy test: tenant tidak dapat menulis baris platform; context platform tidak dapat membaca tenant-owned table.
13. Schema inspection test membuktikan migration SQL untuk RLS/function/grant sesuai database aktual (tidak ada drift).
14. Test ADR-003 §5 lulus: superadmin tanpa support session tidak membaca tenant-owned table; support session terbatas satu tenant, durasi, dan scope; MFA superadmin aktif sebelum production.
15. Register test CI (Lampiran A §5) lulus: fungsi membaca lintas tenant via policy `TO app_auth_definer`, `app_user` tetap 0 baris, tidak ada role runtime/auth dengan `BYPASSRLS`, tidak ada fungsi/policy di luar register.
16. Lint `set_config('app.` di luar unit-of-work dan raw SQL concatenation berjalan di CI.
17. Session `PLATFORM` dan `TENANT` terpisah dengan constraint; tenant tidak dapat membaca session platform.

### 8. Implementation sequence

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

### 9. Validation evidence required

- schema/migration diff;
- database role, grant, function ownership, dan RLS inspection output;
- Lampiran A dan hasil schema inspection + test negatifnya;
- API and repository negative tests;
- connection-pool reuse test;
- object-storage/search/cache/job isolation test;
- provisioning lifecycle test report;
- threat model and security review;
- backup/restore rehearsal record;
- OpenAPI and operational runbook;
- traceable commit/release identifier.

### 10. Approval boundary

Keputusan untuk menggunakan SaaS multi-tenancy telah diadopsi sebagai product/architecture direction pada 2026-09-16. Keputusan rinci dalam dokumen ini (termasuk Opsi A) berstatus **Proposed** sampai disetujui Technical dan Security/Privacy. Keputusan ini **tidak** dengan sendirinya membuktikan correctness implementasi, security/privacy approval, operational readiness, regulatory compliance, atau production acceptance.

| Role | Decision | Date |
|---|---|---|
| Product/Architecture Direction | Arah multi-tenancy adopted; rincian proposed; Opsi A dipilih | 2026-09-16 |
| Technical | Pending | — |
| Security/Privacy | Pending | — |
| Operations | Pending | — |



## ADR-002 — Identity Model

### 1. Context

Versi awal SaaS Demo Foundation menetapkan `users` sebagai identitas global dengan `email_blind_index UNIQUE` global, sementara admin tenant dapat `POST /users` dan `PATCH /users/:id`. Review menemukan:

1. **Enumerasi lintas tenant** — respons konflik saat membuat user dengan email yang sudah ada membocorkan bahwa orang tersebut pengguna platform.
2. **Penulisan lintas tenant** — admin Tenant A dapat mengubah nama identitas yang juga tampil di Tenant B.
3. **Account linking tanpa persetujuan** — tidak jelas apakah identitas yang sudah ada otomatis dilampirkan ke tenant baru.
4. **Offboarding** — data identitas dienkripsi dengan kunci platform sehingga tidak dapat di-crypto-shred per tenant.
5. **Kontradiksi dokumen** — keputusan "email global vs per tenant" tercatat sebagai open decision padahal skema sudah memutuskannya.

### 2. Decision

```text
Identity scope        : Global platform identity (satu orang = satu login)
Login key             : Email ternormalisasi, unik global via platform blind index
Tenant onboarding     : Invitation-only; tenant admin tidak membuat identitas
Account linking       : Hanya setelah pemilik email menerima undangan
Tenant-facing profile : Per tenant (tenant_member_profiles), dienkripsi DEK tenant
Global identity edit  : Hanya oleh pemilik identitas (atau platform flow teraudit)
Response uniformity   : Invite/create selalu memberi respons yang sama
```

#### 2.1 Entitas

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

invitation_roles           (tenant-owned, RLS)
  tenant_id, invitation_id, role_id
  PK (tenant_id, invitation_id, role_id)
  FK (tenant_id, invitation_id) -> user_invitations (tenant_id, id)
  FK (tenant_id, role_id)       -> roles (tenant_id, id)

tenant_memberships         (tenant-owned, RLS)
  id, tenant_id, user_id, status, joined_at, ended_at, version
  UNIQUE (tenant_id, user_id)
  UNIQUE (tenant_id, id)

tenant_member_profiles     (tenant-owned, RLS)
  tenant_id, membership_id, display_name_ciphertext,
  display_name_search_tokens NULL (lihat §2.5), job_title NULL,
  contact_email_ciphertext,               (DEK tenant)
  contact_email_blind_index_tenant,       (HMAC tenant-scoped)
  contact_email_source ('INVITATION'), contact_email_captured_at, version
  PK (tenant_id, membership_id)
  FK (tenant_id, membership_id) -> tenant_memberships (tenant_id, id)
  UNIQUE (tenant_id, contact_email_blind_index_tenant)
```

#### 2.2 Invitation flow

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
  -> if not: create identity + credential (email verified by token possession)  [F-16]
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
- Implementasi demo (2026-09-22): hak mengundang adalah permission `members.invite` yang dievaluasi guard backend; melihat status undangan cukup `members.read` (Demo Foundation §11.1a). Role undangan (`invitation_roles`) ditetapkan saat mengundang dan diberikan F-12 secara atomik saat undangan diterima (DEMO-0309); pengundang hanya dapat memberi role yang seluruh permission-nya ia pegang. Role yang diarsipkan antara undangan dibuat dan diterima **dilewati**: membership tetap terbentuk tanpa role itu (default-deny), dan jumlahnya dicatat di audit `invitation.accepted`. Pembuatan identitas baru saat penerimaan memakai Lampiran A F-16.

#### 2.3 Profile edit boundaries

| Data | Tempat | Siapa boleh mengubah |
|---|---|---|
| Email login | `users` | Pemilik identitas melalui flow verifikasi (di luar scope demo) |
| Legal name (opsional) | `users` | Pemilik identitas |
| Display name di tenant | `tenant_member_profiles` | Pemilik identitas **atau** admin tenant dengan permission `members.update_profile` |
| Job title, unit | `tenant_member_profiles` / modul Organization | Admin tenant sesuai permission |
| Status membership | `tenant_memberships` | Admin tenant (`members.suspend`) |
| Status identitas global | `users` | Platform flow teraudit saja |
| Contact email di tenant | `tenant_member_profiles` | Diisi otomatis saat undangan diterima; tidak dapat diubah admin tenant pada baseline |

Admin tenant **tidak dapat** mengubah field di `users` dan `credentials`.

#### 2.3a Pengecualian terkontrol: owner pertama tenant baru

Keputusan pemilik proyek 2026-09-29: **platform membuat membership owner pertama sebuah tenant
baru secara langsung**, bukan melalui undangan. Ini pengecualian terhadap §2.2 (invitation-only),
dan harus dibaca sebagai pengecualian - bukan sebagai pelonggaran aturannya.

Yang diberikan pengecualian ini: kewenangan platform menempelkan sebuah identitas ke sebuah
tenant tanpa persetujuan pemilik identitas. Itu tepat yang ditutup ADR ini, jadi batasnya
ditegakkan **database** (Lampiran A F-28), bukan kode aplikasi:

1. hanya tenant berstatus `PROVISIONING` - yaitu tenant yang baru dibuat dan belum dipakai;
2. hanya bila tenant itu belum punya SATU anggota pun;
3. hanya satu membership, dan hanya dengan role `tenant_owner`;
4. identitasnya harus sudah ada dan `ACTIVE` - platform TIDAK membuat identitas (pembuatan
   identitas tetap hanya lewat undangan, F-16);
5. tercatat di audit TENANT (`tenant.owner_provisioned`), bukan hanya audit platform, sehingga
   tenant dapat melihat bahwa anggota pertamanya datang dari luar dirinya.

Karena butir 1 dan 2, kewenangan ini berlaku **sekali per tenant** dan hanya pada saat tenant
belum dipakai siapa pun. Sesudah provisioning menaikkan status ke `ACTIVE`, F-28 menolak tenant
yang sama - pintu yang dipakainya tertutup oleh langkah terakhir provisioning itu sendiri.

Yang TIDAK berubah: penambahan anggota kedua dan seterusnya tetap invitation-only, dan platform
tidak memiliki jalur untuk menempelkan identitas ke tenant yang sudah berjalan.

Risiko yang diterima secara sadar: pemilik identitas tidak dimintai persetujuan untuk menjadi
owner tenant baru. Yang membatasi dampaknya adalah audit di kedua sisi dan sifat sekali-pakai di
atas; yang TIDAK membatasinya adalah persetujuan - dan itu memang harga dari keputusan ini.

#### 2.4 Encryption keys

- `users.email_ciphertext`, `users.legal_name_ciphertext`: key purpose `platform_identity`; AAD = `platform` + table + field + record_id + schema version.
- `users.email_blind_index`: HMAC dengan key `platform_identity_blind_index`; tidak mengandung tenant (lookup login harus global).
- `user_invitations.email_*` dan `tenant_member_profiles.*` (termasuk `contact_email_*`): DEK tenant dengan key purpose `identity`; AAD memuat `tenant_id`; blind index tenant memakai key `identity_blind_index` milik tenant.
- Offboarding tenant dapat crypto-shred DEK tenant; identitas global dihapus hanya bila tidak ada membership tersisa dan retention/legal hold terpenuhi.

Ketentuan ini dicatat sebagai pengecualian terkontrol dalam Data Protection SSOT §9.1.

#### 2.5 Pencarian nama di administrasi tenant

Keputusan baseline: **exact/prefix-token search terbatas pada `display_name` tenant** menggunakan keyed search token per kata (HMAC per token kata yang dinormalisasi, prefix minimal 3 karakter dibatasi jumlahnya), memakai key `identity_search` milik tenant.

- Pencarian substring/fuzzy tidak didukung.
- Sorting berdasarkan nama dilakukan pada halaman hasil yang sudah didekripsi (bounded page size), bukan pada database.
- Risiko inferensi (frekuensi token) diterima untuk `display_name` karena bersifat DP-1 dan scoped per tenant; **tidak** berlaku untuk field DP-2.
- Demo Foundation boleh menunda fitur ini (pencarian hanya berdasarkan email exact); keputusan ini tetap wajib diuji sebelum production.

#### 2.6 Email member di administrasi tenant

Admin tenant membutuhkan email member untuk mengenali dan mencari orang. Karena admin tidak memiliki jalur ke `users`, diperlukan sumber data email yang berada di dalam tenant.

Keputusan: **salinan per tenant** (`contact_email_*`) disimpan saat undangan diterima.

- `GET /members` menampilkan email **masked** dari salinan ini; filter `email exact` memakai `contact_email_blind_index_tenant`.
- Salinan **tidak** otomatis mengikuti perubahan email global. Perubahan email global (di luar scope demo) wajib memutuskan kebijakan sinkronisasi: propagasi ke seluruh tenant dengan audit, atau salinan tetap sebagai "email saat bergabung". Keputusan ini tercatat di §6.
- Salinan ikut di-crypto-shred saat offboarding tenant.
- Undangan yang sudah `ACCEPTED`/`EXPIRED`/`REVOKED` tidak menjadi sumber email member; retensi `user_invitations.email_*` ditetapkan (default usulan: dihapus/di-null-kan 30 hari setelah status final — nilai final Legal/DPO).

Alternatif yang tidak dipilih: identity service menyediakan email masked dari `users` untuk member tenant aktif. Lebih sinkron, tetapi membuka jalur baca tenant → identitas global yang harus diaudit per request dan melemahkan prinsip ADR ini.

### 3. Alternatives considered

| Alternative | Alasan tidak dipilih |
|---|---|
| Identitas per tenant (email unik per tenant) | Pengguna multi-tenant perlu banyak kredensial; tenant switch tidak mungkin tanpa login ulang; tetap dapat dipertimbangkan untuk tenant premium dengan IdP sendiri |
| Global identity + admin create langsung (desain awal) | Enumerasi, penulisan lintas tenant, linking tanpa persetujuan |
| Global identity + nama hanya di `users` | Admin tenant tidak dapat mengelola nama tampilan; crypto-shred per tenant tidak mungkin |
| Deterministic encryption untuk nama agar bisa dicari | Dilarang Data Protection SSOT §8.2 |

### 4. Consequences

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

### 5. Mandatory tests

- invite untuk email baru vs email terdaftar menghasilkan status code, body, dan waktu respons yang tidak dapat dibedakan secara praktis;
- admin Tenant A tidak dapat membaca/mengubah `users`, `credentials`, atau profil Tenant B;
- undangan tidak dapat diterima oleh identitas lain dari email tujuan;
- token undangan single-use, kedaluwarsa, dan tidak muncul di log;
- penerimaan undangan atomik (membership + profile + contact email copy + roles);
- role pada `invitation_roles` yang berasal dari tenant lain ditolak composite FK (bukan hanya validasi aplikasi);
- `GET /members` menampilkan email masked dan filter email exact bekerja tanpa query ke `users`;
- contact email Tenant A tidak terbaca dari Tenant B untuk Multi-Tenant User;
- offboarding tenant menghapus/men-shred profil tenant tanpa merusak membership di tenant lain.

### 6. Open decisions

- TTL undangan dan kebijakan re-send;
- apakah admin boleh mengubah `display_name` atau hanya pemilik;
- flow perubahan email global, verifikasinya, dan kebijakan sinkronisasi ke `contact_email_*` per tenant;
- retensi `user_invitations.email_*` setelah status final;
- tier IdP/SSO per tenant (akan menjadi ADR terpisah);
- batas jumlah search token per nama.

### 7. Approval

| Role | Decision | Date |
|---|---|---|
| Product/Architecture Direction | Proposed | 2026-09-16 |
| Technical | Pending | — |
| Security/Privacy | Pending | — |



## ADR-003 — Platform Superadmin and Break-Glass Support Access

### 1. Context

Platform membutuhkan **superadmin**: pihak tertinggi yang mengelola seluruh platform (tenant, status, entitlement, identitas global, admin platform, audit platform).

ADR-001 menetapkan platform admin **tidak** memiliki akses implisit ke data tenant dan break-glass wajib ada sebelum production. Tanpa desain rinci, dua risiko muncul:

1. superadmin tidak dapat membantu tenant saat ada masalah (support macet); atau
2. developer memberi superadmin akses penuh permanen melalui bypass RLS (kebocoran besar jika akun superadmin dibobol, dan sulit dipertanggungjawabkan saat platform berperan sebagai Prosesor data tenant — Data Protection SSOT §2.1).

Product direction yang dipilih (2026-09-16): **superadmin ada dengan kewenangan platform penuh; akses ke data tenant melalui break-glass support session — tanpa approval orang kedua pada baseline.**

### 2. Decision

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

#### 2.1 Kewenangan superadmin (tanpa support session)

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

#### 2.2 Break-glass support session

```text
Superadmin (MFA wajib sebelum production)
  -> POST /api/v1/platform/support-sessions
       { tenant_id, reason_code, reason_text, scope: READ_ONLY|READ_WRITE,
         duration_minutes <= 60, ticket_reference? }
  -> validasi: tenant ada (status apa pun kecuali PURGED), permission sesuai scope,
     reason_text minimal, tidak ada sesi aktif lain milik superadmin yang sama
  -> buat support_sessions row (ACTIVE)
  -> audit platform + audit tenant via auth.write_audit_event (Lampiran A F-14)
  -> notifikasi in-app ke tenant owner via auth.notify_tenant_security_event (F-15)
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
10. **Status tenant.** Support session boleh dibuka ke tenant berstatus `ACTIVE`, `SUSPENDED`, `CLOSING`, atau `ARCHIVED` — kebutuhan support justru sering muncul saat tenant disuspend. Untuk status selain `ACTIVE`, scope **dipaksa READ_ONLY**. Ini adalah pengecualian eksplisit terhadap verifikasi "tenant ACTIVE" pada request protected (Infrastructure SSOT §8.6), berlaku hanya untuk context `support`. Tenant `PURGED` ditolak.

#### 2.3 Enforcement di database

- Support session **tidak** memakai role bypass. Transaksi berjalan sebagai `app_user` dengan `app.current_tenant_id` = tenant sesi, sehingga RLS berlaku persis seperti request tenant biasa (tidak bisa menyentuh tenant lain).
- `READ_ONLY` diterapkan dengan `SET TRANSACTION READ ONLY` di awal unit of work sebagai lapisan kedua setelah permission set. **Batas:** mekanisme ini diset oleh aplikasi dan hanya mencegah mutasi di dalam unit of work tersebut; tidak melindungi dari kode di luar wrapper atau aplikasi yang dikompromikan (ADR-001 §3.10). Pengujian "ditolak di database" berarti terbukti pada jalur wrapper, bukan jaminan terhadap semua jalur.
- Audit per request dalam sesi ditulis dengan `support_session_id` dan `actor_type = PLATFORM_SUPPORT` melalui audit writer tenant context biasa.
- Event yang ditulis **dari context platform ke tenant** (started/ended/revoked) memakai fungsi `auth.write_audit_event` (F-14); notifikasi memakai `auth.notify_tenant_security_event` (F-15). Policy `app_user` tidak diperluas.
- Validasi sesi (ACTIVE, belum kedaluwarsa, milik actor) dilakukan pada setiap request, bukan hanya saat token diterbitkan.

#### 2.4 Entitas

```text
platform_role_assignments        (platform-global)
  id, user_id, role_code ('platform_superadmin'), granted_by, granted_at,
  revoked_at NULL, revoked_by NULL, reason
  UNIQUE (user_id, role_code) WHERE revoked_at IS NULL

support_sessions                 (tenant control-plane; tenant_id NOT NULL)
  id, tenant_id, superadmin_user_id, platform_session_id, scope (READ_ONLY|READ_WRITE),
  reason_code, reason_text_ciphertext + reason_text_key_version (DEK PLATFORM,
    purpose platform_support_reason), ticket_reference NULL,
  started_at, expires_at, ended_at NULL, ended_by NULL, end_reason NULL,
  status (ACTIVE|ENDED|EXPIRED|REVOKED)
  UNIQUE (superadmin_user_id) WHERE status = 'ACTIVE'
  UNIQUE (tenant_id, id)   -- sasaran composite FK dari tenant_notifications
```

tenant_notifications             (tenant-owned; minimal in-app notice)
  id, tenant_id, type ('SUPPORT_SESSION_STARTED'|'SUPPORT_SESSION_ENDED'),
  ref_id (support_session_id), audience ('TENANT_SECURITY_READERS'),
  created_at, read_at NULL, read_by_membership_id NULL
  UNIQUE (tenant_id, id)

RLS `support_sessions`:

- context platform: baca semua, insert/update baris sesinya sendiri melalui service;
- context tenant: tenant owner/auditor dengan `audit.read` membaca baris `tenant_id = current` (tanpa `reason_text` raw bila policy menentukan masking);
- context support: baca baris sesi aktif sendiri saja.

`reason_text` dienkripsi karena dapat memuat detail kasus yang menyebut orang.

Kuncinya adalah **DEK PLATFORM** (purpose `platform_support_reason`), bukan DEK tenant seperti
edisi 2.5 menuliskannya. Sebabnya bukan kenyamanan: penulisnya berjalan di context platform,
sedangkan keputusan slice 8 (Data Protection SSOT §9) hanya menyerahkan kunci tenant di dalam
context tenant pemiliknya. Memaksa DEK tenant di sini berarti membuka jalur baru yang menyerahkan
kunci tenant ke context platform - melemahkan aturan yang sudah terbukti demi satu kolom.

Akibat yang harus dikatakan terus terang: pembaca di tenant melihat baris sesi, `reason_code`,
nomor tiket, scope, dan waktunya - tetapi **tidak dapat membuka teks bebasnya**. Byte ciphertext
memang ikut terbaca olehnya (grant kolom tidak dapat dibedakan per policy) dan itu tidak
berbahaya tanpa DEK platform. Tidak ada endpoint mana pun yang mengembalikan teks itu pada
baseline (D-39).

`platform_session_id` menggantung sesi support pada session `PLATFORM` yang membukanya. Itulah
cara §2.6 butir 5 ditegakkan tanpa kode pembersih: guard memeriksa KEDUA baris setiap request,
sehingga session platform yang dicabut - lewat logout maupun lewat pencabutan family refresh
token - mematikan token support seketika, bukan menunggu kedaluwarsa.

`tenant_notifications` adalah notifikasi in-app minimal untuk event keamanan tenant, bukan modul Notifications penuh (General Feature Base §12). Dibaca oleh member tenant yang memiliki `audit.read`; insert hanya melalui F-15; `read_at` dapat diperbarui oleh pembaca. Modul Notifications penuh tetap di luar scope demo.

#### 2.5 Pengelolaan superadmin

- Superadmin pertama dibuat melalui **bootstrap command** di server (sekali, idempotent, teraudit), bukan melalui API publik atau seed production.
- Superadmin berikutnya ditambahkan oleh superadmin lain melalui `platform.admins.manage`; tidak dapat menambah/menghapus dirinya sendiri.
- Minimal **dua** superadmin aktif direkomendasikan untuk production; sistem menolak pencabutan superadmin terakhir.
- **MFA wajib** untuk superadmin sebelum production (MFA berada di luar scope demo; demo mencatatnya sebagai known limitation).
- Review daftar superadmin berkala (misalnya per kuartal) — nilai final Operations.
- Pemulihan saat seluruh akun superadmin hilang: prosedur offline di server (bootstrap command dengan akses host + dua orang saksi) — didokumentasikan di runbook, bukan fitur aplikasi.

#### 2.6 Login, session, dan pemilihan context

Superadmin tidak memiliki membership tenant, sehingga session tidak dapat selalu terikat tenant. User multi-membership juga memerlukan status di antara "password terverifikasi" dan "context dipilih".

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

1. `sessions` dan `refresh_tokens` memiliki `context_kind` (`TENANT` | `PLATFORM`) dengan `CHECK ((context_kind = 'TENANT') = (tenant_id IS NOT NULL))` (ADR-001 §3.8).
2. Access token context `PLATFORM` hanya diterima route `/platform/*`; context `TENANT` hanya route tenant; token `support` hanya diterbitkan dari session `PLATFORM` yang aktif dan tidak dapat di-refresh.
3. Superadmin **boleh** juga menjadi member tenant biasa (misalnya tenant internal), tetapi context `TENANT` miliknya tidak membawa permission platform, dan context `PLATFORM` tidak membawa data tenant.
4. Tiket pemilihan tidak dapat dipakai untuk memanggil endpoint lain selain `GET /auth/contexts` dan `POST /auth/select-context`.
5. Mengakhiri session `PLATFORM` (logout/revoke) otomatis mengakhiri support session aktif milik superadmin tersebut.
6. `GET /me/tenants` digantikan `GET /me/contexts` yang mengembalikan membership aktif dan akses platform (bila ada).

### 3. Alternatives considered

| Alternative | Keputusan | Alasan |
|---|---|---|
| Superadmin akses penuh permanen (bypass RLS) | Ditolak | Satu akun bocor = seluruh data semua tenant bocor; bertentangan dengan ADR-001; sulit dipertanggungjawabkan sebagai Prosesor |
| Break-glass + approval orang kedua / tenant owner | Tidak dipilih untuk baseline | Paling aman, tetapi memperlambat support darurat dan membutuhkan minimal dua operator aktif; dapat diaktifkan untuk tenant/tier tertentu melalui ADR baru |
| Impersonation (login sebagai user tenant) | Ditolak | Audit mengaburkan siapa pelaku sebenarnya; berisiko menyalahgunakan permission user |
| Superadmin sebagai member di setiap tenant | Ditolak | Membuat akses implisit permanen dan mengacaukan data membership tenant |

### 4. Consequences

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

### 5. Mandatory tests

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
- superadmin tanpa membership dapat login dan memperoleh session `PLATFORM`; session `PLATFORM` tidak terbaca dari context tenant;
- user dengan >1 context wajib memilih; tiket kedaluwarsa/dipakai ulang ditolak; tiket tidak dapat memanggil endpoint lain;
- token context `PLATFORM` ditolak di route tenant dan sebaliknya;
- support session ke tenant `SUSPENDED` hanya READ_ONLY; `PURGED` ditolak;
- logout session `PLATFORM` mengakhiri support session aktif;
- `tenant_notifications` hanya dapat di-insert via F-15 dan hanya dibaca member dengan `audit.read`.

### 6. Open decisions

Tiga keputusan di bawah **ditutup pada DEMO-0312** (keputusan pemilik proyek 2026-09-27); sisanya
masih terbuka.

- ~~daftar final `reason_code` dan pemetaan ke scope~~ - **ditutup**: `TENANT_REPORTED_BUG`,
  `DATA_INVESTIGATION`, `SECURITY_INCIDENT` (ketiganya READ_ONLY) dan
  `DATA_CORRECTION_REQUESTED_BY_TENANT` (satu-satunya yang mengizinkan READ_WRITE). Allowlist
  dan pemetaannya ditegakkan CHECK di tabel, bukan hanya divalidasi aplikasi.
- ~~isi final `SUPPORT_READ_SET` dan `SUPPORT_WRITE_SET`~~ - **ditutup**: READ =
  `members.read`, `roles.read`, `permissions.read`, `menus.read`, `audit.read`;
  WRITE = READ + `members.update_profile`. `profile.*` sengaja TIDAK termasuk (artinya "profil
  milik sendiri", dan sesi support tidak punya membership). Selain himpunan itu, permintaan yang
  MENGUBAH keadaan hanya lolos untuk permission di `SUPPORT_MUTATION_SET` (= `members.update_profile`):
  tanpa pemeriksaan metode, permission baca yang dipakai route tulis - `audit.read` pada
  `POST /notifications/security/:id/read` - akan membuat sesi support dapat menandai notifikasi
  tentang dirinya sendiri sudah dibaca.
- ~~durasi maksimum (60 menit baseline)~~ - **ditutup**: 60 menit, ditegakkan CHECK; tidak dapat
  diperpanjang (kolom `expires_at` tanpa grant UPDATE). **Idle timeout tetap terbuka.**
- apakah tenant tier tertentu mewajibkan approval tenant owner;
- mekanisme MFA superadmin (TOTP/WebAuthn) — terkait ADR MFA/SSO mendatang;
- kanal notifikasi selain in-app (email) setelah provider tersedia.

### 7. Approval

| Role | Decision | Date |
|---|---|---|
| Product Direction | Break-glass tanpa approval kedua dipilih | 2026-09-16 |
| Technical | Pending | — |
| Security/Privacy | Pending | — |
| Legal/DPO | Pending (dampak peran Prosesor) | — |



## Lampiran A — Pre-context & Cross-context Database Access Register

### 1. Tujuan

Register ini adalah **sumber tunggal** untuk:

1. **seluruh** fungsi PostgreSQL `SECURITY DEFINER` di database — baik yang dipakai sebelum tenant context terbentuk (pre-context), yang menulis lintas context (cross-context), maupun yang menjaga integritas dari dalam trigger (F-20). Batasnya ditentukan test §5 butir 4 ("tidak ada fungsi `SECURITY DEFINER` di luar register"), bukan oleh kegunaannya;
2. policy RLS `TO app_auth_definer` yang memungkinkan fungsi tersebut membaca atau menulis baris yang dibutuhkan (keputusan **Opsi A**, ADR-001 §3.7).

Menambah, mengubah, atau menghapus entri wajib melalui review Security dan pembaruan lampiran ini (dicatat di bagian Riwayat) **sebelum** migration dibuat.

### 2. Model hak akses (Opsi A)

```text
app_owner          : pemilik schema/tabel; hanya pipeline migration; tidak dipakai runtime
app_auth_definer   : NOLOGIN, NOBYPASSRLS, NOINHERIT; pemilik fungsi di schema auth;
                     memperoleh akses baris HANYA melalui policy "TO app_auth_definer" di §4
app_user           : LOGIN runtime, NOBYPASSRLS; EXECUTE pada fungsi §3; tidak ada policy §4
```

Aturan wajib:

1. `app_auth_definer` **tidak** memiliki `BYPASSRLS` dan bukan pemilik tabel, sehingga `FORCE ROW LEVEL SECURITY` tetap berlaku padanya. Akses hanya dari policy §4.
2. `app_user` **tidak** menjadi member `app_auth_definer` dan tidak dapat `SET ROLE app_auth_definer` (diverifikasi via `pg_auth_members`).
3. Policy §4 dibuat per tabel, per operasi (`SELECT`/`INSERT`/`UPDATE`), dan **tidak** memakai `FOR ALL`.
4. Grant tabel ke `app_auth_definer` dibatasi pada kolom yang tercantum di §4 (column-level `GRANT SELECT (col, ...)`).
5. Setiap fungsi: `SECURITY DEFINER`, `SET search_path = pg_catalog, auth, public` (schema eksplisit), `LANGUAGE sql` atau `plpgsql` tanpa `EXECUTE` dinamis, parameter bertipe tetap.
6. `REVOKE ALL ON FUNCTION ... FROM PUBLIC`; `GRANT EXECUTE ... TO app_user` hanya untuk fungsi yang dipakai runtime.
7. Fungsi mengembalikan kolom minimum; tidak mengembalikan plaintext maupun ciphertext data personal, kecuali entri yang ditandai "ciphertext diizinkan" dengan alasan.
8. Rate limit dan audit diterapkan di lapisan aplikasi di atas pemanggilan fungsi.
9. Schema inspection test di CI membandingkan `pg_proc`, `pg_policies`, `information_schema.column_privileges`, dan `pg_auth_members` terhadap register ini; perbedaan = build gagal.

### 3. Daftar fungsi

| ID | Fungsi | Tipe | Input | Output | Tabel yang disentuh (via §4) | Dipakai oleh | Test negatif minimum |
|---|---|---|---|---|---|---|---|
| F-01 | `auth.resolve_tenant_by_host(host text)` | Pre-context | host ternormalisasi | `tenant_id`, `status` | `tenant_domains` (S), `tenants` (S) | Tenant resolver | host tak terverifikasi → kosong; tenant PURGED → kosong |
| F-02 | `auth.find_identity_for_login(email_blind_index bytea)` | Pre-context | blind index global | `user_id`, `status`, `password_hash`, `password_algorithm`, `password_parameter_version`, `failed_attempts`, `locked_until` | `users` (S), `credentials` (S) | Login | index acak → kosong; tidak mengembalikan email/nama |
| F-03 | `auth.record_login_attempt(user_id uuid, succeeded boolean)` | Pre-context | user_id hasil F-02 | status lock | `credentials` (U: `failed_attempts`, `locked_until`) | Login | user_id acak → no-op tanpa error berbeda |
| F-04 | `auth.list_login_contexts(user_id uuid)` | Pre-context | user_id terverifikasi password | daftar `{context_kind, tenant_id, tenant_slug, tenant_name, membership_id}`: satu baris per membership aktif (`context_kind = TENANT`) **dan** satu baris `PLATFORM` bila ada role platform aktif. Context platform adalah BARIS, bukan flag - superadmin tanpa membership tidak menghasilkan baris tenant satu pun, sehingga flag pada daftar kosong tidak dapat dibaca pemanggil mana pun | `tenant_memberships` (S), `tenants` (S), `platform_role_assignments` (S) | Login, pemilihan context | user_id tanpa verifikasi tidak dapat dipanggil (dipanggil hanya setelah F-02 + verifikasi hash di aplikasi); tidak mengembalikan membership non-aktif; tidak mengembalikan baris PLATFORM untuk identitas tanpa role platform; nama tenant tidak dikembalikan untuk baris PLATFORM |
| F-05 | `auth.create_selection_ticket(user_id uuid, ticket_hash bytea, expires_at timestamptz)` | Pre-context | hash tiket | `ticket_id` | `auth_selection_tickets` (I) | Login multi-context | TTL > 5 menit ditolak |
| F-06 | `auth.consume_selection_ticket(ticket_hash bytea, target_kind text, tenant_id uuid)` | Pre-context | hash tiket + target | `user_id`, `membership_id` atau platform flag | `auth_selection_tickets` (S,U), `tenant_memberships` (S), `platform_role_assignments` (S) | `POST /auth/select-context` | tiket kedaluwarsa/dipakai ulang; target bukan milik user |
| F-07 | `auth.create_session(...)` | Pre-context | user, context_kind, tenant_id/NULL, membership_id/NULL, refresh token hash, family, expiry | `session_id`, `refresh_token_id` | `sessions` (I), `refresh_tokens` (I), `tenant_memberships` (S), `platform_role_assignments` (S) | Login, select-context, tenant switch | membership yang bukan milik user itu atau tidak `ACTIVE` ditolak (`42501`); context PLATFORM tanpa role platform ditolak (`42501`); context PLATFORM yang membawa tenant atau membership ditolak (`22023`); `context_kind` di luar TENANT/PLATFORM ditolak. Fungsi ini menjaga batas ORANG saja: kecocokan membership dengan TENANT-nya tetap dijaga composite FK `(tenant_id, membership_id)`, dan pemeriksaan di fungsi sengaja tidak menyertakan tenant agar tidak menutupi constraint itu |
| F-08 | `auth.find_refresh_token(token_hash bytea)` | Pre-context | hash | `refresh_token_id`, `session_id`, `family_id`, `context_kind`, `tenant_id`, status, expiry | `refresh_tokens` (S), `sessions` (S) | Refresh | hash salah → kosong |
| F-09 | `auth.rotate_refresh_token(old_id uuid, new_hash bytea, new_expiry timestamptz)` | Pre-context | id + hash baru | `new_refresh_token_id` atau `REUSE_DETECTED` | `refresh_tokens` (S,U,I), `sessions` (U) | Refresh | rotasi token sudah dirotasi → revoke family; concurrent rotation → satu pemenang |
| F-10 | `auth.revoke_session(session_id uuid, reason text)` / `auth.revoke_token_family(family_id uuid, reason text)` | Pre-context | id | jumlah baris | `sessions` (U), `refresh_tokens` (U) | Logout, reuse detection, platform revoke | id tak dikenal → 0 tanpa error berbeda |
| F-11 | `auth.find_invitation_for_acceptance(p_token_hash bytea)` | Pre-context | hash undangan | `invitation_id`, `tenant_id`, `tenant_name`, `expires_at`, `identity_hint` (blind index global email undangan) | `user_invitations` (S), `tenants` (S) | Halaman dan aksi terima undangan | hash salah, kedaluwarsa, bukan `PENDING`, atau tenant tidak `ACTIVE` → kosong; tidak mengembalikan email/role |
| F-12 | `auth.accept_invitation(p_token_hash bytea, p_user_id uuid, p_profile_id uuid, p_display_name_ciphertext bytea, p_display_name_key_version int, p_contact_email_ciphertext bytea, p_contact_email_key_version int, p_contact_email_blind_index bytea)` | Pre-context | hash undangan + identitas terautentikasi (atau baru dibuat F-16 dalam transaksi yang sama) | `membership_id`, atau NULL untuk semua kegagalan | `user_invitations` (S,U), `tenants` (S), `users` (S), `tenant_memberships` (S,I), `tenant_member_profiles` (I), `invitation_roles` (S), `roles` (S), `user_role_assignments` (S,I) | Terima undangan | identitas ≠ email undangan (blind index global ≠ `identity_hint`; dicek aplikasi sebelum panggil dan dicek ulang di fungsi); undangan dipakai ulang, dicabut, atau kedaluwarsa; membership lama yang tidak `ACTIVE` tidak dihidupkan; anggota aktif memakai membership lamanya tanpa profil kedua; role dari `invitation_roles` diberikan atomik dengan pemberi = pengundang, role yang diarsipkan dilewati, role yang sudah dipegang tidak digandakan; role milik tenant lain ditolak composite FK |
| F-13 | `auth.get_platform_roles(user_id uuid)` | Pre-context/platform | user_id dari session terverifikasi | daftar `role_code` aktif | `platform_role_assignments` (S) | Platform guard | user_id tanpa role → kosong |
| F-14 | `auth.write_audit_event(p_event_type varchar, p_outcome varchar, p_tenant_id uuid, p_actor_user_id uuid, p_actor_session_id uuid, p_actor_identifier_hash bytea, p_subject_type varchar, p_subject_id uuid, p_detail jsonb)` | Pre-context & cross-context | event tervalidasi | `audit_log_id` | `audit_logs` (I), `audit_event_types` (rujukan FK) | Audit login gagal, event platform, event support ke audit tenant | `detail` memuat kunci terlarang (`email`, `password`, `token`, `ticket`, `password_hash`) ditolak fungsi; nama event di luar katalog `audit_event_types` ditolak foreign key |
| F-17 | `auth.count_recent_failures(p_identifier_hash bytea, p_window_seconds int, p_event_type varchar)` | Pre-context | hash identifier (HMAC berkunci) | jumlah kegagalan | `audit_logs` (S) | Rate limiting login dan penerimaan undangan; hanya kegagalan SETELAH keberhasilan terakhir yang dihitung | tidak mengembalikan baris audit apa pun, hanya angka; identifier tidak pernah diterima dalam bentuk mentah |
| F-15 | `auth.notify_tenant_security_event(p_tenant_id uuid, p_type text, p_ref_id uuid)` | Cross-context | tenant + tipe allowlist | `notification_id` | `tenant_notifications` (I), `tenants` (S) | Notifikasi support session ke tenant owner | tipe di luar allowlist ditolak; tenant tidak dikenal atau `PURGED` ditolak; TIDAK membaca `tenant_notifications` (id dibuat di dalam fungsi, tanpa `RETURNING`, sehingga penulis tidak punya hak baca) |
| F-16 | `auth.create_identity_for_invitation(p_token_hash bytea, p_user_id uuid, p_email_blind_index bytea, p_email_ciphertext bytea, p_email_key_version int, p_password_hash text)` | Pre-context | hash undangan + identitas baru (email terenkripsi key `platform_identity`, hash password) | `boolean` | `user_invitations` (S), `tenants` (S), `users` (S,I), `credentials` (I) | Terima undangan oleh email yang belum punya identitas; dipanggil dalam transaksi yang sama dengan F-12 | token tidak sah, kedaluwarsa, atau tenant tidak `ACTIVE` → `false`; blind index ≠ `identity_hint` undangan → `false` (mencegah mendaftarkan email lain lewat undangan); identitas dengan email itu sudah ada → `false`; status identitas baru selalu `ACTIVE` (kolom tidak di-grant) |
| F-18 | `auth.find_support_session(p_id uuid)` | Pre-context | id sesi | baris sesi (`tenant_id`, `superadmin_user_id`, `platform_session_id`, `scope`, `expires_at`) | `support_sessions` (S) | Validasi sesi support pada SETIAP request (§2.3) | fail-closed: hanya `status = 'ACTIVE'` dan `expires_at > now()` yang menghasilkan baris; nol baris = ditolak. Tidak membaca `reason_text_ciphertext` |
| F-19 | `auth.end_support_sessions_for_platform_session(p_platform_session_id uuid)` | Cross-context | id session platform | daftar `(support_session_id, tenant_id)` yang diakhiri | `support_sessions` (U) | Logout/pencabutan session PLATFORM mengakhiri sesi support yang menempel padanya (§2.6 butir 5) | hanya `status = 'ACTIVE'` yang diubah; idempoten; mengembalikan baris supaya pemanggil dapat menulis audit dan notifikasi tenant |
| F-20 | `auth.menus_assert_hierarchy()` | Integritas (trigger `BEFORE INSERT OR UPDATE OF parent_id ON menus`) | baris `NEW` | `NEW`, atau `check_violation` | `menus` (S) | Penjaga hierarki menu (Demo Foundation §10; siklus dan kedalaman > 10 tingkat) | siklus dua tingkat ditolak (`23514`); pemilik dihitung ULANG dari `NEW.tenant_id` dan **bukan** dibaca dari `NEW.owner_key` — kolom itu `GENERATED STORED` dan baru dihitung SESUDAH trigger `BEFORE`, sehingga versi yang memakainya membaca nol baris dan meloloskan siklus tanpa pesan apa pun |
| F-21 | `auth.find_session(p_session_id uuid)` | Pre-context | id session | baris session (context_kind, tenant_id, user_id, membership_id, status, expiry) | `sessions` (S), `tenant_memberships` (S), `tenants` (S) | Verifikasi session pada SETIAP request protected | session dicabut/kedaluwarsa → kosong; membership tidak `ACTIVE` → kosong (anggota yang ditangguhkan kehilangan hak seketika, bukan pada login berikutnya) |
| F-22 | `auth.find_membership(p_user_id uuid, p_tenant_id uuid)` | Pre-context | user + tenant terverifikasi | `membership_id`, status | `tenant_memberships` (S) | Pemilihan context dan perpindahan tenant | membership milik orang lain atau tidak `ACTIVE` → kosong |
| F-23 | `auth.create_refresh_token(p_session_id uuid, p_tenant_id uuid, p_context_kind varchar, p_token_hash bytea, p_ttl_seconds int)` | Pre-context | session yang sudah ada + hash token | `refresh_token_id`, `family_id` | `refresh_tokens` (I), `sessions` (S) | Penerbitan refresh token di luar pembuatan session (F-07) | session tidak ada/dicabut → ditolak; `context_kind` wajib sama dengan session-nya |
| F-24 | `auth.get_active_key(p_purpose varchar, p_tenant_id uuid)` | Kunci | purpose + scope | `key_version`, `wrapped_dek` | `crypto_keys` (S) | Enkripsi/dekripsi field (Data Protection §9) | mengembalikan DEK **terbungkus** saja - KEK tidak pernah ada di database; purpose platform dengan `tenant_id` terisi (atau sebaliknya) → kosong, dijaga CHECK tabel |
| F-25 | `auth.get_key_version(p_purpose varchar, p_tenant_id uuid, p_version int)` | Kunci | purpose + scope + versi | `wrapped_dek` | `crypto_keys` (S) | Membuka data yang ditulis dengan versi kunci lama | versi yang tidak ada → kosong; sama seperti F-24, hanya ciphertext DEK |
| F-26 | `auth.create_tenant_key(p_tenant_id uuid, p_purpose varchar, p_key_version int, p_wrapped_dek bytea)` | Provisioning | tenant + purpose + DEK **terbungkus** | `boolean` | `crypto_keys` (I), `tenants` (S) | Provisioning tenant (D-17): tenant baru mendapat kunci enkripsinya | purpose `platform_%` → `false` (kunci platform tidak boleh lahir dari jalur tenant); tenant tidak ada / `PURGED` / `ARCHIVED` → `false`; kunci ACTIVE kedua untuk (tenant, purpose) ditolak index unik parsial, bukan oleh pemeriksaan di fungsi |
| F-27 | `auth.provision_tenant_roles(p_tenant_id uuid, p_component varchar)` | Provisioning | tenant + komponen | jumlah role dibuat, `-1` bukan `PROVISIONING`, `-2` sudah punya role | `role_templates` (S), `role_template_permissions` (S), `permissions` (S), `roles` (I), `role_permissions` (I) | Provisioning tenant (D-25): role sistem dari template | tenant bukan `PROVISIONING` → `-1`; tenant sudah punya role → `-2`; role `is_system = false` ditolak policy INSERT; isi role owner DIHITUNG dari katalog `permissions` saat provisioning, sehingga permission yang lahir kelak ikut terbawa |
| F-28 | `auth.provision_tenant_owner(p_tenant_id uuid, p_user_id uuid, p_profile_id uuid, ciphertext nama + email kontak + blind index)` | Provisioning (pengecualian ADR-002 §2.2) | tenant + identitas yang SUDAH ada | `membership_id`, atau NULL untuk SEMUA penolakan | `tenants` (S), `users` (S), `roles` (S), `tenant_memberships` (S,I), `tenant_member_profiles` (I), `user_role_assignments` (I) | Owner pertama tenant yang baru dibuat | tenant bukan `PROVISIONING` → NULL; tenant sudah punya anggota (satu pun) → NULL; identitas tidak ada atau bukan `ACTIVE` → NULL; role `tenant_owner` belum ada → NULL; hanya SATU membership dan hanya role `tenant_owner`; `membership_id` dibuat DATABASE (tidak ada grant INSERT atas kolom `id`); NULL tunggal untuk semua sebab, supaya pemanggil tidak dapat menyimpulkan keberadaan sebuah identitas |

Kode: S = SELECT, I = INSERT, U = UPDATE. Nama fungsi final dapat berubah; ID tetap.

**Status implementasi (diperiksa `api/test/register.test.ts`, bukan diklaim di sini).** Tiga entri
di atas **belum ada isinya di database**, dan tes menuntut ketiadaannya supaya "terdaftar" tidak
pernah lagi terbaca sebagai "ada":

| ID | Keadaan | Sebab |
|---|---|---|
| F-01 | belum ada; tabel `tenant_domains` juga belum dibuat | Demo tidak menentukan tenant dari host; context tenant berasal dari membership terverifikasi. Akan kembali bila resolusi per domain masuk scope |
| F-03 | belum ada | Digantikan F-17: hitungan kegagalan dibaca dari `audit_logs`, bukan disimpan di `credentials` - restart proses karena itu tidak menihilkan kuncian |
| F-08 | belum ada | Diserap F-09 (`rotate_refresh_token` mencari sendiri barisnya) dan F-21 |

F-21 sampai F-25 **sudah berjalan sejak slice 2, 5, dan 8** dan baru terdaftar pada 2026-09-28,
ditemukan oleh tes register yang menghitung isi `pg_proc`. Dua di antaranya (F-21, F-22) dilewati
setiap request, dan dua lagi (F-24, F-25) membaca tabel DEK - justru jalur yang paling perlu
terlihat oleh reviewer Security. Itulah harga register yang hanya berupa dokumen: ia tidak menolak
apa pun.

**Catatan F-02:** mengembalikan `password_hash` ke aplikasi diperlukan agar verifikasi Argon2id dilakukan di aplikasi (library yang ditinjau), bukan di database. Alternatif verifikasi di database (extension) tidak dipilih. Hash tidak boleh dicatat di log (DP SSOT §6.5).

**Catatan F-11/F-12/F-16 (edisi 2.1):** F-12 dan F-16 menerima **hash token**, bukan `invitation_id` hasil F-11: setiap pemanggilan membuktikan ulang kepemilikan token, sehingga tidak ada fungsi yang memercayai keluaran fungsi lain. F-16 menerima ciphertext email sebagai **input** dan tidak mengembalikan data apa pun, sehingga §2 butir 7 tetap terpenuhi. Hasil `false` karena identitas sudah ada hanya terlihat oleh pemegang token (pemilik email itu sendiri), tidak oleh tenant pengundang; respons undangan ke tenant tetap seragam (ADR-002 §2.2).

### 4. Policy `TO app_auth_definer`

| Tabel | Operasi | Policy (indikatif) | Kolom yang di-grant |
|---|---|---|---|
| `tenant_domains` | SELECT | `USING (verified_at IS NOT NULL)` | `tenant_id, host, verified_at` |
| `tenants` | SELECT | `USING (status <> 'PURGED')` | `id, display_name, status` |
| `users` | SELECT, INSERT | `USING (true)` / `WITH CHECK (status = 'ACTIVE')` | SELECT: `id, email_blind_index, status`; INSERT (F-16): `id, email_ciphertext, email_key_version, email_blind_index` |
| `credentials` | SELECT, UPDATE, INSERT | `USING (true)` / `WITH CHECK (true)` | SELECT: kolom hash & lock; UPDATE: `failed_attempts, locked_until`; INSERT (F-16): `user_id, password_hash` |
| `tenant_memberships` | SELECT, INSERT | `USING (status = 'ACTIVE')` / `WITH CHECK (status = 'ACTIVE')` | SELECT: `id, tenant_id, user_id, status, joined_at`; INSERT (F-12): `tenant_id, user_id, status`. Membership dari undangan tidak membawa role (default-deny) |
| `platform_role_assignments` | SELECT | `USING (revoked_at IS NULL)` | `user_id, role_code, revoked_at` |
| `auth_selection_tickets` | SELECT, INSERT, UPDATE | `USING (true)` | seluruh kolom |
| `sessions` | SELECT, INSERT, UPDATE | `USING (true)` / `WITH CHECK (context_kind IN ('TENANT','PLATFORM'))` | seluruh kolom kecuali tidak ada kolom personal |
| `refresh_tokens` | SELECT, INSERT, UPDATE | `USING (true)` | seluruh kolom |
| `user_invitations` | SELECT, UPDATE | SELECT `USING (true)`; UPDATE `USING (status = 'PENDING')` / `WITH CHECK (status = 'ACCEPTED')` | SELECT: `id, tenant_id, identity_hint, token_hash, status, expires_at, invited_by_membership_id`; UPDATE: `status, accepted_membership_id, updated_at` |
| `invitation_roles` | SELECT | `USING (true)` | `tenant_id, invitation_id, role_id` |
| `roles` | SELECT | `USING (true)` | `id, tenant_id, archived_at, code, is_system` - `code` dan `is_system` ditambahkan pada slice 16 karena F-28 mencari role owner dari KODE-nya. `name` tetap di luar daftar: ia label yang dibaca manusia, dan jalur definer tidak membutuhkannya |
| `tenant_member_profiles` | INSERT | `WITH CHECK (true)` | seluruh kolom |
| `user_role_assignments` | SELECT, INSERT | `USING (true)` / `WITH CHECK (ended_at IS NULL)` | SELECT: `tenant_id, membership_id, role_id, ended_at`; INSERT (F-12): `tenant_id, membership_id, role_id, assigned_by_membership_id` |
| `audit_logs` | SELECT, INSERT | SELECT `USING (true)`; INSERT `WITH CHECK (true)` | SELECT: `id` (untuk `RETURNING` milik F-14) + `occurred_at, event_type, outcome, actor_identifier_hash` (penghitungan kegagalan F-17). `detail`, `tenant_id`, `actor_user_id`, `actor_session_id`, dan kedua kolom `subject_*` **tidak** terbaca jalur definer; INSERT: seluruh kolom |
| `tenant_notifications` | INSERT | `WITH CHECK (type IN ('SUPPORT_SESSION_STARTED','SUPPORT_SESSION_ENDED'))` | `id, tenant_id, type, ref_id, audience` - tanpa SELECT dan tanpa kolom `read_*`: penulis notifikasi tidak dapat membaca kembali maupun menandai terbaca |
| `support_sessions` | SELECT, UPDATE | SELECT `USING (true)`; UPDATE `USING (status = 'ACTIVE')` / `WITH CHECK (status <> 'ACTIVE')` | SELECT (F-18, F-19): `id, tenant_id, superadmin_user_id, platform_session_id, scope, status, expires_at` - tanpa `reason_text_ciphertext`; UPDATE (F-19): `status, ended_at, end_reason`. SELECT `USING (true)` dan bukan `status = 'ACTIVE'` karena F-19 memakai `UPDATE ... RETURNING`, dan baris HASIL update (sudah `ENDED`) wajib lolos policy SELECT juga; fail-closed tetap dijaga klausa WHERE di dalam F-18 |
| `crypto_keys` | SELECT, INSERT | SELECT `USING (true)`; INSERT `WITH CHECK (tenant_id IS NOT NULL AND status = 'ACTIVE')` | `tenant_id, purpose, key_version, status, wrapped_dek` - dipakai F-24 dan F-25. Yang terbaca hanya DEK **terbungkus**; KEK berada di luar database (Data Protection §9.2), sehingga baris ini tidak dapat dibuka oleh pemegang akses database saja. Entri ini luput dari register sampai 2026-09-28 |
| `permissions` | SELECT | `USING (true)` | `code, scope, retired_at` - dipakai F-27 untuk menghitung isi role owner. Deskripsi permission tidak ikut |
| `roles` | INSERT | `WITH CHECK (is_system = TRUE)` | `id, tenant_id, code, name, is_system` (F-27). Jalur definer hanya dapat membuat role SISTEM; role biasa tetap dibuat tenant sendiri |
| `role_permissions` | INSERT | `WITH CHECK (permission_scope = 'TENANT')` | `tenant_id, role_id, permission_code, permission_scope` (F-27) |
| `role_templates` | SELECT | `USING (true)` | `component, code, name, includes_all_tenant_permissions, sort_order` (F-27) |
| `role_template_permissions` | SELECT | `USING (true)` | `component, role_code, permission_code, permission_scope` (F-27) |
| `menus` | SELECT | `USING (true)` | `owner_key, id, parent_id, code` — hanya kolom yang dibutuhkan penelusuran rantai induk F-20. `FORCE ROW LEVEL SECURITY` berlaku juga bagi pemilik tabel, jadi tanpa policy ini trigger penjaga membaca nol baris dan tidak menolak apa pun |

**Grant WAJIB per kolom, bukan per tabel.** Sampai 2026-09-28 empat tabel (`audit_logs`,
`auth_selection_tickets`, `sessions`, `refresh_tokens`) diberi grant tingkat tabel, dan
akibatnya tidak teoretis: setiap kolom yang ditambahkan kelak otomatis ikut terbaca jalur
definer tanpa seorang pun memutuskannya. Migrasi 0022 mempersempitnya menjadi daftar kolom
di atas, dan `api/test/register.test.ts` kasus 4 menolak keberadaan grant tingkat tabel apa pun
untuk role ini.

Policy ini **permissive** dan hanya berlaku bagi role `app_auth_definer`; policy tenant untuk `app_user` tidak berubah. Integritas lintas tenant pada INSERT tetap dijaga composite FK `(tenant_id, …)`.

Catatan `user_invitations` untuk `app_user` (bukan policy register, dicatat karena menyangkut kolom rahasia yang sama): tenant dapat **menulis** `token_hash` dan `identity_hint` saat mengundang, tetapi tidak memiliki hak SELECT atas keduanya; tenant hanya dapat mengubah undangan `PENDING` menjadi `PENDING` (undang ulang) atau `REVOKED`.

`SELECT ... FOR UPDATE` di dalam fungsi ikut menerapkan `USING` policy UPDATE; karena itu policy UPDATE `user_invitations` (`status = 'PENDING'`) juga menjadi lapis kedua syarat sekali pakai F-12.

### 5. Test wajib (CI)

**Sudah ada sejak 2026-09-28** sebagai `api/test/register.test.ts` (5 kasus) beserta
`db/register.json` - register dalam bentuk data. Test itu membandingkan `pg_proc`,
`pg_policies`, `information_schema.column_privileges`, `pg_auth_members`, `rolbypassrls`, dan
`relforcerowsecurity` dengan register, dan menuntut setiap fungsi definer membawa nomor F-xx
sebagai `COMMENT` di database - sehingga fungsi baru tidak dapat masuk tanpa penulisnya membuka
lampiran ini. Ia tidak membaca dokumen normatif dan tidak bergantung pada data seed, sehingga
dapat dijalankan terhadap database produk mana pun yang memasang baseline. Penjaganya diuji: 13
mutasi (fungsi tak terdaftar, nomor salah, entri belum-ada yang tiba-tiba ada, pemilik fungsi
berubah, `search_path` dilepas, policy baru, kolom tambahan, grant tingkat tabel, tabel
ber-`tenant_id` tanpa RLS, RLS tanpa FORCE, `BYPASSRLS`, keanggotaan role), 13 tertangkap oleh
kasus yang memang menjaganya (`app/mutations/register.sh`).

1. `app_user` pada setiap tabel §4 tanpa `app.current_tenant_id` → 0 baris / insert ditolak.
2. Setiap fungsi §3 dipanggil tanpa tenant context → mengembalikan data yang benar (membuktikan Opsi A bekerja).
3. `app_user` tidak dapat `SET ROLE app_auth_definer`; `app_auth_definer` tidak dapat login; tidak ada role runtime/auth dengan `rolbypassrls = true`.
4. Tidak ada fungsi `SECURITY DEFINER` di database yang tidak tercantum di §3; tidak ada policy `TO app_auth_definer` yang tidak tercantum di §4.
5. Test negatif per baris §3.
6. Fungsi tidak memuat `EXECUTE` dinamis (inspeksi `prosrc`) dan `proconfig` memuat `search_path`.

## Riwayat

| Edisi | Tanggal | Ringkasan |
|---|---|---|
| 2.0 | 2026-09-16 | Konsolidasi final ADR-001 v1.3, ADR-002 v1.1, ADR-003 v1.1, dan register v1.0 ke satu dokumen; penanda revisi dihapus; riwayat lengkap di `README.md` §5 dan `_archive/` |
| 2.1 | 2026-09-22 | Lampiran A: F-16 `auth.create_identity_for_invitation` ditambahkan; F-11 dan F-12 diselaraskan dengan implementasi demo (input hash token, output `identity_hint`, penolakan membership non-aktif dan tenant tidak aktif); §4 menambah INSERT `users`/`credentials` dan mempersempit policy `tenant_memberships`/`user_invitations`. ADR-002 §2.2: penanda `is_owner` sementara sampai RBAC. Keputusan pemilik proyek; review Security pending |
| 2.2 | 2026-09-22 | Penanda sementara `is_owner` dihapus setelah RBAC demo (permission `members.invite`); Lampiran A §4 `tenant_memberships` INSERT kembali `WITH CHECK (status = 'ACTIVE')`; ADR-002 §2.2 catatan implementasi diperbarui. Tidak ada fungsi register baru: resolver permission berjalan di context tenant di bawah RLS. Keputusan pemilik proyek |
| 2.3 | 2026-09-22 | Lampiran A: F-12 memberi role dari `invitation_roles` secara atomik (DEMO-0309); role yang diarsipkan sebelum undangan diterima dilewati; §4 menambah SELECT `roles` dan SELECT/INSERT `user_role_assignments` untuk `app_auth_definer`, serta kolom `invited_by_membership_id` pada SELECT `user_invitations`. ADR-002 §2.2 catatan implementasi diperbarui. Keputusan pemilik proyek; review Security pending |
| 2.3 (editorial) | 2026-09-22 | Contoh nama event di ADR-001 (jalur tulis lintas context) diselaraskan dengan konvensi Demo Foundation 2.4 §15 (`auth.login` + outcome). Isi normatif tidak berubah |
| 2.10 | 2026-09-29 | ADR-002 §2.3a baru: pengecualian terkontrol yang mengizinkan platform membuat membership owner PERTAMA sebuah tenant baru secara langsung (keputusan pemilik proyek), beserta lima batas yang ditegakkan database lewat F-28 dan risiko yang diterima secara sadar. Lampiran A menambah F-26 `create_tenant_key`, F-27 `provision_tenant_roles`, F-28 `provision_tenant_owner`; §4 menambah INSERT `crypto_keys`, INSERT `roles`/`role_permissions`, SELECT `permissions`, SELECT template role, dan mencatat `code`/`is_system` masuk daftar kolom SELECT `roles`. Keputusan pemilik proyek (fondasi langkah 3, D-17 dan D-25); review Security pending |
| 2.9 | 2026-09-28 | ADR-001 §3.11 baru: baseline ditetapkan sebagai fondasi beberapa produk dengan database masing-masing (keputusan pemilik proyek). Konsekuensi yang langsung mengikat: ledger migrasi ber-`component` wajib ada (migrasi 0001b), dan test register wajib dapat dijalankan terhadap database produk mana pun. Lima keputusan yang belum diambil dicatat eksplisit sebagai open decision - identitas lintas produk, audit lintas produk, namespace permission per komponen, entitlement modul per tenant, dan cara distribusi baseline - supaya tidak terbentuk diam-diam oleh kode. Review Security pending |
| 2.8 | 2026-09-28 | Lampiran A dibuat DAPAT DITEGAKKAN, dan sembilan penyimpangan yang ditemukannya dicatat: F-21 `find_session`, F-22 `find_membership`, F-23 `create_refresh_token`, F-24 `get_active_key`, F-25 `get_key_version` didaftarkan setelah berjalan tanpa terdaftar sejak slice 2/5/8; §4 menambah baris `crypto_keys` (DEK terbungkus - luput dari register sejak slice 8), mempersempit kolom SELECT `audit_logs`, dan menyatakan grant WAJIB per kolom setelah empat tabel ditemukan ber-grant tingkat tabel; F-01, F-03, F-08 ditandai belum ada beserta sebabnya; §5 mencatat test inspeksi skema yang dituntut sejak edisi pertama kini benar-benar ada (`api/test/register.test.ts`, `db/register.json`, migrasi 0022). Keputusan pemilik proyek (fondasi produk sungguhan, langkah 1); review Security pending |
| 2.7 | 2026-09-28 | Lampiran A: F-20 `auth.menus_assert_hierarchy()` (penjaga hierarki menu, migrasi 0021) didaftarkan beserta policy SELECT `menus` `TO app_auth_definer` dan grant kolomnya; §1 dipertegas bahwa register memuat SELURUH fungsi `SECURITY DEFINER`, bukan hanya pre/cross-context — batasnya test §5 butir 4. Keputusan pemilik proyek (DEMO-0409 Bagian A); review Security pending |
| 2.6 | 2026-09-27 | ADR-003 §2.4: `reason_text` memakai **DEK PLATFORM** (purpose `platform_support_reason`), bukan DEK tenant - penulisnya berjalan di context platform dan slice 8 hanya menyerahkan kunci tenant di dalam context tenant pemiliknya; kolom `platform_session_id`, `ended_by`, `reason_text_key_version`, dan `UNIQUE (tenant_id, id)` dicatat; §6 menutup tiga keputusan terbuka (daftar `reason_code` + pemetaan scope, isi `SUPPORT_READ_SET`/`SUPPORT_WRITE_SET` beserta `SUPPORT_MUTATION_SET`, durasi maksimum 60 menit) dan menyisakan idle timeout; Lampiran A menambah F-18 `auth.find_support_session` dan F-19 `auth.end_support_sessions_for_platform_session`, serta §4 mencatat grant kolom `support_sessions`. Keputusan pemilik proyek (slice 14, DEMO-0312); review Security pending |
| 2.5 | 2026-09-26 | Lampiran A: F-15 dicatat sesuai implementasi (`auth.notify_tenant_security_event`; schema `audit_w` tidak pernah ada di database dan rujukannya di ADR-003 sec.2.2/sec.2.3 serta Lampiran A sec.2 dihapus); F-04 mengembalikan context PLATFORM sebagai BARIS, bukan flag; F-07 menolak membership yang bukan milik pemakainya dan context PLATFORM tanpa role platform, dengan pembagian eksplisit batas orang (fungsi) dan batas tenant (composite FK); sec.4 mempersempit kolom INSERT `tenant_notifications`. Edisi di frontmatter ikut dikoreksi: sejak D-30 Riwayat dan README sudah 2.4 sementara frontmatter tertinggal di 2.3. Keputusan pemilik proyek (slice 13, DEMO-0311 dan DEMO-0313); review Security pending |
| 2.4 | 2026-09-23 | Lampiran A: F-14 dicatat sesuai implementasi (`auth.write_audit_event`, tanda tangan penuh); allowlist nama event ditegakkan katalog `audit_event_types` + foreign key, bukan daftar di badan fungsi; F-17 `auth.count_recent_failures` (penghitung kegagalan untuk rate limiting) didaftarkan - sebelumnya berjalan tanpa tercatat sejak slice 6; §4 `audit_logs` menambah SELECT yang dipakai F-17. Keputusan pemilik proyek (D-30); review Security pending |
