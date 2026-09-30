---
title: "Document Version Index — SaaS Multi-Tenant Baseline"
document_id: "DOCUMENT-VERSION-INDEX"
last_updated: "2026-09-16"
purpose: "Daftar versi dokumen yang berlaku, arsip versi lama, dan pelacakan penyelesaian temuan review"
---

# Document Version Index

## 1. Dokumen yang berlaku

Implementasi, ticket, dan pull request **wajib** merujuk versi di tabel ini.

| Dokumen | Versi berlaku | File | Status |
|---|---|---|---|
| ADR-001 SaaS Multi-Tenancy | 1.3 | `ADR-001-SAAS-MULTI-TENANCY_v1.3.md` | v1.0 adopted; v1.1–1.3 proposed; Opsi A dipilih |
| ADR-002 Identity Model | 1.1 | `ADR-002-IDENTITY-MODEL_v1.1.md` | Proposed |
| ADR-003 Platform Superadmin & Break-Glass Support | 1.1 | `ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.1.md` | Proposed; product direction dipilih |
| Pre-context & Cross-context Access Register | 1.0 | `PRE_CONTEXT_FUNCTION_REGISTER_v1.0.md` | Proposed; sumber tunggal fungsi & policy `TO app_auth_definer` |
| Infrastructure SSOT | 1.5 | `INFRASTRUCTURE_SSOT_v1.5.md` | Revisions proposed |
| General Feature Base SSOT | 1.4 | `GENERAL_FEATURE_BASE_SSOT_v1.4.md` | Revisions proposed |
| Data Protection & Field Encryption SSOT | 1.1 (errata e2) | `DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md` | Proposed; Legal/DPO pending |
| SaaS Demo Foundation SSOT | 1.3 | `SAAS_DEMO_FOUNDATION_SSOT_v1.3.md` | Ready for refinement after ADR review |
| SaaS Demo Sprint Plan | 1.3 | `SAAS_DEMO_SPRINT_PLAN_v1.3.md` | Ready for team refinement |
| Review v1 2026-09-16 | — | `REVIEW_BASELINE_DOCS_2026-09-16.md` | Referensi; ditindaklanjuti (§4) |
| Review v2 2026-09-16 (setelah revisi) | — | `REVIEW_BASELINE_DOCS_v2_2026-09-16.md` | Referensi; ditindaklanjuti (§4c) |

## 2. Arsip — `SUPERSEDED` (jangan dirujuk implementasi baru)

| File | Digantikan oleh (langsung) | Versi berlaku saat ini |
|---|---|---|
| `ADR-001-SAAS-MULTI-TENANCY.md` (v1.0) | `ADR-001-SAAS-MULTI-TENANCY_v1.1.md` | `ADR-001-SAAS-MULTI-TENANCY_v1.3.md` |
| `ADR-001-SAAS-MULTI-TENANCY_v1.1.md` | `ADR-001-SAAS-MULTI-TENANCY_v1.2.md` | `ADR-001-SAAS-MULTI-TENANCY_v1.3.md` |
| `ADR-001-SAAS-MULTI-TENANCY_v1.2.md` | `ADR-001-SAAS-MULTI-TENANCY_v1.3.md` | `ADR-001-SAAS-MULTI-TENANCY_v1.3.md` |
| `ADR-002-IDENTITY-MODEL_v1.0.md` | `ADR-002-IDENTITY-MODEL_v1.1.md` | `ADR-002-IDENTITY-MODEL_v1.1.md` |
| `ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.0.md` | `ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.1.md` | `ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.1.md` |
| `INFRASTRUCTURE_SSOT_v1.2.md` | `INFRASTRUCTURE_SSOT_v1.3.md` | `INFRASTRUCTURE_SSOT_v1.5.md` |
| `INFRASTRUCTURE_SSOT_v1.3.md` | `INFRASTRUCTURE_SSOT_v1.4.md` | `INFRASTRUCTURE_SSOT_v1.5.md` |
| `INFRASTRUCTURE_SSOT_v1.4.md` | `INFRASTRUCTURE_SSOT_v1.5.md` | `INFRASTRUCTURE_SSOT_v1.5.md` |
| `GENERAL_FEATURE_BASE_SSOT_v1.2.md` | `GENERAL_FEATURE_BASE_SSOT_v1.3.md` | `GENERAL_FEATURE_BASE_SSOT_v1.4.md` |
| `GENERAL_FEATURE_BASE_SSOT_v1.3.md` | `GENERAL_FEATURE_BASE_SSOT_v1.4.md` | `GENERAL_FEATURE_BASE_SSOT_v1.4.md` |
| `DATA_PROTECTION_ENCRYPTION_SSOT_v1.0.md` | `DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md` | `DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md` |
| `SAAS_DEMO_FOUNDATION_SSOT_v1.0.md` | `SAAS_DEMO_FOUNDATION_SSOT_v1.1.md` | `SAAS_DEMO_FOUNDATION_SSOT_v1.3.md` |
| `SAAS_DEMO_FOUNDATION_SSOT_v1.1.md` | `SAAS_DEMO_FOUNDATION_SSOT_v1.2.md` | `SAAS_DEMO_FOUNDATION_SSOT_v1.3.md` |
| `SAAS_DEMO_FOUNDATION_SSOT_v1.2.md` | `SAAS_DEMO_FOUNDATION_SSOT_v1.3.md` | `SAAS_DEMO_FOUNDATION_SSOT_v1.3.md` |
| `SAAS_DEMO_SPRINT_PLAN_v1.0.md` | `SAAS_DEMO_SPRINT_PLAN_v1.1.md` | `SAAS_DEMO_SPRINT_PLAN_v1.3.md` |
| `SAAS_DEMO_SPRINT_PLAN_v1.1.md` | `SAAS_DEMO_SPRINT_PLAN_v1.2.md` | `SAAS_DEMO_SPRINT_PLAN_v1.3.md` |
| `SAAS_DEMO_SPRINT_PLAN_v1.2.md` | `SAAS_DEMO_SPRINT_PLAN_v1.3.md` | `SAAS_DEMO_SPRINT_PLAN_v1.3.md` |

Versi lama dipertahankan untuk jejak audit. Setiap file arsip wajib memiliki:

- frontmatter `status: "SUPERSEDED"`, `original_status`, `superseded_by` (versi berlaku saat ini), dan `superseded_date`;
- banner **SUPERSEDED — ARSIP, BUKAN DOKUMEN AKTIF** tepat setelah frontmatter.

Isi dan referensi versi di dalam file arsip bersifat historis dan tidak diperbaiki; yang diperbaiki adalah dokumen aktif. Rekomendasi: pindahkan arsip ke `docs/archive/` saat repository dibuat (Infrastructure SSOT v1.5 §6).

## 3. Konvensi versioning

- Nama file: `<DOCUMENT_ID>_v<MAJOR>.<MINOR>.md`.
- **Minor** (`1.2 → 1.3`): klarifikasi, penambahan kontrol, koreksi inkonsistensi tanpa membalik keputusan arsitektur.
- **Major** (`1.x → 2.0`): membalik keputusan inti (misalnya model tenancy, stack utama).
- Setiap versi baru wajib: `supersedes` di frontmatter, blok "Perubahan vX.Y" di awal dokumen, baris change log, dan pembaruan index ini.
- Status `Proposed` tidak boleh dibaca sebagai approval Technical, Security/Privacy, Legal/DPO, atau Operations.
- Dokumen **aktif** hanya boleh merujuk versi aktif. Bila dokumen lain naik versi, referensi di dokumen aktif disinkronkan sebagai **editorial errata** (`<versi>-e<n>` di change log) tanpa menaikkan versi, asalkan tidak ada perubahan normatif.
- Saat versi baru terbit, versi sebelumnya wajib ditandai `SUPERSEDED` pada hari yang sama (§2).
- Daftar fungsi `SECURITY DEFINER` dan policy `TO app_auth_definer` **hanya** boleh ditulis di `PRE_CONTEXT_FUNCTION_REGISTER`; dokumen lain merujuk ID fungsi (F-xx).
- Pemeriksaan konsistensi (§6) wajib lulus sebelum dokumen dibagikan atau di-commit.

## 4. Pelacakan temuan review v1 → perbaikan

Kolom "Lokasi saat ini" menunjuk versi aktif (bukan versi tempat perbaikan pertama kali dibuat).

| Temuan review v1 | Level | Penyelesaian | Lokasi saat ini |
|---|---|---|---|
| 1.1 Jalur pre-tenant-context tidak didefinisikan | Kritis | Fungsi `SECURITY DEFINER` + policy `TO app_auth_definer` (Opsi A, dikoreksi review v2) + register + test negatif | ADR-001 v1.3 §3.7; Register v1.0; Infra v1.5 §8.1, §8.7.1; Sprint Plan v1.3 DEMO-0100, 0109A/B |
| 1.2 Identitas global bocor lintas tenant | Kritis | Invitation-only, respons seragam, tenant member profile, admin tanpa akses `users` | ADR-002 v1.1; Demo Foundation v1.3 §7.3, §11; DEMO-0210 |
| 1.3 Enkripsi identitas bertentangan dengan DP SSOT | Tinggi | Pengecualian terkontrol `platform_identity` | DP SSOT v1.1 §8.1, §8.2, §9.1 |
| 1.4 Enkripsi nama mematikan pencarian admin | Tinggi | Keyed word-token search per tenant (production); demo: email exact via contact email | DP SSOT v1.1 §8.4; ADR-002 v1.1 §2.5–2.6 |
| 1.5 Prisma + RLS diremehkan | Tinggi | Pola unit-of-work, SQL migration + schema inspection, spike go/no-go | ADR-001 v1.3 §3.9; Infra v1.5 §8.7.2; DEMO-0100 |
| 1.6 KMS/HSM vs VPS | Sedang | Opsi A/B/C dan tenggat keputusan | DP SSOT v1.1 §9.2; Infra v1.5 §12.1; DEMO-0010 |
| 2.1 PP 33/2026 tidak dirujuk | Kritis | Legal baseline dengan status "belum diverifikasi dari teks resmi" | DP SSOT v1.1 §2 |
| 2.2 Celah kewajiban PDP | Tinggi | Pengendali/Prosesor, notifikasi 3×24 jam, hak subjek, RoPA, transfer | DP SSOT v1.1 §2.1, §12.1, §12.2, §13.1 |
| 2.3 Regulasi sektoral | Sedang | **Belum diselesaikan** — perlu ADR isolation tier bila ada tenant regulated | General v1.4 §30; ADR-001 v1.3 §4.1 |
| 3.1 Klasifikasi tabel Infra vs Demo | Tinggi | Table Ownership Register | Infra v1.5 §8.3; Demo v1.3 §7.2 |
| 3.2 Model role assignment ganda | Tinggi | Satu `user_role_assignments` berbasis membership | General v1.4 §5.3; Infra v1.5 §8.3 |
| 3.3 Settings tanpa level tenant | Tinggi | Precedence menambah tenant | General v1.4 §9 |
| 3.4 Dua skema klasifikasi | Sedang | Mapping label ↔ DP class | DP SSOT v1.1 §4.1; General v1.4 §25 |
| 3.5 Audit `organization_id` & raw diff | Sedang | `tenant_id`, `changed_fields_json` tanpa nilai personal | General v1.4 §10 |
| 3.6 Feature flag tanpa tenant | Sedang | Tenant targeting | General v1.4 §21 |
| 3.7 External ID tanpa tenant | Sedang | Unique `(tenant_id, connection, entity_type, external_id)` | General v1.4 §19.3 |
| 3.8 Reference data global vs tenant | Sedang | Mixed-ownership + aturan override | General v1.4 §8 |
| 3.9 Default organization tanpa tabel | Sedang | Organization di luar scope demo | Demo v1.3 §2.2; DEMO-0106 |
| 3.10 ADR-001 rujuk versi lama | Rendah | Referensi diperbarui | ADR-001 v1.3 frontmatter |
| 3.11 Lifecycle tanpa reactivation | Rendah | Diagram diperbarui | ADR-001 v1.3 §3.6 |
| 3.12 Lokasi dokumen di repo | Rendah | Struktur `docs/` + index ini | Infra v1.5 §6 |
| 3.13 Versi naik tanpa approval | Rendah | Status "Proposed" eksplisit; konvensi §3 | Semua dokumen |
| 4.1 Kapasitas sprint tidak realistis | Tinggi | Capacity model berbasis velocity; aturan self-review | Sprint Plan v1.3 §2.1–2.2 |
| 4.2 Dependensi & story hilang | Tinggi | Story tambahan; split; dependensi | Sprint Plan v1.3 §7–10; Infra v1.5 §2 |
| 4.3 Scope layak dipangkas | Sedang | Menu admin CRUD → P2 | Demo v1.3 §11.5; Sprint Plan v1.3 §11 |
| 5 Versi teknologi | — | Catatan verifikasi, compat check NestJS 12, patch Windows Next.js | Infra v1.5 §4.2; DEMO-0003/0004 |

## 4a. Permintaan tambahan → perbaikan

| Permintaan | Keputusan | Lokasi saat ini |
|---|---|---|
| Superadmin tetap ada (2026-09-16) | Kewenangan platform penuh; akses data tenant via break-glass support session (maks. 60 menit, alasan, default READ_ONLY, teraudit, terlihat tenant, tanpa approval kedua, tanpa impersonation) | ADR-003 v1.1; ADR-001 v1.3 §3.5; Infra v1.5 §8.3; Demo v1.3 §4–6, §11.2, §18.2b, Scenario 6; Sprint Plan v1.3 DEMO-0111/0311/0312/0313/0409/0504F |
| Eksekusi Opsi A (2026-09-16) | Policy `TO app_auth_definer` + grant kolom; tanpa `BYPASSRLS` | ADR-001 v1.3 §3.7, §4.6; Register v1.0 §2, §4 |

## 4b. Rapikan versi (2026-09-16)

| Masalah | Perbaikan |
|---|---|
| ADR-001 v1.0 menunjuk Infrastructure/General Feature v1.1 | File v1.0 ditandai `SUPERSEDED` |
| Dokumen aktif menunjuk versi lama | Disinkronkan (errata / versi baru) |
| File versi lama tanpa penanda eksplisit | Frontmatter + banner `SUPERSEDED` |

## 4c. Pelacakan temuan review v2 → perbaikan

| Temuan review v2 | Level | Penyelesaian | Lokasi saat ini |
|---|---|---|---|
| 1.1 Fungsi pre-context kena RLS | Kritis | **Opsi A**: policy `TO app_auth_definer` per tabel/operasi + grant kolom; spike & CI membuktikan | ADR-001 v1.3 §3.7; Register v1.0; Infra v1.5 §8.1, §8.7.1; DEMO-0100, 0109A/B |
| 1.2 Superadmin tanpa session; status sebelum pilih tenant | Kritis | `sessions`/`refresh_tokens` mixed-ownership `context_kind`; tiket pemilihan context ≤ 5 menit; login bercabang; skema/bootstrap superadmin ke Sprint 1 | ADR-003 v1.1 §2.6; ADR-001 v1.3 §3.8; Infra v1.5 §8.3, §8.6, §11; Demo v1.3 §7.3, §8; DEMO-0111, 0211 |
| 1.3 Email member tanpa sumber data | Tinggi | Contact email copy per tenant pada `tenant_member_profiles` | ADR-002 v1.1 §2.1, §2.6; Demo v1.3 §7.3; DEMO-0212 |
| 1.4 Kepercayaan GUC/READ ONLY terlalu kuat | Tinggi | Batas kepercayaan eksplisit + lint + alert | ADR-001 v1.3 §3.10; ADR-003 v1.1 §2.3; Infra v1.5 §8.7.3 |
| 1.5 Support ke tenant SUSPENDED vs verifikasi ACTIVE | Sedang | Pengecualian eksplisit context support, dipaksa READ_ONLY | ADR-003 v1.1 §2.2 aturan 10; Infra v1.5 §8.6 |
| 1.6 Notifikasi in-app tanpa tabel/story | Sedang | `tenant_notifications` minimal + F-15 | ADR-003 v1.1 §2.4; General v1.4 §12; Demo v1.3 §7.3; DEMO-0313 |
| 1.7 Audit tenant dari context platform | Sedang | Audit writer F-14 | ADR-001 v1.3 §3.8; Register v1.0 |
| 1.8 Daftar fungsi tidak konsisten | Sedang | Register sebagai sumber tunggal; dokumen lain merujuk F-xx | Register v1.0; ADR-001 v1.3 §3.7; Infra v1.5 §8.3; Demo v1.3 §7.2 |
| 1.9 Detail skema ADR-002 | Rendah | `members.invite`, `invitation_roles`, `accepted_membership_id`, `UNIQUE (tenant_id, id)` | ADR-002 v1.1 §2.1–2.2; Demo v1.3 §7.3 |
| 2.1 API `/users` di Infra | Tinggi | Diganti members/invitations/contexts | Infra v1.5 §9 |
| 2.2 Contoh modul `users/` | Sedang | Diganti `identity/`, `members/`, `platform/` | Infra v1.5 §6.1 |
| 2.3 Rujukan teks "Sprint Plan v1.1" | Sedang | Diperbaiki; pemeriksaan teks ditambahkan (§6) | ADR-001 v1.3 §3.9; Infra v1.5 §8.7.2 |
| 2.4 Lokasi pelacakan menunjuk arsip | Rendah | Kolom "Lokasi saat ini" | Index §4 |
| 2.5 Pemeriksaan tidak menangkap rujukan teks | Rendah | Kriteria 5 ditambahkan | Index §6 |
| 2.6 Heading DP §4.1 terselip | Rendah | **Belum diperbaiki** — kosmetik; dijadwalkan saat DP SSOT v1.2 | DP SSOT v1.1 §4 |

## 5. Masih terbuka (tidak dapat diselesaikan melalui dokumen)

1. **Verifikasi teks resmi PP 33/2026** dan status Permenkominfo 20/2016 — Legal/DPO.
2. Konfirmasi peran Pengendali/Prosesor dan template DPA — Legal/DPO.
3. Pilihan KMS production (opsi A atau B di DP SSOT §9.2 — berbeda dari Opsi A/B akses database) — Technical/Security.
4. Hasil spike DEMO-0100 (GO/NO-GO), termasuk bukti Opsi A — dapat mengubah ADR-001 §3.7/§3.9.
5. Velocity terukur → target demo date (397 point P0/P1).
6. Approval Technical, Security/Privacy, Operations untuk seluruh dokumen berstatus Proposed; review Security atas register.
7. Verifikasi Prisma 7 + `@prisma/adapter-pg` dan Node.js `24.21.x`.
8. MFA superadmin (blocker production), isi permission set support, dan daftar `reason_code` (ADR-003 §6).
9. Kebijakan sinkronisasi contact email saat email global berubah dan retensi email undangan (ADR-002 v1.1 §6).
10. Status kelembagaan Lembaga PDP untuk alur notifikasi 3×24 jam — perlu verifikasi.

## 6. Pemeriksaan konsistensi

Kriteria lulus:

1. Tepat satu file aktif per dokumen, sama dengan §1.
2. Setiap file selain yang ada di §1 memiliki `status: "SUPERSEDED"` dan banner.
3. Dokumen aktif tidak merujuk **file** versi `SUPERSEDED` kecuali pada field `supersedes`.
4. `superseded_by` pada arsip menunjuk versi aktif saat ini.
5. Dokumen aktif tidak merujuk versi lama dalam bentuk **teks** (misalnya "Infrastructure SSOT v1.3 §8.3"), kecuali pada catatan historis (blok "Perubahan vX.Y", baris change log, penanda "(v1.x)", atau kalimat koreksi).

## 7. Hasil pemeriksaan terakhir

**LULUS** — 2026-09-16: 9 dokumen aktif, 2 review, 17 arsip bertanda `SUPERSEDED` dengan `superseded_by` benar, 0 rujukan file basi, 0 rujukan teks basi di luar catatan historis. Pemeriksaan kriteria 5 menemukan dan memperbaiki 8 rujukan teks basi (General Feature v1.4 §6.3; Sprint Plan v1.3 DEMO-0004, 0101, 0106, 0110, 0305, 0504).
