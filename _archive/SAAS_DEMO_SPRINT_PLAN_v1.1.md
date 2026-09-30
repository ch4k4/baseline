---
title: "SaaS Demo Sprint Plan"
document_id: "SAAS-DEMO-SPRINT-PLAN"
version: "1.1"
status: "SUPERSEDED"
original_status: "Proposed Delivery Baseline / Ready for Team Refinement after ADR Review"
superseded_by: "SAAS_DEMO_SPRINT_PLAN_v1.3.md"
superseded_date: "2026-09-16"
supersedes: "SAAS_DEMO_SPRINT_PLAN_v1.0.md"
owner: "<PRODUCT_OWNER_PLACEHOLDER>"
delivery_lead: "<DELIVERY_LEAD_PLACEHOLDER>"
technical_lead: "<TECHNICAL_LEAD_PLACEHOLDER>"
last_updated: "2026-09-16"
delivery_scope: "SaaS demo foundation without business-domain features"
timebox_assumption: "Six delivery milestones (Sprint 0–5); calendar duration derived from measured velocity (§2.2), not fixed at one week"
parent_documents:
  - "SAAS_DEMO_FOUNDATION_SSOT_v1.1.md"
  - "INFRASTRUCTURE_SSOT_v1.3.md"
  - "GENERAL_FEATURE_BASE_SSOT_v1.3.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md"
  - "ADR-001-SAAS-MULTI-TENANCY_v1.1.md"
  - "ADR-002-IDENTITY-MODEL_v1.0.md"
review_reference: "REVIEW_BASELINE_DOCS_2026-09-16.md"
change_control: "Scope, security boundary, sprint exit gate, or acceptance criteria changes MUST be reflected here and reconciled with the parent SSOT before implementation."
---

> ⚠️ **SUPERSEDED — ARSIP, BUKAN DOKUMEN AKTIF.**
> Versi berlaku: [`SAAS_DEMO_SPRINT_PLAN_v1.3.md`](./SAAS_DEMO_SPRINT_PLAN_v1.3.md). Lihat `DOCUMENT_VERSION_INDEX.md`.
> Isi dan referensi versi di bawah bersifat historis dan **tidak boleh** dijadikan dasar implementasi, ticket, atau review.

# SaaS Demo Sprint Plan v1.1

> **Perubahan v1.1:** timebox tidak lagi dipatok satu minggu; durasi dihitung dari velocity (§2.2). Ditambahkan DEMO-0010 (keputusan KMS/demo key), DEMO-0100 (spike Prisma+RLS go/no-go), DEMO-0109 (pre-context functions), DEMO-0110 (audit schema & writer), DEMO-0210 (invitation). DEMO-0105 dipecah. Dependensi DEMO-0104 diperbaiki. DEMO-0004 menjadi scaffold tanpa integrasi API. User administration diganti member administration (ADR-002). Menu administration CRUD (0404, 0406) turun ke P2. DEMO-0504 dipecah dengan estimasi. Risk register menambahkan risiko approval seremonial.

## 1. Purpose

Dokumen ini mengubah SaaS Demo Foundation SSOT menjadi delivery backlog yang dapat dikerjakan dan diverifikasi. Scope hanya mencakup:

```text
Login + Refresh + Logout + Profile
+ SaaS tenant isolation
+ Members, Invitations, Roles, and Permissions
+ Dynamic menu
+ Session and audit
+ Security/E2E demo readiness
```

Tidak ada fitur bisnis dalam sprint plan ini.

## 2. Planning assumptions

- Enam sprint diperlakukan sebagai **milestone berurutan**; satu milestone dapat memakan lebih dari satu timebox kalender sesuai velocity (§2.2).
- Estimasi memakai story point relatif, bukan komitmen jam kerja.
- Capacity aktual, komposisi tim, dan velocity belum diketahui; commitment final dilakukan saat sprint planning.
- Story berisiko tinggi dapat di-split tanpa mengurangi acceptance criteria atau security control.
- Stack mengikuti Infrastructure SSOT: Next.js, NestJS, Prisma, PostgreSQL, TypeScript, dan npm.
- Demo tetap memakai modular monolith dan satu repository dengan frontend/backend terpisah.
- Environment demo menggunakan synthetic data saja.
- Security, tenant isolation, dan backend authorization tidak boleh ditunda sebagai pekerjaan setelah demo.

### 2.1 Suggested delivery roles

| Role | Responsibility |
|---|---|
| Product Owner | Scope, priority, acceptance, dan demo outcome |
| Technical Lead | Architecture consistency, review, integration decision |
| Backend Engineer | NestJS, Prisma, PostgreSQL, authentication, RBAC, audit |
| Frontend Engineer | Next.js pages, state, accessibility, dynamic navigation |
| QA/Test Engineer | Test design, API/E2E, evidence, regression |
| Security Reviewer | Tenant isolation, encryption, auth/session, log leakage |
| Operations/DevOps | Environment, CI, secrets, database, deployment readiness |

Satu orang boleh merangkap beberapa role, tetapi approval boundary tetap dicatat secara eksplisit.

**Aturan v1.1 untuk tim kecil/solo:** jika pembuat pekerjaan dan reviewer Security/Operations adalah orang yang sama, approval dicatat sebagai **self-review** dengan risk acceptance eksplisit pada approval record, dan dinyatakan tidak setara dengan independent review. Review independen (eksternal atau rekan) wajib dijadwalkan sebelum data nyata/production.

### 2.2 Capacity model (baru v1.1)

v1.0 memuat 338 point dalam enam sprint satu minggu (±56 point/minggu) tanpa velocity terukur. v1.1 menghitung durasi dari velocity aktual.

| Milestone | P0/P1 point | P2 point |
|---|---:|---:|
| Sprint 0 | 40 | 0 |
| Sprint 1 | 76 | 0 |
| Sprint 2 | 71 | 0 |
| Sprint 3 | 61 | 0 |
| Sprint 4 | 42 | 16 |
| Sprint 5 | 67 | 0 |
| **Total** | **357** | **16** |

Durasi indikatif P0/P1 (tanpa buffer):

| Velocity terukur (point/minggu) | Perkiraan durasi |
|---:|---:|
| 15 | ±24 minggu |
| 25 | ±14 minggu |
| 40 | ±9 minggu |

Aturan:

- velocity diukur pada dua timebox pertama (Sprint 0 dan awal Sprint 1), lalu tabel ini diperbarui;
- tambahkan buffer minimal 20% untuk story security/database berketidakpastian tinggi;
- target demo date ditetapkan **setelah** velocity terukur, bukan sebelumnya;
- P2 hanya diambil setelah exit gate Sprint 5 lulus.

## 3. Sprint roadmap

| Sprint | Goal | Primary outcome | Exit dependency |
|---|---|---|---|
| Sprint 0 | Environment dan project foundation | Reproducible frontend/backend/database foundation | Semua sprint berikutnya |
| Sprint 1 | Tenant, database, RLS, dan encryption | Verified two-tenant isolation and encrypted identity pattern | Sprint 2–5 |
| Sprint 2 | Login, session, refresh, logout, dan profile | Complete authenticated session lifecycle | Sprint 3–5 |
| Sprint 3 | Members, roles, dan permissions | Backend-enforced tenant-scoped RBAC | Sprint 4–5 |
| Sprint 4 | Dynamic menu dan navigation | Permission-derived navigation (menu admin CRUD = P2) | Sprint 5 |
| Sprint 5 | Audit, security testing, E2E, dan demo readiness | Repeatable, evidence-backed demo release candidate | Demo acceptance |

## 4. Backlog conventions

### 4.1 Priority

- **P0**: wajib untuk sprint goal dan tidak dapat ditunda.
- **P1**: wajib untuk demo release, tetapi dapat dipindahkan selama dependency aman.
- **P2**: enhancement; tidak boleh mengganggu P0/P1.

### 4.2 Estimate

Story point menggunakan skala:

```text
1 = trivial, verified change
2 = small
3 = moderate
5 = substantial
8 = complex/high uncertainty
13 = too large; MUST be split during refinement
```

### 4.3 Status

```text
BACKLOG -> READY -> IN_PROGRESS -> REVIEW -> VERIFY -> DONE
```

Blocked work tetap berada pada status aktual dengan blocker, owner, dan next action yang tercatat.

## 5. Global Definition of Ready

Story dapat masuk sprint jika:

- tujuan dan user/business value jelas;
- scope serta out-of-scope tertulis;
- acceptance criteria dapat diuji;
- permission dan tenant scope telah ditentukan;
- schema/API/UI impact teridentifikasi;
- data classification dan encryption requirement ditentukan;
- dependency dan migration impact diketahui;
- test approach dan required evidence tersedia;
- tidak ada unresolved decision yang mengubah architecture boundary;
- estimate disepakati tim.

Story security/database yang tidak memenuhi kondisi ini tidak boleh dimulai hanya berdasarkan asumsi developer.

## 6. Global Definition of Done

Setiap story hanya DONE jika:

1. implementation memenuhi acceptance criteria dan parent SSOT;
2. code review selesai;
3. build, lint, type check, dan relevant automated tests lulus;
4. migration dapat dijalankan dari clean baseline jika schema berubah;
5. backend authorization dan tenant scope diuji jika applicable;
6. OpenAPI/API contract diperbarui jika endpoint berubah;
7. loading, error, empty, forbidden, conflict, dan success state tersedia jika UI applicable;
8. log/audit tidak membocorkan credential atau personal plaintext;
9. documentation dan `.env.example` diperbarui;
10. test evidence ditautkan ke story/commit;
11. tidak ada unresolved critical/high defect;
12. Product Owner menerima behavior demo, tanpa mengimplikasikan specialist approval di luar kewenangannya.

## 7. Sprint 0 — Environment dan project foundation

### 7.1 Sprint goal

Membuat foundation yang reproducible agar frontend, backend, database, migration, test, dan CI dapat dijalankan engineer lain tanpa konfigurasi tersembunyi.

### 7.2 Sprint backlog

| ID | Story | Priority | Estimate | Depends on |
|---|---|---:|---:|---|
| DEMO-0001 | Validate machine/runtime baseline | P0 | 2 | — |
| DEMO-0002 | Initialize repository structure | P0 | 3 | 0001 |
| DEMO-0003 | Bootstrap NestJS backend | P0 | 5 | 0002 |
| DEMO-0004 | Scaffold Next.js frontend (tanpa integrasi API) | P0 | 5 | 0002 |
| DEMO-0005 | Provision PostgreSQL local database and roles | P0 | 5 | 0001 |
| DEMO-0006 | Establish Prisma migration pipeline | P0 | 5 | 0003, 0005 |
| DEMO-0007 | Implement shared API/error/logging baseline | P0 | 5 | 0003 |
| DEMO-0008 | Establish automated quality gates | P0 | 5 | 0003, 0004 |
| DEMO-0009 | Create environment templates and developer runbook | P1 | 3 | 0002–0008 |
| DEMO-0010 | Record KMS/demo key decision | P0 | 2 | 0001 |

Estimated sprint backlog: **40 points** before team refinement. Split/capacity adjustment is expected.

### DEMO-0001 — Validate machine/runtime baseline

As an engineer, I want the exact runtime tools verified so that setup does not depend on ambiguous installations.

Acceptance criteria:

- Node 24.x, npm, PostgreSQL 18.x client/server, dan Git terdeteksi.
- Executable path dicatat dan tidak ambigu.
- Port 3000, 4000, dan 5432 diperiksa.
- Actual versions direkam sebagai sprint evidence.
- Deviation dari Infrastructure SSOT menjadi explicit blocker/decision.

Evidence:

```text
environment-version output
executable-path output
port baseline output
```

### DEMO-0002 — Initialize repository structure

Acceptance criteria:

- Root mempunyai `frontend/`, `backend/`, `docs/`, dan `scripts/`.
- Frontend/backend memiliki `package.json` dan `package-lock.json` masing-masing.
- `.gitignore` melindungi `.env`, build output, log, dan dependency folders.
- No Nx/Turborepo/microservice tooling ditambahkan.
- README menunjuk SSOT yang berlaku.

### DEMO-0003 — Bootstrap NestJS backend

Acceptance criteria:

- NestJS berjalan pada port 4000 menggunakan ESM.
- API prefix `/api/v1` aktif.
- `GET /api/v1/health` menghasilkan HTTP 200.
- Swagger development tersedia pada `/docs`.
- Global validation, exception filter, dan request ID foundation tersedia.
- Backend build/lint/test lulus.
- (v1.1) Compatibility check NestJS 12 terhadap `@nestjs/swagger`, `@nestjs/throttler`, `@nestjs/jwt`/passport, `@nestjs/config`, dan library pihak ketiga yang dipilih; hasil dicatat. Blocker memicu change control fallback NestJS 11 (Infrastructure SSOT v1.3 §4.2).

### DEMO-0004 — Scaffold Next.js frontend (tanpa integrasi API)

Scope v1.1: scaffold dan quality gate saja, sesuai klarifikasi Infrastructure SSOT v1.3 §2. Integrasi API dimulai pada DEMO-0208.

Acceptance criteria:

- Next.js `>= 16.3.3` berjalan pada port 3000 menggunakan App Router dan TypeScript; dev server hanya bind ke localhost.
- Application shell, global error boundary, loading state, dan not-found page tersedia.
- API base URL hanya berasal dari approved frontend environment variable.
- Tidak ada Prisma, database URL, atau server secret pada frontend.
- Frontend build/lint lulus.

### DEMO-0005 — Provision PostgreSQL local database and roles

Acceptance criteria:

- `app_db`, `app_owner` (migration), `app_auth_definer` (`NOLOGIN`, owner fungsi pre-context), dan `app_user` (runtime) tersedia.
- Runtime role bukan superuser, bukan database/table owner, dan tanpa `BYPASSRLS`.
- PostgreSQL hanya accessible sesuai local network baseline.
- Connection verification mencatat database dan current user yang benar.
- Credential hanya berada pada local secret/environment mechanism.

### DEMO-0006 — Establish Prisma migration pipeline

Acceptance criteria:

- Prisma 7 dikonfigurasi untuk PostgreSQL/ESM sesuai parent SSOT.
- Blank/initial migration dapat dijalankan dari database bersih.
- Migration dan runtime memakai identity/privilege berbeda.
- Migration status dapat diperiksa.
- Rollback/mitigation pattern terdokumentasi.
- Detail adapter/version diverifikasi terhadap dokumentasi versi yang digunakan.

### DEMO-0007 — Implement shared API/error/logging baseline

Acceptance criteria:

- Response/error convention konsisten.
- Validation error tidak mengekspos internal stack/database detail.
- Structured log mempunyai timestamp, level, request ID, method, route, status, dan duration.
- Authorization header, cookie, password, token, dan sensitive body di-redact.
- `X-Request-ID` diterima atau dibuat backend dan diteruskan ke response/log.

### DEMO-0008 — Establish automated quality gates

Acceptance criteria:

- Backend/frontend build, lint, type check, dan test commands tersedia.
- CI menjalankan clean install dari lockfile.
- Failing command menggagalkan pipeline.
- Migration validation test berjalan dengan disposable/isolated database.
- Secret/source scan baseline tersedia.

### DEMO-0009 — Create environment templates and developer runbook

Acceptance criteria:

- Backend dan frontend `.env.example` lengkap tanpa secret asli.
- Runbook mencakup install, database setup, migration, seed placeholder, run, test, dan troubleshooting port.
- Engineer lain dapat menjalankan health API dan frontend dari clean checkout.

### DEMO-0010 — Record KMS/demo key decision (baru v1.1)

Acceptance criteria:

- Keputusan demo key mechanism (Data Protection SSOT v1.1 §9.2 opsi C atau A-dev) tercatat.
- Rencana production (opsi A atau B) memiliki owner dan tenggat keputusan sebelum crypto adapter dibekukan.
- Interface crypto adapter tidak bergantung pada opsi yang dipilih.
- Tidak ada key material di repository.

### 7.3 Sprint 0 exit gate

- Health API dan frontend dapat dijalankan bersamaan.
- PostgreSQL dapat diakses restricted runtime role.
- Migration pipeline lulus dari clean database.
- Automated quality gates hijau.
- Tidak ada secret di repository.
- Environment evidence dan runbook tersedia.

## 8. Sprint 1 — Tenant, database, RLS, dan encryption

### 8.1 Sprint goal

Membuktikan isolation dua tenant pada database serta menyediakan pattern encryption untuk global identity dan tenant-owned data sebelum authentication/domain table berkembang.

### 8.2 Sprint backlog

| ID | Story | Priority | Estimate | Depends on |
|---|---|---:|---:|---|
| DEMO-0100 | Spike: Prisma 7 + RLS + pool reuse (go/no-go) | P0 | 5 | Sprint 0 |
| DEMO-0101 | Implement tenant, membership, profile, invitation schema | P0 | 8 | 0100 |
| DEMO-0102 | Implement runtime tenant context & unit-of-work wrapper | P0 | 8 | 0100, 0101 |
| DEMO-0103 | Implement PostgreSQL RLS policies (tenant-owned + mixed-ownership) | P0 | 8 | 0101, 0102 |
| DEMO-0104 | Implement global user/credential schema | P0 | 5 | 0101, 0105A |
| DEMO-0105A | Implement crypto adapter and demo key source | P0 | 8 | 0010 |
| DEMO-0105B | Implement blind index and Data Field Register | P0 | 5 | 0105A |
| DEMO-0106 | Build idempotent tenant provisioning | P0 | 5 | 0101, 0103, 0110 |
| DEMO-0107 | Seed two isolated tenants | P0 | 3 | 0106 |
| DEMO-0108 | Automate cross-tenant database tests | P0 | 8 | 0103, 0107, 0109 |
| DEMO-0109 | Implement pre-context functions and register | P0 | 8 | 0103, 0104 |
| DEMO-0110 | Implement audit_logs schema and audit writer | P0 | 5 | 0103 |

Estimated sprint backlog: **76 points** before refinement; stories dapat diparalelkan hanya setelah DEMO-0100 lulus dan kontrak disepakati. Milestone ini diperkirakan memakan lebih dari satu timebox.

### DEMO-0100 — Spike: Prisma 7 + RLS + pool reuse (baru v1.1)

Timebox: maksimal 5 point / ditetapkan saat planning. Hasil: keputusan GO/NO-GO tertulis.

Acceptance criteria:

- Tabel contoh tenant-owned dengan `ENABLE`/`FORCE` RLS dibuat via SQL migration dan terdeteksi oleh schema inspection test.
- Interactive transaction dengan `set_config(..., true)` sebagai statement pertama membaca/menulis hanya baris tenant yang benar.
- Query tanpa context mengembalikan 0 baris / insert ditolak.
- Load test konkuren (misalnya ≥ 200 request bergantian dua tenant pada pool kecil) tidak menunjukkan kebocoran context.
- Transaksi multi-langkah (simulasi refresh rotation) bekerja dalam satu unit of work; perilaku timeout dicatat.
- `prisma migrate` drift behavior terhadap objek SQL manual dicatat beserta mitigasinya.
- Satu fungsi `SECURITY DEFINER` contoh dapat dipanggil `app_user` tanpa membuka tabel lain.
- NO-GO memicu revisi ADR-001 §3.9 sebelum story lain dimulai.

### DEMO-0101 — Implement tenant and membership schema

Acceptance criteria:

- `tenants`, `tenant_domains`, `tenant_memberships`, `tenant_member_profiles`, dan `user_invitations` mempunyai versioned migration.
- Tenant lifecycle minimum: `PROVISIONING`, `ACTIVE`, `SUSPENDED`, `ARCHIVED`.
- Membership unique pada `(tenant_id, user_id)`.
- Tenant-safe indexes dan foreign keys ditinjau.
- Platform-global, tenant-owned, dan mixed-ownership tables terdaftar sesuai Infrastructure SSOT v1.3 §8.3.

### DEMO-0102 — Implement runtime tenant context

Acceptance criteria:

- NestJS mempunyai request-scoped `TenantContext` abstraction dan unit-of-work wrapper sesuai hasil DEMO-0100.
- Repository tenant-owned hanya menerima transaction client dari wrapper; test/lint mendeteksi pemakaian Prisma client global.
- Client-provided arbitrary `tenant_id` tidak menjadi authority.
- Context berasal dari verified session/membership contract; pre-auth test harness boleh memakai trusted internal fixture.
- Tenant-owned repository menolak operasi tanpa context.
- Transaction menetapkan PostgreSQL context secara local pada connection/transaction yang sama.

### DEMO-0103 — Implement PostgreSQL RLS policies

Acceptance criteria:

- Seluruh tenant-owned dan mixed-ownership table mengaktifkan `ENABLE` dan `FORCE ROW LEVEL SECURITY`.
- Mixed-ownership policy (ADR-001 §3.8): tenant tidak menulis baris platform; context platform tidak membaca tenant-owned table.
- Schema inspection test (`pg_policies`, `relforcerowsecurity`, grant) berjalan di CI.
- Policy mempunyai `USING` dan `WITH CHECK` tenant condition.
- Runtime role bukan owner dan tidak mempunyai `BYPASSRLS`.
- Read/write tanpa tenant context ditolak.
- Known ID tenant lain tidak dapat dibaca atau dimutasi.
- Connection-pool reuse tidak membawa context tenant sebelumnya.

### DEMO-0104 — Implement global user/credential schema

Acceptance criteria:

- `users` adalah platform-global identity dan tenant access hanya melalui active membership.
- Credential berada pada table/service boundary terpisah.
- Password field hanya menerima approved adaptive hash.
- Email/legal name tidak tersedia sebagai plaintext column.
- `app_user` tidak memiliki grant SELECT/UPDATE langsung ke `users` dan `credentials`; akses melalui identity service/function.
- User lifecycle minimum: `ACTIVE`, `SUSPENDED`, `LOCKED`, `ARCHIVED`.

### DEMO-0105A — Implement crypto adapter and demo key source

Acceptance criteria:

- Dedicated crypto adapter menggunakan authenticated field encryption baseline (AES-256-GCM, envelope).
- Key purpose `platform_identity` untuk identitas global dan DEK tenant per purpose untuk data tenant-owned (Data Protection SSOT v1.1 §9.1).
- Same plaintext menghasilkan ciphertext berbeda.
- Wrong AAD/key/tenant context gagal decryption (fail-closed).
- Key/ciphertext/plaintext tidak masuk log.
- Demo key source sesuai DEMO-0010, terisolasi, terdokumentasi, dan tidak berada dalam source control.

### DEMO-0105B — Implement blind index and Data Field Register

Acceptance criteria:

- Email mempunyai normalized keyed blind index global (`platform_identity_blind_index`) untuk login dan tenant-scoped blind index untuk undangan.
- Blind index key terpisah dari encryption key.
- Data Field Register minimum tersedia untuk `users.email`, `users.legal_name`, `tenant_member_profiles.display_name`, `user_invitations.email`, credential, token, invitation token, session, dan audit identifiers, termasuk `processing_role` dan `information_label`.
- Migration review gagal bila field personal baru belum terdaftar.

### DEMO-0106 — Build idempotent tenant provisioning

Acceptance criteria:

- Provisioning membuat tenant, owner membership placeholder, default roles/settings yang diperlukan demo, dan audit event melalui audit writer (DEMO-0110). Organization tidak dibuat pada demo (Demo Foundation v1.1 §2.2).
- Repeated request/idempotency key tidak menghasilkan duplicate tenant.
- Failure tidak meninggalkan tenant `ACTIVE` yang belum lengkap.
- Suspended tenant tidak dapat digunakan sebagai runtime context.

### DEMO-0107 — Seed two isolated tenants

Acceptance criteria:

- Tenant Alpha dan Tenant Beta dibuat deterministically.
- Seed dapat dijalankan ulang tanpa duplikasi.
- Seed hanya aktif pada approved development/demo environment.
- No real personal data atau committed production credential digunakan.

### DEMO-0108 — Automate cross-tenant database tests

Acceptance criteria:

- Test mencakup read, insert, update, delete, dan foreign-key relation.
- Test menggunakan dua tenant dan known resource IDs.
- Missing tenant context dan wrong tenant context ditolak.
- Runtime role privilege diinspeksi dalam test/evidence.
- RLS policy coverage dapat ditelusuri ke seluruh tenant-owned dan mixed-ownership table.
- Pre-context function negative tests (DEMO-0109) termasuk dalam suite.

### DEMO-0109 — Implement pre-context functions and register (baru v1.1)

Acceptance criteria:

- Fungsi sesuai ADR-001 §3.7 tersedia: resolve tenant by host, list active memberships, find/rotate/revoke refresh token, pre-context audit writer, identity lookup, accept invitation.
- Fungsi dimiliki `app_auth_definer`, `search_path` terkunci, tanpa dynamic SQL, output minimum.
- `app_user` hanya memiliki `EXECUTE`.
- `docs/registers/PRE_CONTEXT_FUNCTIONS.md` mencatat owner, alasan, input/output, dan test.
- Test negatif: hash salah, user_id acak, host tidak terverifikasi, tenant suspended, token tenant lain — tidak mengembalikan data dan tidak membedakan kasus secara informatif.

### DEMO-0110 — Implement audit_logs schema and audit writer (baru v1.1)

Acceptance criteria:

- `audit_logs` sesuai Demo Foundation v1.1 §7.3 dengan mixed-ownership policy.
- `UPDATE`/`DELETE` di-revoke dari `app_user`.
- Audit writer tenant-context dan pre-context writer tersedia dan dipakai provisioning.
- Payload divalidasi agar tidak memuat password, token, email, nama, atau raw personal diff.

### 8.3 Sprint 1 exit gate

- Two-tenant schema dan seed tersedia.
- Tenant-context dan RLS negative tests lulus.
- User identity fields encrypted dan lookup email bekerja melalui blind index.
- DEMO-0100 berstatus GO; pre-context functions dan audit writer lulus test negatif.
- Restricted runtime role terbukti tidak dapat bypass RLS.
- Clean migration dan seed replay lulus.

## 9. Sprint 2 — Login, session, refresh, logout, dan profile

### 9.1 Sprint goal

Menyelesaikan lifecycle authentication end-to-end dengan tenant selection, rotating refresh token, server-side revocation, dan profile minimal.

### 9.2 Sprint backlog

| ID | Story | Priority | Estimate | Depends on |
|---|---|---:|---:|---|
| DEMO-0201 | Implement demo identity provisioning | P0 | 5 | Sprint 1 |
| DEMO-0202 | Implement login API | P0 | 8 | 0201 |
| DEMO-0203 | Implement session and token persistence | P0 | 8 | 0202 |
| DEMO-0204 | Implement refresh rotation and reuse detection | P0 | 8 | 0203 |
| DEMO-0205 | Implement logout and revocation | P0 | 5 | 0203, 0204 |
| DEMO-0206 | Implement current profile API | P0 | 5 | 0202 |
| DEMO-0207 | Implement tenant list and switch | P0 | 8 | 0202, 0203 |
| DEMO-0208 | Implement login/select-tenant/profile UI | P0 | 8 | 0202, 0206, 0207 |
| DEMO-0209 | Automate authentication lifecycle tests | P0 | 8 | 0202–0208, 0210 |
| DEMO-0210 | Implement invitation API and acceptance flow | P0 | 8 | 0201, 0203 |

Estimated sprint backlog: **71 points** before refinement.

### DEMO-0201 — Implement demo identity provisioning

Acceptance criteria:

- Synthetic users sesuai Demo Foundation dapat dibuat tanpa committed plaintext password.
- Password disimpan sebagai adaptive salted hash.
- Membership dan `tenant_member_profiles` untuk single-tenant dan multi-tenant user tersedia melalui provisioning service khusus demo (bukan API tenant).
- Minimal satu undangan `PENDING` di Tenant Alpha; token dikeluarkan melalui demo provisioning channel.
- User/tenant/membership status dapat digunakan test fixture.

### DEMO-0202 — Implement login API

Acceptance criteria:

- `POST /api/v1/auth/login` mempunyai validated DTO dan OpenAPI contract.
- Email dinormalisasi dan dicari melalui blind index menggunakan identity lookup function; membership dibaca melalui `auth.list_active_memberships`.
- Password verification memakai constant-work path saat user tidak ditemukan.
- Invalid user/password menghasilkan generic response.
- Suspended/locked identity atau tenant tidak memperoleh session.
- Rate limiting/backoff baseline aktif.
- Login success/failure menghasilkan safe audit event.

### DEMO-0203 — Implement session and token persistence

Acceptance criteria:

- Session terikat user, tenant, dan active membership.
- Access token berumur pendek dan mempunyai signed tenant/session claims minimum.
- Refresh token raw hanya dikirim ke client dan database menyimpan keyed hash.
- Cookie/token delivery strategy didokumentasikan dan security flags sesuai environment.
- Session dapat dicabut server-side.

### DEMO-0204 — Implement refresh rotation and reuse detection

Acceptance criteria:

- `POST /api/v1/auth/refresh` memutar refresh token pada setiap penggunaan melalui `auth.find_refresh_token` dan `auth.rotate_refresh_token` (atomik).
- Replaced token tidak dapat digunakan lagi.
- Reuse detection mencabut token family/session dan menghasilkan security audit.
- Expired, revoked, wrong-tenant, atau suspended-membership refresh ditolak.
- Concurrent refresh behavior diuji dan tidak menghasilkan dua active successor secara tidak terkendali.

### DEMO-0205 — Implement logout and revocation

Acceptance criteria:

- `POST /api/v1/auth/logout` mencabut session dan refresh-token family.
- Protected cookie/browser token state dibersihkan.
- Refresh dan protected request setelah logout ditolak.
- Logout idempotent dan menghasilkan safe audit event.

### DEMO-0206 — Implement current profile API

Acceptance criteria:

- `GET /api/v1/me` hanya mengembalikan identity/session aktif.
- Profile minimal: display name tenant, masked/read-only email, tenant, membership status, roles summary.
- Personal fields didekripsi hanya setelah authorization.
- Response tidak mengandung password/token/internal crypto metadata.
- `PATCH /api/v1/me/profile` hanya memperbarui `display_name` pada `tenant_member_profiles` tenant aktif.

### DEMO-0207 — Implement tenant list and switch

Acceptance criteria:

- `GET /api/v1/me/tenants` hanya mengembalikan active memberships.
- Tenant switch menolak tenant tanpa active membership.
- Switch menghasilkan tenant context/access session baru sesuai chosen strategy.
- Resource dari tenant lama tidak dapat digunakan setelah switch.
- Switch menghasilkan audit event.

### DEMO-0208 — Implement login/select-tenant/profile UI

Acceptance criteria:

- Login mempunyai accessible validation dan generic auth failure.
- Multi-membership user diarahkan ke tenant selection.
- Active tenant selalu terlihat pada authenticated shell.
- Profile mempunyai loading, error, forbidden, dan success states.
- Personal data/token tidak disimpan di URL, console, analytics, atau persistent browser storage yang tidak disetujui.

### DEMO-0209 — Automate authentication lifecycle tests

Acceptance criteria:

- Valid/invalid login, lock/suspend, expiry, refresh rotation, reuse, logout, and tenant switch tests tersedia.
- API test menggunakan cookie/token behavior yang sama dengan frontend.
- Log capture membuktikan tidak ada password/token/invitation-token/email/nama plaintext.
- Invitation acceptance dan non-enumeration tests (DEMO-0210) termasuk dalam suite.
- Cross-tenant session misuse ditolak.

### DEMO-0210 — Implement invitation API and acceptance flow (baru v1.1)

Acceptance criteria:

- `POST/GET /invitations`, `POST /invitations/:id/revoke`, dan `POST /invitations/accept` sesuai Demo Foundation v1.1 §11.1a dan ADR-002 §2.2.
- Respons invite untuk email baru dan terdaftar tidak dapat dibedakan (status, body, timing praktis).
- Token single-use, keyed hash, TTL; tidak muncul di log.
- Penerimaan atomik: membership + profile + role assignment; intended role dari tenant lain ditolak.
- Identitas yang sudah ada wajib autentikasi sebelum bergabung.
- Audit `invitation.created/revoked/accepted` tanpa email/token.

### 9.3 Sprint 2 exit gate

- Login sampai logout bekerja end-to-end.
- Refresh rotation/reuse detection lulus.
- Tenant selection/switch lulus untuk multi-membership user.
- Invitation flow dan non-enumeration test lulus.
- Profile hanya menampilkan current authorized identity.
- Auth lifecycle API/E2E tests hijau.

## 10. Sprint 3 — Members, roles, dan permissions

### 10.1 Sprint goal

Memberikan tenant-scoped administration dan backend-enforced RBAC tanpa hardcoded role authorization.

### 10.2 Sprint backlog

| ID | Story | Priority | Estimate | Depends on |
|---|---|---:|---:|---|
| DEMO-0301 | Implement permission catalog | P0 | 5 | Sprint 2 |
| DEMO-0302 | Implement role and assignment schema | P0 | 8 | 0301 |
| DEMO-0303 | Implement effective-permission resolver | P0 | 8 | 0302 |
| DEMO-0304 | Implement backend permission guard | P0 | 8 | 0303 |
| DEMO-0305 | Implement members administration API | P0 | 8 | 0304 |
| DEMO-0306 | Implement roles/permissions administration API | P0 | 8 | 0304 |
| DEMO-0307 | Implement members, invitations, and roles administration UI | P0 | 8 | 0305, 0306, 0210 |
| DEMO-0308 | Automate RBAC and escalation tests | P0 | 8 | 0304–0307 |

Estimated sprint backlog: **61 points** before refinement.

### DEMO-0301 — Implement permission catalog

Acceptance criteria:

- Permission catalog sesuai Demo Foundation tersedia melalui migration/seed.
- Permission code global dan immutable setelah digunakan.
- Platform permission ditandai dan tidak assignable ke tenant role.
- `GET /api/v1/permissions` memerlukan permission yang sesuai dan tidak mengekspos internal data berlebih.

### DEMO-0302 — Implement role and assignment schema

Acceptance criteria:

- `roles`, `role_permissions`, dan `user_role_assignments` tenant-scoped.
- Unique/foreign-key constraints mencegah cross-tenant assignment.
- System/default role tidak dapat dimodifikasi pada field yang dilindungi.
- Archive role mempertahankan history dan menghilangkan effective access.
- Optimistic locking tersedia untuk concurrent role update.

### DEMO-0303 — Implement effective-permission resolver

Acceptance criteria:

- Resolver menggunakan verified tenant, membership, active assignments, active roles, dan active permissions.
- Duplicate permission dideduplicate.
- Suspended/ended membership/assignment menghasilkan no permission.
- Resolver tidak memakai nama role sebagai authorization decision.
- Result dapat digunakan guard dan menu resolver.

### DEMO-0304 — Implement backend permission guard

Acceptance criteria:

- Endpoint protected deny-by-default.
- Guard memeriksa permission dan tenant/resource scope.
- Missing permission menghasilkan `403`; out-of-scope resource menggunakan scoped not-found/deny policy.
- Platform route dan tenant route menggunakan policy berbeda.
- Authorization denial menghasilkan safe audit/telemetry event.

### DEMO-0305 — Implement members administration API

Acceptance criteria:

- List/detail/update-profile/suspend/assign-role endpoint berbasis `membership_id` tersedia sesuai Demo Foundation v1.1 §11.3; tidak ada create/update identitas global.
- Bounded pagination, allowlisted filter (status, role, email exact via tenant-scoped lookup), dan masking diterapkan; sorting nama dilakukan pada halaman hasil yang sudah didekripsi.
- Tenant admin tidak dapat mengakses atau assign member Tenant lain dan tidak memiliki path ke `users`/`credentials`.
- User tidak dapat menaikkan privilege sendiri.
- Mutation menggunakan optimistic conflict handling dan audit.

### DEMO-0306 — Implement roles/permissions administration API

Acceptance criteria:

- List/detail/create/update/archive dan replace-permissions endpoint tersedia.
- Request validation mencegah unknown/platform permission assignment.
- Replace operation transactional dan idempotent terhadap equivalent request.
- Last-owner/administrative lockout risk ditangani dengan explicit rule/test.
- Role/permission change menghasilkan audit event tanpa sensitive payload.

### DEMO-0307 — Implement members, invitations, and roles administration UI

Acceptance criteria:

- Members, invitations, and roles pages hanya muncul melalui effective menu/permission contract.
- UI undangan tidak menampilkan apakah email sudah terdaftar di platform.
- UI mempunyai pagination, loading, empty, error, forbidden, conflict, dan success state.
- Role permission editor menggunakan server catalog dan current state.
- Destructive/high-impact action menampilkan tenant aktif dan confirmation.
- UI responsive dan basic keyboard accessible.

### DEMO-0308 — Automate RBAC and escalation tests

Acceptance criteria:

- No-role, allowed, denied, archived-role, suspended-membership scenarios lulus.
- Direct URL/API access tanpa permission ditolak.
- Self-escalation dan cross-tenant assignment ditolak.
- Tenant role tidak dapat menerima platform permission.
- Concurrent role update menghasilkan controlled conflict.

### 10.3 Sprint 3 exit gate

- Backend guard adalah security boundary aktif.
- Member/invitation/role/permission scope demo bekerja.
- Cross-tenant dan privilege-escalation tests lulus.
- Frontend administration states dapat didemonstrasikan.

## 11. Sprint 4 — Dynamic menu dan navigation

### 11.1 Sprint goal

Menghasilkan menu hierarkis yang diturunkan backend dari effective permission berdasarkan menu seed. Tenant-scoped menu administration adalah P2.

### 11.2 Sprint backlog

| ID | Story | Priority | Estimate | Depends on |
|---|---|---:|---:|---|
| DEMO-0401 | Implement menu and menu-permission schema | P0 | 8 | Sprint 3 |
| DEMO-0402 | Implement hierarchy and route validation | P0 | 5 | 0401 |
| DEMO-0403 | Implement effective-menu resolver | P0 | 8 | 0401, 0402, Sprint 3 resolver |
| DEMO-0404 | Implement menu administration API | **P2** | 8 | 0401–0403 |
| DEMO-0405 | Implement dynamic sidebar/navigation | P0 | 8 | 0403 |
| DEMO-0406 | Implement menu administration UI | **P2** | 8 | 0404 |
| DEMO-0407 | Implement route UX guards and forbidden states | P0 | 5 | 0405, Sprint 3 guard |
| DEMO-0408 | Automate menu visibility and hierarchy tests | P0 | 8 | 0403–0407 |

Estimated sprint backlog: **42 points P0** + 16 points P2 before refinement.

Alasan penurunan 0404/0406: route menu dibatasi allowlist route aplikasi, sehingga CRUD tenant hanya mengubah label, urutan, dan mapping permission; nilai demonstrasinya rendah dibanding biaya. Menu seed + resolver sudah membuktikan permission-derived navigation.

### DEMO-0401 — Implement menu and menu-permission schema

Acceptance criteria:

- Platform and tenant menu ownership represented explicitly.
- Parent-child relation tidak dapat cross tenant secara tidak sah.
- Menu permission mapping menggunakan registered permission IDs.
- Active state, sort order, route, icon code, and version tersedia.
- RLS/constraints melindungi tenant menu.

### DEMO-0402 — Implement hierarchy and route validation

Acceptance criteria:

- Self-parent dan cycle ditolak.
- Missing/invalid parent ditolak.
- Route internal divalidasi terhadap approved format/registry.
- Arbitrary external URL dan executable scheme ditolak.
- Parent/child ownership compatibility diuji.

### DEMO-0403 — Implement effective-menu resolver

Acceptance criteria:

- Resolver mengambil platform menu dan current-tenant menu yang aktif.
- Menu default-deny bila mapping/visibility policy tidak terpenuhi.
- `ANY` permission matching bekerja; `ALL` hanya jika explicitly implemented.
- Parent tanpa visible child dan tanpa accessible route dibuang.
- Output hierarchy stable dan terurut.
- Resolver menggunakan effective permissions backend, bukan frontend claims.

### DEMO-0404 — Implement menu administration API

Acceptance criteria:

- List/detail/create/update/archive/replace-permissions endpoint tersedia.
- Tenant admin tidak dapat memodifikasi platform menu atau tenant lain.
- Optimistic locking dan validation conflict ditangani.
- Mutation menghasilkan audit event.
- OpenAPI contract lengkap.

### DEMO-0405 — Implement dynamic sidebar/navigation

Acceptance criteria:

- Sidebar hanya dibentuk dari `GET /api/v1/me/menu`.
- Nested menu, active route, icon registry, collapsed/responsive state bekerja.
- Tidak ada hardcoded role-to-menu mapping.
- Refresh permission/menu memperbarui navigation sesuai contract.
- Active tenant terlihat pada shell.

### DEMO-0406 — Implement menu administration UI

Acceptance criteria:

- Admin dapat mengelola label, route, parent, ordering, active state, dan permissions sesuai scope.
- Cycle/invalid route/permission error ditampilkan jelas.
- Tenant context terlihat pada high-impact changes.
- Loading, empty, error, forbidden, conflict, dan success states tersedia.

### DEMO-0407 — Implement route UX guards and forbidden states

Acceptance criteria:

- Direct route navigation tanpa effective permission menunjukkan forbidden/not-found UX yang konsisten.
- Guard UX tidak menggantikan API authorization.
- Session expiry mengarahkan ke login sesuai safe return-path policy.
- Tenant switch membersihkan stale menu/page state.

### DEMO-0408 — Automate menu visibility and hierarchy tests

Acceptance criteria:

- Admin/user menu difference tervalidasi.
- Inactive, unauthorized, orphan, cyclic, cross-tenant, dan invalid-route cases diuji.
- Hidden-menu endpoint tetap ditolak backend.
- Permission change tercermin pada effective menu sesuai cache/no-cache policy.

### 11.3 Sprint 4 exit gate

- Dynamic sidebar sepenuhnya berasal dari backend menu resolver.
- Menu seed tenant/platform ter-resolve dengan benar per role dan tenant (menu administration hanya bila P2 diambil).
- Parent pruning, hierarchy validation, dan permission visibility tests lulus.
- Direct API/URL bypass tetap ditolak.

## 12. Sprint 5 — Audit, security testing, E2E, dan demo readiness

### 12.1 Sprint goal

Menghasilkan release candidate demo yang dapat dijalankan ulang, memiliki evidence, dan membuktikan security properties utama.

### 12.2 Sprint backlog

| ID | Story | Priority | Estimate | Depends on |
|---|---|---:|---:|---|
| DEMO-0501 | Complete audit event coverage | P0 | 8 | Sprint 2–4 |
| DEMO-0502 | Implement audit viewer API/UI | P0 | 8 | 0501 |
| DEMO-0503 | Execute security hardening checklist | P0 | 8 | Sprint 1–4 |
| DEMO-0504A | E2E: authentication/session | P0 | 3 | Sprint 2 |
| DEMO-0504B | E2E: tenant isolation | P0 | 3 | Sprint 1–3 |
| DEMO-0504C | E2E: RBAC/privilege escalation | P0 | 3 | Sprint 3 |
| DEMO-0504D | E2E: dynamic menu | P0 | 3 | Sprint 4 |
| DEMO-0504E | E2E: audit/data protection/invitation non-enumeration | P0 | 3 | Sprint 2–5 |
| DEMO-0505 | Finalize idempotent demo seed | P0 | 5 | Sprint 1–4 |
| DEMO-0506 | Create demo script and evidence pack | P0 | 5 | 0504A–E, 0505 |
| DEMO-0507 | Run accessibility/responsive QA | P1 | 5 | Frontend complete |
| DEMO-0508 | Run release-candidate regression | P0 | 8 | 0501–0507 |
| DEMO-0509 | Conduct specialist reviews and acceptance | P0 | 5 | 0508 |

Estimated sprint backlog: **67 points** before refinement. DEMO-0504 telah dipecah (v1.1).

### DEMO-0501 — Complete audit event coverage

Acceptance criteria:

- Mandatory auth, tenant, invitation, member, role, permission, menu, and denial events tercatat (schema dan writer sudah tersedia sejak DEMO-0110).
- Event mempunyai actor, tenant, action, target opaque ID, result, reason, timestamp, dan request ID.
- Audit append-only bagi runtime application path.
- Password, token, raw email/name, cookie, header, dan sensitive diff tidak tercatat.
- Failed operation dicatat sesuai safe event policy.

### DEMO-0502 — Implement audit viewer API/UI

Acceptance criteria:

- Tenant-scoped audit endpoint mempunyai bounded pagination dan allowlisted filters.
- Platform events terpisah dari tenant events.
- UI hanya tersedia dengan `audit.read`.
- Metadata di-mask/minimized.
- Cross-tenant audit visibility ditolak.

### DEMO-0503 — Execute security hardening checklist

Acceptance criteria:

- Helmet/security headers, CORS allowlist, rate limits, cookie flags, DTO validation, body limits, safe errors, dan secret management ditinjau.
- Runtime DB role/RLS/FORCE RLS diverifikasi ulang.
- Source/log/cache/queue/search/database dump diperiksa untuk plaintext credential/personal data.
- Dependency/security scan dijalankan dan temuan ditriage.
- Critical/high defect ditutup atau demo release diblokir.

### DEMO-0504A–E — Full E2E demo suite

MUST di-split minimal menjadi:

```text
0504A Authentication/session E2E
0504B Tenant isolation E2E
0504C RBAC/privilege escalation E2E
0504D Dynamic menu E2E
0504E Audit/data-protection E2E
```

Acceptance criteria:

- Lima skenario demo di Demo Foundation otomatis atau semi-otomatis dengan repeatable evidence.
- Tests dapat berjalan dari clean migration dan seed.
- Negative path sama pentingnya dengan happy path.
- Test tidak memakai credential production atau real personal data.

### DEMO-0505 — Finalize idempotent demo seed

Acceptance criteria:

- Tenant Alpha, Tenant Beta, platform admin, owner, normal user, tenant admin, multi-tenant user, member profiles, pending invitation, roles, permissions, menus, dan assignments tersedia.
- Seed dapat diulang tanpa duplicate/corrupt state.
- Password provisioning aman dan documented untuk local/demo operator.
- Seed tidak dapat dijalankan tanpa explicit allowed environment guard.

### DEMO-0506 — Create demo script and evidence pack

Acceptance criteria:

- Script mengikuti scenario Tenant Owner, Dynamic Permission, Tenant Isolation, Tenant Switch, dan Logout.
- Expected result dan fallback/troubleshooting tersedia.
- Evidence pack memuat versions, migration state, test report, screenshots/HTTP evidence, dan commit identifier.
- Script tidak menampilkan secret atau personal data nyata.

### DEMO-0507 — Run accessibility/responsive QA

Acceptance criteria:

- Keyboard navigation, visible focus, label, error association, dialog behavior, dan color/contrast smoke checks dilakukan.
- Login, invitation acceptance, tenant selection, sidebar, profile, members, invitations, roles, dan audit diuji pada desktop serta mobile viewport dasar.
- Blocking accessibility defect ditutup sebelum acceptance.

### DEMO-0508 — Run release-candidate regression

Acceptance criteria:

- Clean install, migration, seed, build, run, API/E2E, and demo script lulus pada release candidate.
- No critical/high open defect.
- Medium/low known issues terdokumentasi dengan impact dan owner.
- Evidence terikat pada exact commit/release.

### DEMO-0509 — Conduct specialist reviews and acceptance

Acceptance criteria:

- Product Owner memverifikasi demo behavior dan scope.
- Technical Lead memverifikasi architecture/implementation consistency.
- Security/Privacy memverifikasi tenant isolation, pre-context functions, identity/invitation non-enumeration, auth/session, encryption, logging, dan audit scope demo.
- Bila reviewer bukan pihak independen, approval dicatat sebagai self-review dengan risk acceptance (§2.1).
- Operations memverifikasi reproducible run, secret handling, dan recovery baseline demo.
- Approval dicatat terpisah; satu approval tidak mewakili role lain.

### 12.3 Sprint 5 exit gate

- Full regression dan five-scenario demo lulus.
- Audit viewer dan mandatory events tersedia.
- Security hardening tidak mempunyai critical/high blocker.
- Demo seed/script/evidence repeatable.
- Acceptance/sign-off scope tercatat.

## 13. Cross-sprint dependency map

```text
Sprint 0 Foundation
   |
   v
Sprint 1 Tenancy + RLS + Encryption
   |
   v
Sprint 2 Authentication + Session + Profile
   |
   v
Sprint 3 RBAC
   |
   v
Sprint 4 Dynamic Menu
   |
   v
Sprint 5 Audit + Security + E2E + Demo RC
```

Parallel work diperbolehkan hanya jika interface sudah disepakati. Frontend mock tidak boleh dianggap bukti backend authorization atau tenant isolation.

## 14. Traceability matrix

| Demo requirement | Stories |
|---|---|
| Environment/reproducibility | 0001–0010 |
| Prisma+RLS feasibility | 0100 |
| Tenant isolation | 0101–0103, 0106–0109, 0207, 0308, 0503, 0504B |
| Pre-context access path | 0109, 0202, 0204, 0210, 0504A |
| Encryption/PDP baseline | 0104, 0105A, 0105B, 0201–0206, 0503, 0504E |
| Login | 0201–0203, 0208–0209 |
| Refresh/session | 0203–0204, 0209 |
| Logout | 0205, 0209 |
| Profile | 0206, 0208–0209 |
| Invitations | 0210, 0307, 0504E |
| Members | 0305, 0307–0308 |
| Roles/permissions | 0301–0304, 0306–0308 |
| Dynamic menu | 0401–0403, 0405, 0407–0408 (admin 0404/0406 = P2) |
| Audit | 0110, 0501–0502, 0504E |
| Demo readiness | 0503–0509 |

## 15. Required evidence per sprint

| Sprint | Minimum evidence |
|---|---|
| 0 | Runtime versions, health response, Swagger, frontend screen, migration/CI result |
| 1 | Spike GO/NO-GO record, schema/migration, role privileges, RLS & function inspection, pre-context function register, encryption test, two-tenant negative tests |
| 2 | Auth API/E2E report, refresh rotation/reuse, logout revocation, tenant switch, profile evidence |
| 3 | Permission catalog, guard tests, escalation/cross-tenant results, members/invitations/roles UI |
| 4 | Menu hierarchy/visibility tests, admin UI, dynamic sidebar per role/tenant |
| 5 | Audit coverage, security checklist, full regression, demo script, evidence pack, approvals |

## 16. Risk register

| Risk | Impact | Mitigation | Owner |
|---|---|---|---|
| Sprint capacity unknown | Plan overload | Capacity model §2.2; target date setelah velocity terukur; split stories; protect P0 | Delivery Lead |
| RLS/Prisma transaction mismatch | Isolation failure | DEMO-0100 go/no-go spike sebelum schema lain; pool-reuse tests | Technical Lead |
| Pre-context function misuse | Enumeration / bypass RLS | Register, review Security, negative tests (DEMO-0109) | Backend/Security |
| Invitation enumeration | Cross-tenant identity disclosure | Uniform response, timing test (DEMO-0210) | Backend/Security |
| NestJS 12 ecosystem incompatibility | Delay Sprint 0 | Compatibility check DEMO-0003; fallback NestJS 11 via change control | Technical Lead |
| KMS decision deferred | Crypto adapter rework | DEMO-0010 sebelum DEMO-0105A | Technical Lead/Security |
| Self-review pada tim kecil | Approval seremonial, defect lolos | Catat sebagai self-review + risk acceptance; review independen sebelum data nyata | Product Owner |
| Encryption breaks identity lookup | Login failure/data exposure | Blind-index contract and round-trip tests before auth | Backend/Security |
| Role/menu coupled incorrectly | Authorization bypass | Effective-permission service shared by guard/resolver; negative tests | Backend Lead |
| Logout only clears browser state | Session remains valid | Server-side session/token-family revocation tests | Backend Lead |
| Tenant switch retains stale state | Cross-tenant exposure | New context, clear frontend caches, E2E known-ID tests | Full-stack/QA |
| Demo seed leaks credentials | Security issue | Environment guard and secure provisioning output | Operations |
| Over-scope into business features | Delay and architecture drift | Enforce out-of-scope and change control | Product Owner |
| Specialist review too late | Release blocker | Security/Operations checkpoints in Sprint 1–4 | Delivery Lead |

## 17. Ceremonies and controls

### Sprint planning

- confirm sprint goal;
- refine stories and capacity;
- verify Definition of Ready;
- identify approval/review dependencies;
- commit P0 stories only within realistic capacity.

### Daily control

- blocker, dependency, security/schema decision, and evidence status;
- do not report percentage complete without a verifiable artifact/test.

### Review/demo

- demonstrate working software against acceptance criteria;
- include at least one negative authorization/isolation case;
- record passed, failed, and deferred items.

### Retrospective

- review escaped defects, setup friction, test gaps, and architecture drift;
- improvement items receive owner and target sprint.

## 18. Release decision

Demo release candidate dapat diberi status `ACCEPTED FOR DEMO` hanya jika:

- Sprint 0–5 exit gates lulus;
- global Definition of Done terpenuhi;
- five demo scenarios berhasil;
- no critical/high defect;
- exact commit/release dan environment dapat diidentifikasi;
- known limitations didokumentasikan;
- approval record tidak melampaui kewenangan masing-masing role.

`ACCEPTED FOR DEMO` tidak berarti production-ready, legally compliant, penetration-tested untuk production, atau approved untuk menyimpan data pribadi nyata.

## 19. Approval record

| Role | Name | Decision | Date | Evidence |
|---|---|---|---|---|
| Product Owner | `<PRODUCT_OWNER_PLACEHOLDER>` | Pending | — | — |
| Delivery Lead | `<DELIVERY_LEAD_PLACEHOLDER>` | Pending | — | — |
| Technical Lead | `<TECHNICAL_LEAD_PLACEHOLDER>` | Pending | — | — |
| Security/Privacy Reviewer | `<SECURITY_PRIVACY_PLACEHOLDER>` | Pending | — | — |
| Operations Reviewer | `<OPERATIONS_PLACEHOLDER>` | Pending | — | — |

## 20. Change log

| Version | Date | Summary | Approval |
|---|---|---|---|
| 1.0 | 2026-09-16 | Initial six-sprint delivery plan for SaaS Demo Foundation | Pending team refinement and approval |
| 1.1 | 2026-09-16 | Capacity model; story baru 0010/0100/0109/0110/0210; split 0105 & 0504; dependensi 0104; scaffold 0004; members/invitations (ADR-002); menu admin → P2; risk register diperluas | Pending team refinement and approval |

## 21. Open planning decisions

- team composition dan availability;
- sprint timebox final;
- sprint capacity/velocity;
- ticket-tracking platform;
- CI/CD platform;
- test framework and browser automation tooling;
- KMS/demo key mechanism;
- deployment target;
- reviewers and approval schedule;
- target demo date.

