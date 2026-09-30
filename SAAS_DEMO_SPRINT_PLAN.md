---
title: "SaaS Demo Sprint Plan"
document_id: "SAAS-DEMO-SPRINT-PLAN"
edition: "2.1 (consolidated final)"
status: "Consolidated Baseline — Proposed; specialist approval pending"
owner: "<OWNER_PLACEHOLDER>"
last_updated: "2026-09-19"
delivery_scope: "SaaS demo foundation without business-domain features"
timebox_assumption: "Enam milestone (Sprint 0–5); durasi kalender dari velocity terukur"
related_documents:
  - "README.md"
  - "ARCHITECTURE_DECISIONS.md"
  - "INFRASTRUCTURE_SSOT.md"
  - "GENERAL_FEATURE_BASE_SSOT.md"
  - "DATA_PROTECTION_ENCRYPTION_SSOT.md"
  - "SAAS_DEMO_FOUNDATION_SSOT.md"
supersedes_archive: "_archive/ (SAAS_DEMO_SPRINT_PLAN v1.0–v1.3)"
change_control: "Perubahan normatif MUST diperbarui di dokumen ini sebelum implementasi dan dicatat di bagian Riwayat serta README.md §5."
---

# SaaS Demo Sprint Plan

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

**Aturan untuk tim kecil/solo:** jika pembuat pekerjaan dan reviewer Security/Operations adalah orang yang sama, approval dicatat sebagai **self-review** dengan risk acceptance eksplisit pada approval record, dan dinyatakan tidak setara dengan independent review. Review independen (eksternal atau rekan) wajib dijadwalkan sebelum data nyata/production.

### 2.2 Capacity model

Durasi kalender dihitung dari velocity terukur, bukan dipatok satu minggu per sprint. (Rencana awal 338 point dalam enam minggu dinilai tidak realistis.)

| Milestone | P0/P1 point | P2 point |
|---|---:|---:|
| Sprint 0 | 40 | 0 |
| Sprint 1 | 84 | 0 |
| Sprint 2 | 79 | 0 |
| Sprint 3 | 80 | 0 |
| Sprint 4 | 47 | 16 |
| Sprint 5 | 70 | 0 |
| **Total** | **400** | **16** |

Durasi indikatif P0/P1 (tanpa buffer):

| Velocity terukur (point/minggu) | Perkiraan durasi |
|---:|---:|
| 15 | ±26–27 minggu |
| 25 | ±16 minggu |
| 40 | ±10 minggu |

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
| Sprint 3 | Members, roles, permissions, dan superadmin | Backend-enforced tenant-scoped RBAC + platform superadmin & support session | Sprint 4–5 |
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
- Compatibility check NestJS 12 terhadap `@nestjs/swagger`, `@nestjs/throttler`, `@nestjs/jwt`/passport, `@nestjs/config`, dan library pihak ketiga yang dipilih; hasil dicatat. Blocker memicu change control fallback NestJS 11 (Infrastructure SSOT §4.2).

### DEMO-0004 — Scaffold Next.js frontend (tanpa integrasi API)

Scope: scaffold dan quality gate saja, sesuai klarifikasi Infrastructure SSOT §2. Integrasi API dimulai pada DEMO-0208.

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

### DEMO-0010 — Record KMS/demo key decision

Acceptance criteria:

- Keputusan demo key mechanism (Data Protection SSOT §9.2 opsi C atau A-dev) tercatat.
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
| DEMO-0101 | Implement tenant, membership, profile, invitation schema | P0 | 8 | 0100, 0104 |
| DEMO-0102 | Implement runtime tenant context & unit-of-work wrapper | P0 | 8 | 0100, 0101 |
| DEMO-0103 | Implement PostgreSQL RLS policies (tenant-owned + mixed-ownership) | P0 | 8 | 0101, 0102 |
| DEMO-0104 | Implement global user/credential schema | P0 | 5 | 0100, 0105A |
| DEMO-0105A | Implement crypto adapter and demo key source | P0 | 8 | 0010 |
| DEMO-0105B | Implement blind index and Data Field Register | P0 | 5 | 0105A |
| DEMO-0106 | Build idempotent tenant provisioning | P0 | 5 | 0101, 0103, 0110 |
| DEMO-0107 | Seed two isolated tenants | P0 | 3 | 0106 |
| DEMO-0108 | Automate cross-tenant database tests | P0 | 8 | 0103, 0107, 0109 |
| DEMO-0109A | Implement register functions & policies: auth/session (F-01–F-10, F-13) | P0 | 8 | 0103, 0104, 0111 |
| DEMO-0109B | Implement register functions & policies: invitation/audit/notification (F-11, F-12, F-14, F-15) + register CI test | P0 | 5 | 0109A, 0110 |
| DEMO-0110 | Implement audit_logs schema and audit writer | P0 | 5 | 0103 |
| DEMO-0111 | Implement platform role schema and superadmin bootstrap command | P0 | 3 | 0104 |

Estimated sprint backlog: **84 points** before refinement; stories dapat diparalelkan hanya setelah DEMO-0100 lulus dan kontrak disepakati. Milestone ini diperkirakan memakan lebih dari satu timebox.

**Urutan eksekusi tidak sama dengan urutan ID.** Rantai wajib Sprint 1 adalah `0100 -> 0105A -> 0104 -> 0101 -> 0102 -> 0103`, karena `tenant_memberships.user_id` mereferensi `users` dan `users.email_*` memerlukan crypto adapter. Membuat `tenant_memberships` sebelum `users` menghasilkan foreign key yang tidak dapat dibuat pada migration pertama.

### DEMO-0100 — Spike: Prisma 7 + RLS + pool reuse

Timebox: maksimal 5 point / ditetapkan saat planning. Hasil: keputusan GO/NO-GO tertulis.

Acceptance criteria:

- Tabel contoh tenant-owned dengan `ENABLE`/`FORCE` RLS dibuat via SQL migration dan terdeteksi oleh schema inspection test.
- Interactive transaction dengan `set_config(..., true)` sebagai statement pertama membaca/menulis hanya baris tenant yang benar.
- Query tanpa context mengembalikan 0 baris / insert ditolak.
- Load test konkuren (misalnya ≥ 200 request bergantian dua tenant pada pool kecil) tidak menunjukkan kebocoran context.
- Transaksi multi-langkah (simulasi refresh rotation) bekerja dalam satu unit of work; perilaku timeout dicatat.
- `prisma migrate` drift behavior terhadap objek SQL manual dicatat beserta mitigasinya.
- Satu fungsi `SECURITY DEFINER` contoh milik `app_auth_definer` (NOLOGIN, NOBYPASSRLS) **membaca baris dua tenant tanpa `app.current_tenant_id`** melalui policy `TO app_auth_definer` + grant kolom, sementara `app_user` pada tabel yang sama tetap mendapat 0 baris (Opsi A, ADR-001 §3.7).
- Kolom di luar grant tidak dapat dibaca fungsi; `app_user` tidak dapat `SET ROLE app_auth_definer`.
- Lint/test mendeteksi `set_config('app.` di luar modul unit-of-work (ADR-001 §3.10).
- NO-GO memicu revisi ADR-001 §3.9 sebelum story lain dimulai.

### DEMO-0101 — Implement tenant and membership schema

Acceptance criteria:

- `tenants`, `tenant_domains`, `tenant_memberships`, `tenant_member_profiles` (termasuk contact email), `user_invitations`, dan `auth_selection_tickets` mempunyai versioned migration.
- `UNIQUE (tenant_id, id)` pada membership dan undangan sebagai candidate key untuk composite FK downstream.
- `tenant_memberships` mempunyai `FK (user_id) -> users (id)`; migration gagal bila dijalankan sebelum DEMO-0104.
- `invitation_roles` **tidak** dibuat di sini: tabel itu memerlukan `roles` dan dibuat pada DEMO-0302 (Sprint 3).
- Tenant lifecycle minimum: `PROVISIONING`, `ACTIVE`, `SUSPENDED`, `ARCHIVED`.
- Membership unique pada `(tenant_id, user_id)`.
- Tenant-safe indexes dan foreign keys ditinjau.
- Platform-global, tenant-owned, dan mixed-ownership tables terdaftar sesuai Infrastructure SSOT §8.3.

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
- Key purpose `platform_identity` untuk identitas global dan DEK tenant per purpose untuk data tenant-owned (Data Protection SSOT §9.1).
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

- Provisioning membuat tenant, owner membership placeholder, default roles/settings yang diperlukan demo, dan audit event melalui audit writer (DEMO-0110). Organization tidak dibuat pada demo (Demo Foundation §2.2).
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

### DEMO-0109A — Register functions & policies: auth/session

Acceptance criteria:

- Fungsi F-01 s.d. F-10 dan F-13 serta policy/grant kolom terkait tersedia **persis** sesuai `ARCHITECTURE_DECISIONS.md` Lampiran A.
- Fungsi dimiliki `app_auth_definer` (NOLOGIN, NOBYPASSRLS); akses baris hanya dari policy `TO app_auth_definer`; `search_path` terkunci; tanpa dynamic SQL.
- `app_user` hanya `EXECUTE`; tidak ada policy `TO app_auth_definer` tambahan di luar register.
- `sessions`/`refresh_tokens` memakai `context_kind` dengan constraint TENANT ↔ `tenant_id`.
- Test negatif per baris register (hash salah, user_id acak, host tidak terverifikasi, tenant suspended, tiket kedaluwarsa, context bukan milik user) tidak mengembalikan data dan tidak membedakan kasus secara informatif.

### DEMO-0109B — Register functions & policies: invitation/audit/notification + CI

Acceptance criteria:

- Fungsi F-11, F-12, F-14, F-15 serta policy/grant kolom terkait tersedia sesuai register.
- Schema inspection test CI (register §5) membandingkan `pg_proc`, `pg_policies`, `column_privileges`, `pg_auth_members`, dan `rolbypassrls` terhadap register; perbedaan menggagalkan build.
- F-14 menolak action di luar allowlist dan metadata berisi field terlarang; F-15 menolak tipe di luar allowlist.

### DEMO-0110 — Implement audit_logs schema and audit writer

Acceptance criteria:

- `audit_logs` sesuai Demo Foundation §7.3 dengan mixed-ownership policy.
- `UPDATE`/`DELETE` di-revoke dari `app_user`.
- Audit writer tenant-context dan pre-context writer tersedia dan dipakai provisioning.
- Payload divalidasi agar tidak memuat password, token, email, nama, atau raw personal diff.

### DEMO-0111 — Platform role schema and superadmin bootstrap

Acceptance criteria:

- `platform_role_assignments` sesuai ADR-003 §2.4 dan Table Ownership Register.
- Bootstrap command CLI membuat superadmin pertama secara idempotent dan teraudit (via F-14); tidak tersedia via API publik; hanya berjalan dengan akses host.
- `app_user` tidak memiliki grant langsung ke tabel ini.

### 8.3 Sprint 1 exit gate

- Two-tenant schema dan seed tersedia.
- Tenant-context dan RLS negative tests lulus.
- User identity fields encrypted dan lookup email bekerja melalui blind index.
- DEMO-0100 berstatus GO; fungsi dan policy register lulus schema inspection serta test negatif (0109A/0109B).
- Superadmin bootstrap tersedia untuk login Sprint 2.
- Restricted runtime role terbukti tidak dapat bypass RLS.
- Clean migration dan seed replay lulus.
- **Security/Privacy checkpoint #1 tercatat tertulis**: isolasi RLS, register pre-context (Opsi A), key purpose, dan blind index ditinjau; temuan terbuka diberi owner dan target sprint. Output checkpoint menjadi input DEMO-0509 dan tidak boleh ditunda ke Sprint 5.

## 9. Sprint 2 — Login, session, refresh, logout, dan profile

### 9.1 Sprint goal

Menyelesaikan lifecycle authentication end-to-end dengan tenant selection, rotating refresh token, server-side revocation, dan profile minimal.

### 9.2 Sprint backlog

| ID | Story | Priority | Estimate | Depends on |
|---|---|---:|---:|---|
| DEMO-0201 | Implement demo identity provisioning | P0 | 5 | Sprint 1 |
| DEMO-0203 | Implement session and token persistence | P0 | 8 | 0201 |
| DEMO-0202 | Implement login API | P0 | 8 | 0201, 0203 |
| DEMO-0204 | Implement refresh rotation and reuse detection | P0 | 8 | 0203 |
| DEMO-0205 | Implement logout and revocation | P0 | 5 | 0203, 0204 |
| DEMO-0206 | Implement current profile API | P0 | 5 | 0202 |
| DEMO-0207 | Implement contexts list and context switch | P0 | 8 | 0202, 0203, 0211 |
| DEMO-0208 | Implement login/select-context/profile UI | P0 | 8 | 0202, 0206, 0207, 0211 |
| DEMO-0209 | Automate authentication lifecycle tests | P0 | 8 | 0202–0208, 0210–0212 |
| DEMO-0210 | Implement invitation API and acceptance flow | P0 | 8 | 0201, 0203, 0109B |
| DEMO-0211 | Implement context selection ticket and select-context endpoint | P0 | 5 | 0202, 0109A, 0111 |
| DEMO-0212 | Implement member contact email copy and tenant-scoped email lookup | P0 | 3 | 0210, 0105B |

Estimated sprint backlog: **79 points** before refinement.

`DEMO-0203` dikerjakan sebelum `DEMO-0202`: acceptance criteria login sudah menuntut pembuatan session (F-07), sehingga schema dan service session harus ada lebih dulu. Urutan lama (`0203` bergantung `0202`) membentuk dependency melingkar.

### DEMO-0201 — Implement demo identity provisioning

Acceptance criteria:

- Synthetic users sesuai Demo Foundation dapat dibuat tanpa committed plaintext password.
- Password disimpan sebagai adaptive salted hash.
- Membership dan `tenant_member_profiles` (termasuk contact email) untuk single-tenant dan multi-tenant user tersedia melalui provisioning service khusus demo (bukan API tenant).
- Demo Superadmin dibuat melalui bootstrap command (DEMO-0111), tanpa membership.
- Minimal satu undangan `PENDING` di Tenant Alpha; token dikeluarkan melalui demo provisioning channel.
- User/tenant/membership status dapat digunakan test fixture.

### DEMO-0202 — Implement login API

Acceptance criteria:

- `POST /api/v1/auth/login` mempunyai validated DTO dan OpenAPI contract.
- Email dinormalisasi dan dicari melalui blind index menggunakan F-02; context dibaca melalui F-04 (membership aktif + platform role).
- 0 context → gagal generik; 1 context → session langsung (F-07); >1 context → tiket (DEMO-0211).
- Demo Superadmin tanpa membership memperoleh session context PLATFORM.
- Password verification memakai constant-work path saat user tidak ditemukan.
- Invalid user/password menghasilkan generic response.
- Suspended/locked identity atau tenant tidak memperoleh session.
- Rate limiting/backoff baseline aktif.
- Login success/failure menghasilkan safe audit event.

### DEMO-0203 — Implement session and token persistence

Acceptance criteria:

- Session memiliki `context_kind`: TENANT terikat user, tenant, dan active membership; PLATFORM terikat user dan platform role aktif.
- Token context PLATFORM ditolak di route tenant dan sebaliknya.
- Access token berumur pendek dan mempunyai signed tenant/session claims minimum.
- Refresh token raw hanya dikirim ke client dan database menyimpan keyed hash.
- Cookie/token delivery strategy didokumentasikan dan security flags sesuai environment.
- Session dapat dicabut server-side.
- `sessions` mempunyai `UNIQUE (tenant_id, id)` serta `FK (tenant_id, membership_id) -> tenant_memberships (tenant_id, id)`; `refresh_tokens` mempunyai `FK (session_id) -> sessions (id)` dan `FK (tenant_id, session_id) -> sessions (tenant_id, id)` (Demo Foundation §7.3).
- Test negatif: menulis `sessions` dengan `membership_id` milik tenant lain ditolak database, bukan hanya ditolak aplikasi.

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

### DEMO-0207 — Implement contexts list and context switch

Acceptance criteria:

- `GET /api/v1/me/contexts` hanya mengembalikan membership aktif dan akses platform yang masih berlaku.
- `POST /api/v1/me/context-switch` menolak target tanpa active membership/platform role.
- Switch membuat session baru dan mencabut session lama (Demo Foundation §8.2).
- Resource dari tenant lama tidak dapat digunakan setelah switch.
- Switch menghasilkan audit event.

### DEMO-0208 — Implement login/select-context/profile UI

Acceptance criteria:

- Login mempunyai accessible validation dan generic auth failure.
- User multi-context diarahkan ke `/select-context`; tiket kedaluwarsa mengarahkan kembali ke login.
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

### DEMO-0210 — Implement invitation API and acceptance flow

Acceptance criteria:

- `POST/GET /invitations`, `POST /invitations/:id/revoke`, dan `POST /invitations/accept` sesuai Demo Foundation §11.1a dan ADR-002 §2.2; penerimaan memakai F-11/F-12.
- Respons invite untuk email baru dan terdaftar tidak dapat dibedakan (status, body, timing praktis).
- Token single-use, keyed hash, TTL; tidak muncul di log.
- Penerimaan atomik: membership + `tenant_member_profiles`. Role assignment dari `invitation_roles` **tidak** termasuk di sini karena `roles` baru ada di Sprint 3; increment tersebut adalah DEMO-0309.
- Undangan tanpa role tetap menghasilkan membership aktif tanpa permission (default-deny).
- Identitas yang sudah ada wajib autentikasi sebelum bergabung.
- Audit `invitation.created/revoked/accepted` tanpa email/token.

### DEMO-0211 — Context selection ticket and select-context endpoint

Acceptance criteria:

- F-05/F-06 dipakai; tiket acak entropi tinggi, disimpan hash, TTL ≤ 5 menit, sekali pakai, dikirim sebagai cookie HttpOnly.
- `GET /auth/contexts` dan `POST /auth/select-context` hanya menerima tiket; tiket ditolak di endpoint lain.
- Tiket kedaluwarsa/dipakai ulang/target bukan milik user ditolak dengan respons generik dan audit `auth.select_context` dengan outcome `FAILURE` dan reason code.

### DEMO-0212 — Member contact email copy and tenant-scoped lookup

Acceptance criteria:

- F-12 menyalin contact email (DEK tenant) dan blind index tenant ke `tenant_member_profiles`.
- `GET /members` menampilkan email masked dan filter `email exact` memakai blind index tenant tanpa akses ke `users`.
- Contact email Tenant Alpha tidak terbaca dari Tenant Beta untuk Multi-Tenant User.
- Data Field Register memuat `tenant_member_profiles.contact_email`.

### 9.3 Sprint 2 exit gate

- Login sampai logout bekerja end-to-end.
- Refresh rotation/reuse detection lulus.
- Context selection (tiket) dan switch lulus untuk multi-membership user; Demo Superadmin login ke context PLATFORM.
- Contact email member dapat ditampilkan masked dan dicari exact.
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
| DEMO-0302 | Implement role, assignment, dan invitation-role schema | P0 | 8 | 0301, 0101 |
| DEMO-0303 | Implement effective-permission resolver | P0 | 8 | 0302 |
| DEMO-0304 | Implement backend permission guard | P0 | 8 | 0303 |
| DEMO-0305 | Implement members administration API | P0 | 8 | 0304 |
| DEMO-0306 | Implement roles/permissions administration API | P0 | 8 | 0304 |
| DEMO-0307 | Implement members, invitations, and roles administration UI | P0 | 8 | 0305, 0306, 0210 |
| DEMO-0308 | Automate RBAC and escalation tests | P0 | 8 | 0304–0307, 0309 |
| DEMO-0309 | Implement invitation role assignment increment | P0 | 3 | 0302, 0210 |
| DEMO-0311 | Implement platform guard and platform admin management | P0 | 3 | 0111, 0303, 0304 |
| DEMO-0312 | Implement break-glass support session (API + DB enforcement) | P0 | 8 | 0311, 0313, 0109B |
| DEMO-0313 | Implement minimal tenant security notifications | P0 | 5 | 0109B |

Estimated sprint backlog: **80 points** before refinement.

### DEMO-0301 — Implement permission catalog

Acceptance criteria:

- Permission catalog sesuai Demo Foundation tersedia melalui migration/seed.
- Permission code global dan immutable setelah digunakan.
- Platform permission ditandai dan tidak assignable ke tenant role.
- `GET /api/v1/permissions` memerlukan permission yang sesuai dan tidak mengekspos internal data berlebih.

### DEMO-0302 — Implement role and assignment schema

Acceptance criteria:

- `roles`, `role_permissions`, `user_role_assignments`, dan `invitation_roles` tenant-scoped.
- Unique/foreign-key constraints mencegah cross-tenant assignment: `FK (tenant_id, role_id) -> roles (tenant_id, id)` pada `role_permissions`, `user_role_assignments`, dan `invitation_roles`.
- Satu assignment aktif per `(tenant_id, membership_id, role_id)` ditegakkan **partial unique index** `WHERE ended_at IS NULL`, bukan `UNIQUE` biasa, agar baris historis tetap boleh berulang.
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

- List/detail/update-profile/suspend/assign-role endpoint berbasis `membership_id` tersedia sesuai Demo Foundation §11.3; tidak ada create/update identitas global.
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

- Members, invitations, and roles pages hanya muncul melalui **effective-permission contract** (DEMO-0303); navigasi berbasis effective menu adalah kapabilitas Sprint 4 (DEMO-0403/0405) dan diverifikasi di DEMO-0408, bukan di sini.
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

### DEMO-0309 — Implement invitation role assignment increment

Scope: melengkapi DEMO-0210 setelah `roles` dan `invitation_roles` tersedia.

Acceptance criteria:

- `POST /invitations` menerima daftar role tenant dan menulis `invitation_roles` dalam transaksi yang sama.
- Role dari tenant lain ditolak composite FK, bukan hanya validasi aplikasi.
- `POST /invitations/accept` menetapkan `user_role_assignments` dari `invitation_roles` secara atomik bersama pembuatan membership.
- Undangan yang dibuat sebelum story ini (tanpa role) tetap dapat diterima tanpa error.
- Role yang di-archive antara pembuatan dan penerimaan undangan ditangani dengan aturan eksplisit dan test.

### DEMO-0311 — Implement platform guard and platform admin management

Scope: skema `platform_role_assignments` dan bootstrap ada di DEMO-0111 (Sprint 1); story ini hanya guard dan administrasi admin platform.

Acceptance criteria:

- Platform guard hanya menerima token context PLATFORM, memeriksa `platform.*` permission dan menetapkan `context_kind = platform`.
- `POST /platform/admins` dan revoke menolak aksi terhadap diri sendiri dan pencabutan superadmin terakhir.
- Superadmin tanpa support session ditolak saat mengakses route/tabel tenant-owned (API dan DB test).
- Tenant role tidak dapat memperoleh `platform.*`.

### DEMO-0312 — Implement break-glass support session

Acceptance criteria:

- `support_sessions` dengan RLS per context (`platform`, `tenant`, `support`).
- `POST/GET /platform/support-sessions` dan `/end` sesuai Demo Foundation §11.2; validasi alasan, scope, durasi ≤ 60 menit, satu sesi aktif per superadmin; tenant SUSPENDED/CLOSING/ARCHIVED dipaksa READ_ONLY; PURGED ditolak.
- Token support hanya diterbitkan dari session PLATFORM aktif; logout session PLATFORM mengakhiri support session.
- Token support berisi `context_kind`, `tenant_id`, `support_session_id`, `scope`; sesi divalidasi pada setiap request.
- Unit of work support menetapkan tenant context; READ_ONLY memakai `SET TRANSACTION READ ONLY`.
- Permission set support tetap (read set / write set) dan tidak dapat mengubah role, membership, undangan, domain, entitlement tenant.
- Masking default; reveal DP-1 teraudit; reveal DP-2 tidak tersedia.
- Audit platform + tenant untuk started/ended/revoked/mutation melalui F-14; notifikasi melalui F-15 (DEMO-0313).
- Test ADR-003 §5 otomatis.

### DEMO-0313 — Minimal tenant security notifications

Acceptance criteria:

- `tenant_notifications` sesuai ADR-003 §2.4; insert hanya via F-15; `app_user` tanpa grant insert.
- `GET /notifications/security` dan `POST /notifications/security/:id/read` hanya untuk member dengan `audit.read` di tenant aktif.
- Notifikasi Tenant Alpha tidak terlihat dari Tenant Beta.

### 10.3 Sprint 3 exit gate

- Backend guard adalah security boundary aktif.
- Member/invitation/role/permission scope demo bekerja.
- Cross-tenant dan privilege-escalation tests lulus.
- Superadmin guard dan support session tests (ADR-003 §5) lulus.
- Frontend administration states dapat didemonstrasikan.
- **Security/Privacy checkpoint #2 tercatat tertulis**: RBAC, privilege escalation, break-glass support session, dan notifikasi tenant ditinjau; temuan terbuka diberi owner dan target sprint.
- **Operations checkpoint tercatat tertulis**: reproducible run, secret handling, dan migration rollback path ditinjau.

Checkpoint bukan story backlog; waktunya dicadangkan pada sprint gate dan dimiliki Delivery Lead (§2.1). Bila reviewer tidak independen, berlaku aturan self-review §2.1.

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
| DEMO-0409 | Implement superadmin console, support-mode UI, and security notification UI | P0 | 5 | 0311, 0312, 0313, 0405 |
| DEMO-0408 | Automate menu visibility and hierarchy tests | P0 | 8 | 0403–0407 |

Estimated sprint backlog: **47 points P0** + 16 points P2 before refinement.

Alasan penurunan 0404/0406: route menu dibatasi allowlist route aplikasi, sehingga CRUD tenant hanya mengubah label, urutan, dan mapping permission; nilai demonstrasinya rendah dibanding biaya. Menu seed + resolver sudah membuktikan permission-derived navigation.

### DEMO-0401 — Implement menu and menu-permission schema

Acceptance criteria:

- Platform and tenant menu ownership direpresentasikan kolom nyata `owner_key` (generated dari `tenant_id`, sentinel nol untuk platform), bukan konsep "ownership scope".
- `UNIQUE (owner_key, code)`, `UNIQUE (owner_key, id)`, dan `FK (owner_key, parent_id) -> menus (owner_key, id)` tersedia; `menu_permissions` memakai `PRIMARY KEY (owner_key, menu_id, permission_id)`.
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

### DEMO-0409 — Implement superadmin console and support-mode UI

Acceptance criteria:

- Halaman `/platform/tenants`, `/platform/admins`, `/platform/audit`, `/platform/support-sessions` tersedia sesuai permission.
- Form support session mewajibkan alasan, scope, dan durasi; READ_WRITE hanya muncul bila permission ada.
- Banner mode support permanen: tenant, scope, sisa waktu, tombol akhiri sesi; stale state dibersihkan saat sesi berakhir.
- Audit tenant menampilkan event support dan tenant owner melihat notifikasi keamanan dari `GET /notifications/security` (badge/header).
- Halaman `/select-context` menampilkan opsi "Platform" untuk superadmin yang juga member tenant.
- Loading, empty, error, forbidden, conflict, success states tersedia.

### 11.3 Sprint 4 exit gate

- Dynamic sidebar sepenuhnya berasal dari backend menu resolver.
- Menu seed tenant/platform ter-resolve dengan benar per role dan tenant (menu administration hanya bila P2 diambil).
- Parent pruning, hierarchy validation, dan permission visibility tests lulus.
- Direct API/URL bypass tetap ditolak.
- Console superadmin dan banner mode support dapat didemonstrasikan.

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
| DEMO-0504F | E2E: superadmin & break-glass support session (Scenario 6) | P0 | 3 | 0311, 0312, 0409 |
| DEMO-0505 | Finalize idempotent demo seed | P0 | 5 | Sprint 1–4 |
| DEMO-0506 | Create demo script and evidence pack | P0 | 5 | 0504A–F, 0505 |
| DEMO-0507 | Run accessibility/responsive QA | P1 | 5 | Frontend complete |
| DEMO-0508 | Run release-candidate regression | P0 | 8 | 0501–0507 |
| DEMO-0509 | Conduct specialist reviews and acceptance | P0 | 5 | 0508 |

Estimated sprint backlog: **70 points** before refinement. DEMO-0504 dipecah menjadi 0504A–F.

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

### DEMO-0504A–F — Full E2E demo suite

MUST di-split minimal menjadi:

```text
0504A Authentication/session E2E
0504B Tenant isolation E2E
0504C RBAC/privilege escalation E2E
0504D Dynamic menu E2E
0504E Audit/data-protection E2E
0504F Superadmin/break-glass support E2E
```

Acceptance criteria:

- Enam skenario demo di Demo Foundation otomatis atau semi-otomatis dengan repeatable evidence.
- Tests dapat berjalan dari clean migration dan seed.
- Negative path sama pentingnya dengan happy path.
- Test tidak memakai credential production atau real personal data.

### DEMO-0505 — Finalize idempotent demo seed

Acceptance criteria:

- Tenant Alpha, Tenant Beta, superadmin (melalui bootstrap command), owner, normal user, tenant admin, multi-tenant user, member profiles, pending invitation, roles, permissions, menus, dan assignments tersedia.
- Seed dapat diulang tanpa duplicate/corrupt state.
- Password provisioning aman dan documented untuk local/demo operator.
- Seed tidak dapat dijalankan tanpa explicit allowed environment guard.

### DEMO-0506 — Create demo script and evidence pack

Acceptance criteria:

- Script mengikuti scenario Tenant Owner, Dynamic Permission, Tenant Isolation, Tenant Switch, Logout, dan Superadmin/Break-glass Support.
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

- Full regression dan six-scenario demo lulus.
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
| Tenant isolation | 0101–0103, 0106–0108, 0109A, 0109B, 0207, 0308, 0503, 0504B |
| Pre-context access path (Opsi A, register) | 0100, 0109A, 0109B, 0202, 0204, 0210, 0211, 0504A |
| Login context & superadmin session | 0111, 0202, 0203, 0207, 0211, 0504A, 0504F |
| Encryption/PDP baseline | 0104, 0105A, 0105B, 0201–0206, 0503, 0504E |
| Login | 0201–0203, 0208–0209 |
| Refresh/session | 0203–0204, 0209 |
| Logout | 0205, 0209 |
| Profile | 0206, 0208–0209 |
| Invitations | 0210, 0307, 0504E |
| Members | 0212, 0305, 0307–0308 |
| Roles/permissions | 0301–0304, 0306–0308 |
| Dynamic menu | 0401–0403, 0405, 0407–0408 (admin 0404/0406 = P2) |
| Audit | 0110, 0501–0502, 0504E |
| Superadmin & break-glass support | 0111, 0311, 0312, 0313, 0409, 0504F |
| Demo readiness | 0503–0509 |

## 15. Required evidence per sprint

| Sprint | Minimum evidence |
|---|---|
| 0 | Runtime versions, health response, Swagger, frontend screen, migration/CI result |
| 1 | Spike GO/NO-GO record (termasuk bukti Opsi A), schema/migration, role privileges, RLS/policy/function/grant inspection terhadap register, encryption test, two-tenant negative tests, bootstrap superadmin |
| 2 | Auth API/E2E report, refresh rotation/reuse, logout revocation, tenant switch, profile evidence |
| 3 | Permission catalog, guard tests, escalation/cross-tenant results, members/invitations/roles UI |
| 4 | Menu hierarchy/visibility tests, admin UI, dynamic sidebar per role/tenant |
| 5 | Audit coverage, security checklist, full regression, demo script, evidence pack, approvals |

## 16. Risk register

| Risk | Impact | Mitigation | Owner |
|---|---|---|---|
| Sprint capacity unknown | Plan overload | Capacity model §2.2; target date setelah velocity terukur; split stories; protect P0 | Delivery Lead |
| RLS/Prisma transaction mismatch | Isolation failure | DEMO-0100 go/no-go spike sebelum schema lain; pool-reuse tests | Technical Lead |
| Pre-context function misuse | Enumeration / bypass RLS | Register sumber tunggal, review Security, schema inspection CI, negative tests (DEMO-0109A/B) | Backend/Security |
| Policy `TO app_auth_definer` drift dari register | Fungsi membaca lebih dari yang disetujui | Grant kolom + schema inspection menggagalkan build | Technical Lead/Security |
| GUC tenant context diubah oleh kode di luar wrapper | Isolasi RLS tidak berlaku | Lint `set_config('app.`, parameterized query, alert telemetry (ADR-001 §3.10) | Backend Lead |
| Invitation enumeration | Cross-tenant identity disclosure | Uniform response, timing test (DEMO-0210) | Backend/Security |
| NestJS 12 ecosystem incompatibility | Delay Sprint 0 | Compatibility check DEMO-0003; fallback NestJS 11 via change control | Technical Lead |
| KMS decision deferred | Crypto adapter rework | DEMO-0010 sebelum DEMO-0105A | Technical Lead/Security |
| Superadmin account compromise | Akses data tenant tanpa izin | Break-glass terbatas waktu/scope, masking, audit terlihat tenant, alerting; MFA sebelum production | Security |
| Superadmin menyalahgunakan support session (tanpa approval kedua) | Pelanggaran privasi terdeteksi setelah kejadian | Transparansi ke tenant, review log sesi berkala; opsi approval via ADR baru | Product Owner/Security |
| Self-review pada tim kecil | Approval seremonial, defect lolos | Catat sebagai self-review + risk acceptance; review independen sebelum data nyata | Product Owner |
| Encryption breaks identity lookup | Login failure/data exposure | Blind-index contract and round-trip tests before auth | Backend/Security |
| Role/menu coupled incorrectly | Authorization bypass | Effective-permission service shared by guard/resolver; negative tests | Backend Lead |
| Logout only clears browser state | Session remains valid | Server-side session/token-family revocation tests | Backend Lead |
| Tenant switch retains stale state | Cross-tenant exposure | New context, clear frontend caches, E2E known-ID tests | Full-stack/QA |
| Demo seed leaks credentials | Security issue | Environment guard and secure provisioning output | Operations |
| Over-scope into business features | Delay and architecture drift | Enforce out-of-scope and change control | Product Owner |
| Specialist review too late | Release blocker | Checkpoint tertulis wajib pada exit gate Sprint 1 (§8.3) dan Sprint 3 (§10.3); output menjadi input DEMO-0509 | Delivery Lead |

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
- six demo scenarios berhasil;
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

## Riwayat

| Edisi | Tanggal | Ringkasan |
|---|---|---|
| 2.0 | 2026-09-16 | Edisi final hasil konsolidasi dari SaaS Demo Sprint Plan v1.3; penanda revisi dan change log berlapis dihapus; isi normatif tidak diubah selain perapian rujukan. Riwayat keputusan: `README.md` §5; versi lengkap sebelumnya: `_archive/` |
| 2.1 | 2026-09-19 | Perbaikan hasil review eksternal: urutan dependency Sprint 1 (`0105A -> 0104 -> 0101`) dan Sprint 2 (`0203` sebelum `0202`); `invitation_roles` dipindah ke DEMO-0302 dan increment penerimaan undangan menjadi DEMO-0309 (baru, 3 point); AC composite FK `sessions`/`refresh_tokens` dan partial unique index `user_role_assignments`; `owner_key` pada menu; DEMO-0307 tidak lagi menuntut kapabilitas Sprint 4; checkpoint Security/Operations wajib pada exit gate Sprint 1 dan 3. Total P0/P1 397 -> 400 point, 70 -> 71 story |
| 2.1 (editorial) | 2026-09-22 | AC DEMO-0211: nama event audit penolakan tiket diselaraskan dengan Demo Foundation 2.4 §15 (`auth.select_context` + outcome `FAILURE`). Isi AC tidak berubah |
