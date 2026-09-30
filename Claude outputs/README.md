---
title: "SaaS Multi-Tenant Multi-Industry Baseline — README"
document_id: "BASELINE-README"
edition: "2.14 (consolidated final)"
status: "Consolidated Baseline — Proposed; specialist approval pending"
last_updated: "2026-09-27"
purpose: "Pintu masuk dokumentasi: daftar dokumen, urutan baca, aturan perubahan, keputusan terbuka, riwayat, dan ringkasan review"
---

# SaaS Multi-Tenant Multi-Industry Baseline

Folder ini berisi baseline arsitektur dan delivery untuk aplikasi SaaS multi-tenant lintas industri (Next.js + NestJS + Prisma + PostgreSQL). Dokumen dikelola satu file per dokumen tanpa akhiran versi; `edition` dinaikkan per dokumen sesuai §4. Edisi saat ini: `README.md` **2.11**; `SAAS_DEMO_FOUNDATION_SSOT.md` **2.7**; `ARCHITECTURE_DECISIONS.md` **2.5**; `INFRASTRUCTURE_SSOT.md` **2.5**; `SAAS_DEMO_SPRINT_PLAN.md` dan `DATA_PROTECTION_ENCRYPTION_SSOT.md` **2.1**; dokumen lain masih **2.0** karena tidak ada perubahan normatif.

> **Status penting:** "final" berarti **struktur dokumen final dan konsisten**, bukan disetujui. Seluruh keputusan rinci masih **Proposed** sampai Technical, Security/Privacy, Operations, dan Legal/DPO memberi sign-off. Dokumen ini bukan bukti kepatuhan UU PDP maupun production readiness.

## 1. Dokumen

| # | File | Isi | Dibaca oleh |
|---|---|---|---|
| 1 | `README.md` | Pintu masuk, aturan perubahan, keputusan terbuka, riwayat, review | Semua |
| 2 | `ARCHITECTURE_DECISIONS.md` | ADR-001 Multi-Tenancy, ADR-002 Identity, ADR-003 Superadmin & Break-Glass, **Lampiran A** register fungsi & policy database pre-context | Tech Lead, Security, Backend |
| 3 | `INFRASTRUCTURE_SSOT.md` | Stack & versi, struktur repo, environment, database role, Table Ownership Register, RLS, API baseline, auth, security, phase gates | Tech Lead, Backend, DevOps |
| 4 | `GENERAL_FEATURE_BASE_SSOT.md` | Modul horizontal lintas industri: tenancy, IAM, organization, party, reference data, settings, audit, files, notifications, workflow, approval, forms, integration, search, reporting | Tech Lead, Backend, Frontend |
| 5 | `DATA_PROTECTION_ENCRYPTION_SSOT.md` | Klasifikasi Data Pribadi (DP-0…DP-4), matriks enkripsi, key management/KMS, Pengendali/Prosesor, notifikasi 3×24 jam, hak subjek, Data Field Register | Security, Legal/DPO, Backend |
| 6 | `SAAS_DEMO_FOUNDATION_SSOT.md` | Scope demo tanpa fitur bisnis: login & context selection, undangan, RBAC, superadmin & support session, dynamic menu, audit, skema, API, test, 6 skenario demo | Product, Tech Lead, QA |
| 7 | `SAAS_DEMO_SPRINT_PLAN.md` | Backlog 6 milestone, 71 story, 400 point P0/P1 + 16 point P2, capacity model, risk register | Product, Delivery Lead, Tim |

Folder `_archive/` menyimpan seluruh versi sebelumnya dan dua laporan review. Arsip **tidak boleh** dirujuk oleh implementasi, ticket, atau review baru.

## 2. Urutan baca

1. `ARCHITECTURE_DECISIONS.md` ADR-001 §2–§3 — model tenancy dan batas keamanan.
2. `INFRASTRUCTURE_SSOT.md` §8 — database, RLS, Table Ownership Register.
3. `ARCHITECTURE_DECISIONS.md` ADR-002, ADR-003, Lampiran A — identitas, superadmin, akses pre-context.
4. `DATA_PROTECTION_ENCRYPTION_SSOT.md` §4–§9 — klasifikasi dan enkripsi.
5. `GENERAL_FEATURE_BASE_SSOT.md` — sesuai modul yang dikerjakan.
6. `SAAS_DEMO_FOUNDATION_SSOT.md` lalu `SAAS_DEMO_SPRINT_PLAN.md` — sebelum sprint planning.

## 3. Keputusan inti (ringkas)

| Topik | Keputusan | Rujukan |
|---|---|---|
| Tenancy | Shared PostgreSQL, shared schema, `tenant_id NOT NULL`, RLS `ENABLE` + `FORCE`, modular monolith | ADR-001 §2–§3 |
| Tenant vs organization | Tenant = batas keamanan & lifecycle; organization = struktur bisnis di dalam tenant | ADR-001 §2 |
| Akses sebelum tenant context | Fungsi `SECURITY DEFINER` milik `app_auth_definer` (NOLOGIN, tanpa `BYPASSRLS`) dengan **policy `TO app_auth_definer` per tabel/operasi + grant kolom** (Opsi A) | ADR-001 §3.7; Lampiran A |
| Batas kepercayaan RLS | RLS berbasis GUC melindungi dari bug aplikasi, bukan dari aplikasi yang dikompromikan; dimitigasi lint & alert | ADR-001 §3.10 |
| Identitas | Satu identitas global per orang; onboarding tenant hanya lewat undangan dengan respons seragam; profil & contact email per tenant | ADR-002 |
| Superadmin | Kewenangan platform penuh; data tenant hanya via break-glass support session (≤ 60 menit, alasan, default READ_ONLY, teraudit, terlihat tenant, tanpa impersonation) | ADR-003 |
| Session | `context_kind` TENANT/PLATFORM; tiket pemilihan context ≤ 5 menit | ADR-003 §2.6 |
| Enkripsi Data Pribadi | Field-level AES-256-GCM envelope, DEK per tenant/purpose, blind index HMAC; identitas global memakai key `platform_identity` sebagai pengecualian terkontrol | Data Protection §8–§9 |
| Delivery | Durasi dari velocity terukur; spike Prisma + RLS + Opsi A (DEMO-0100) adalah go/no-go pertama | Sprint Plan §2.2, DEMO-0100 |

## 4. Aturan perubahan

- **Nama file tetap** (tanpa akhiran versi). Setiap perubahan normatif menaikkan `edition` di frontmatter (`2.0 → 2.1` untuk tambahan/koreksi; `3.0` bila membalik keputusan inti) dan menambah satu baris di bagian **Riwayat** dokumen tersebut serta di §5 README ini.
- Riwayat lengkap diserahkan ke **git** setelah repository dibuat; salinan file per versi tidak dibuat lagi.
- Perubahan editorial (typo, rujukan) tidak menaikkan edisi, tetapi tetap dicatat di Riwayat sebagai `editorial`.
- Status `Proposed` tidak boleh dibaca sebagai approval Technical, Security/Privacy, Legal/DPO, atau Operations. Approval dicatat di tabel approval masing-masing dokumen.
- Daftar fungsi `SECURITY DEFINER` dan policy `TO app_auth_definer` **hanya** boleh ditulis di `ARCHITECTURE_DECISIONS.md` Lampiran A; dokumen lain merujuk ID fungsi (F-01…F-17).
- Rujukan antar dokumen memakai nama dokumen + bagian (misalnya "Infrastructure SSOT §8.3", "ADR-003 §2.6"), **tanpa** nomor versi.
- Pemeriksaan konsistensi (§7) wajib lulus sebelum dokumen dibagikan atau di-commit.

## 5. Riwayat baseline

| Edisi / versi lama | Tanggal | Perubahan utama |
|---|---|---|
| v1.0–v1.2 (dokumen asal) | 2026-09-16 | Infrastructure & General Feature v1.2 (multi-tenant + enkripsi PDP), Data Protection v1.0, ADR-001 v1.0, Demo Foundation & Sprint Plan v1.0 |
| Review v1 | 2026-09-16 | 3 temuan kritis: jalur pre-tenant-context tidak ada; identitas global bocor lintas tenant; PP 33/2026 tidak dirujuk. Ditambah inkonsistensi tabel, kapasitas sprint tidak realistis |
| Revisi I | 2026-09-16 | ADR-001 v1.1 (pre-context functions, mixed-ownership, pola ORM), ADR-002 v1.0 (identitas & undangan), Data Protection v1.1 (PP 33/2026, Pengendali/Prosesor, notifikasi, hak subjek, KMS), Infrastructure v1.3, General v1.3, Demo & Sprint v1.1 (capacity model) |
| Revisi II | 2026-09-16 | Superadmin tetap ada: ADR-003 v1.0 (break-glass support session), ADR-001 v1.2, Infrastructure v1.4, Demo & Sprint v1.2 |
| Rapikan versi | 2026-09-16 | Penanda `SUPERSEDED` pada versi lama; sinkronisasi rujukan (errata) |
| Review v2 | 2026-09-16 | 2 temuan kritis pada revisi sendiri: fungsi pre-context tetap terkena RLS; superadmin tidak punya session. Ditambah: email member tanpa sumber data, klaim kekuatan GUC berlebihan, API `/users` tersisa |
| Revisi III (Opsi A) | 2026-09-16 | ADR-001 v1.3 (policy `TO app_auth_definer`, batas kepercayaan GUC), ADR-002 v1.1 (contact email, `invitation_roles`), ADR-003 v1.1 (session PLATFORM, tiket context, `tenant_notifications`), register pre-context v1.0, Infrastructure v1.5, General v1.4, Demo & Sprint v1.3 (397 point) |
| **2.0** | 2026-09-16 | **Konsolidasi final:** 29 file → 7 file aktif + `_archive/`; 3 ADR + register digabung; penanda revisi dihapus; heading Data Protection §4.1 dirapikan; seluruh rujukan tanpa nomor versi |
| Review eksternal | 2026-09-19 | 9 temuan terhadap dokumen v1.x (arsip). 3 sudah tertutup oleh edisi 2.0 (blind index global, status dokumen, governance versi); 5 valid dan 1 valid sebagian. Ditemukan tambahan: `invitation_roles` (Sprint 1) memerlukan `roles` (Sprint 3) |
| **2.1** | 2026-09-19 | **Perbaikan integritas & urutan:** composite FK tenant-safe `sessions`/`refresh_tokens`; constraint konseptual → objek database nyata (partial unique index, kolom `owner_key`); urutan dependency Sprint 1 dan Sprint 2 diperbaiki; `invitation_roles` + DEMO-0309 dipindah ke Sprint 3; DEMO-0307 tidak lagi menuntut kapabilitas Sprint 4; checkpoint Security/Operations wajib pada exit gate Sprint 1 dan 3. 400 point / 71 story |
| **2.2** | 2026-09-21 | **Data Protection 2.1:** §9.2 opsi demo C2 (berkas kunci acak tanpa passphrase, di luar repository) ditambahkan dengan syarat; opsi C dinyatakan pengecualian demo terhadap §9. Keputusan pemilik proyek; production tidak berubah |
| **2.3** | 2026-09-22 | **Undangan (D-09):** ADR 2.1 — Lampiran A menambah F-16 (identitas baru saat menerima undangan) dan menyelaraskan F-11/F-12 serta policy §4 dengan implementasi; Infrastructure dan Demo Foundation 2.2 — kolom fungsi pada Table Ownership Register mengikuti. Keputusan pemilik proyek; review Security pending |
| **2.4** | 2026-09-22 | §7 kriteria 1: folder implementasi `app/` diakui di folder utama, dengan larangan menyalin dokumen normatif ke dalamnya. Salinan README edisi 2.0 di `app/README.md` diganti README kode. Keputusan pemilik proyek |
| **2.5** | 2026-09-22 | ADR 2.2: penanda sementara `is_owner` dihapus setelah RBAC demo (slice 10); Lampiran A §4 dan ADR-002 §2.2 diselaraskan. Keputusan pemilik proyek |
| **2.6** | 2026-09-22 | ADR 2.3: F-12 memberi role undangan (DEMO-0309) dan policy definer terkait; aturan role diarsipkan dilewati. Keputusan pemilik proyek |
| **2.7** | 2026-09-22 | Demo Foundation 2.3: permission penanda `owners.manage` hanya di `tenant_owner` (D-28) sehingga anti-eskalasi melindungi pemegang role owner; endpoint `POST /members/:membershipId/reactivate` (D-27). Keputusan pemilik proyek |
| **2.8** | 2026-09-22 | Demo Foundation 2.4 §15: nama event audit mengikuti konvensi implementasi (`<domain>.<aksi>` + `outcome` + reason code); `auth.refresh.reuse_detected` nama tersendiri untuk alarm. ADR dan Sprint Plan: penyelarasan contoh/AC (editorial). Keputusan pemilik proyek (D-29) |
| **2.9** | 2026-09-23 | ADR 2.4: F-14 dicatat sesuai implementasi dan F-17 (penghitung kegagalan rate limiting) didaftarkan; allowlist nama event menjadi katalog `audit_event_types` + foreign key. Demo Foundation 2.5 dan Infrastructure 2.3: katalog itu masuk inventory dan Table Ownership Register. Keputusan pemilik proyek (D-30) |
| **2.10** | 2026-09-23 | Demo Foundation 2.6: §7.3 diselaraskan dengan implementasi (kolom, tipe, constraint, partial index); tabel yang belum dibuat ditandai rencana. Infrastructure 2.4: `crypto_keys` masuk Table Ownership Register. Keputusan pemilik proyek (D-31) |
| **2.11** | 2026-09-26 | ADR 2.5: Lampiran A F-15 dicatat sesuai implementasi (`auth.notify_tenant_security_event`; schema `audit_w` yang tidak pernah ada di database dihapus dari ADR-003 §2.2/§2.3 dan Lampiran A §2), F-04 mengembalikan context PLATFORM sebagai baris, F-07 menolak membership yang bukan milik pemakainya dengan pembagian eksplisit batas orang (fungsi) dan batas tenant (composite FK); edisi frontmatter ADR dikoreksi dari 2.3 ke 2.5. Infrastructure 2.5: `platform_role_permissions` masuk Table Ownership Register dan entri `platform_role_assignments` dikoreksi (grant ada, tetapi hanya terbuka pada context platform). Demo Foundation 2.7: bentuk `POST /auth/select-context` (`kind`), bentuk `GET /me/contexts`, dan `kind` pada `GET /me/permissions`. Keputusan pemilik proyek (slice 13, DEMO-0311 dan DEMO-0313) |
| **2.12** | 2026-09-27 | ADR 2.6: ADR-003 §2.4 `reason_text` memakai DEK PLATFORM (bukan DEK tenant - penulisnya berjalan di context platform, dan kunci tenant hanya diserahkan di dalam context tenant pemiliknya), kolom `platform_session_id`/`ended_by`/`reason_text_key_version` dicatat, §6 menutup tiga keputusan terbuka (daftar `reason_code`, isi SUPPORT_READ_SET/WRITE_SET + SUPPORT_MUTATION_SET, durasi 60 menit) dan menyisakan idle timeout, Lampiran A menambah F-18 dan F-19 beserta grant kolom `support_sessions`. Infrastructure 2.6: entri `support_sessions` di Table Ownership Register dilengkapi, dan §8.7.1 mencatat GUC `app.support_session_id` (fail-closed) serta urutan wajib `SET TRANSACTION READ ONLY` sebelum `set_config`. Demo Foundation 2.8: blok §7.3 `support_sessions`, `tenant_notifications` tidak lagi rencana (FK komposit), `GET /support-sessions` sisi tenant, dan banner mode support di §12.1. Semuanya menyelaraskan dokumen dengan implementasi slice 14 (DEMO-0312) |
| **2.13** | 2026-09-27 | Infrastructure 2.7: kontrak unit of work memuat pematokan `TimeZone='UTC'` transaction-local, dan durasi untuk keputusan dihitung database sebagai detik. Sebabnya ditemukan saat verifikasi slice 14 di mesin target: Prisma membaca `timestamptz` sebagai jam dinding sesi database lalu melabelinya UTC, sehingga pada server dengan TimeZone `Asia/Jakarta` setiap nilai waktu yang dibaca aplikasi bergeser tujuh jam - termasuk tanggal yang ditampilkan web sejak slice 8 |
| **2.14** | 2026-09-28 | Demo Foundation 2.9, ADR 2.7, Infrastructure 2.8: `menus` dan `menu_permissions` dicatat sesuai implementasi (migrasi 0021) dan tidak lagi berstatus rencana — `context_kind` pada menu, `is_public_authenticated` sebagai satu-satunya pengecualian deny-by-default, trigger hierarki terdaftar sebagai Lampiran A **F-20**, dan grant baca-saja untuk `app_user`. `menus.read` ditegaskan sebagai permission administrasi menu dan BUKAN syarat `GET /me/menu` (route itu tanpa permission, supaya anggota tanpa role tetap mendapat kerangkanya). Contoh respons §10.3 diganti dengan bentuk yang benar-benar dikembalikan, beserta catatan bahwa amplop `{success,data,meta}` tidak dipakai endpoint mana pun. Infrastructure menambahkan aturan lingkungan: zona waktu server database di pengembangan/demo dipatok BUKAN UTC oleh `db.sh`/`db.ps1`, karena cacat pembacaan `timestamptz` (D-40) tidak bergejala pada server UTC — sebelumnya aturan itu hanya catatan yang hilang pada `reset` berikutnya. Implementasi: DEMO-0409 Bagian A (menu dinamis), 311 kasus hijau di lingkungan pengembangan; verifikasi mesin target belum dijalankan |

## 6. Ringkasan review dan status tindak lanjut

Laporan lengkap: `_archive/REVIEW_BASELINE_DOCS_2026-09-16.md` dan `_archive/REVIEW_BASELINE_DOCS_v2_2026-09-16.md`.

| Temuan | Level | Status | Lokasi penyelesaian |
|---|---|---|---|
| Jalur pre-tenant-context tidak didefinisikan; fungsi definer terkena RLS | Kritis | Selesai (desain) — menunggu bukti spike | ADR-001 §3.7; Lampiran A; Infrastructure §8.1, §8.7.1; DEMO-0100, 0109A/B |
| Identitas global bocor lintas tenant | Kritis | Selesai (desain) | ADR-002; Demo §7.3, §11; DEMO-0210 |
| Superadmin tanpa session / status sebelum pilih tenant | Kritis | Selesai (desain) | ADR-003 §2.6; Infrastructure §8.3, §8.6, §11; DEMO-0111, 0211 |
| PP 33/2026 tidak dirujuk | Kritis | Sebagian — dirujuk, **teks resmi belum diverifikasi** | Data Protection §2 |
| Enkripsi identitas vs aturan kunci tenant | Tinggi | Selesai | Data Protection §9.1 |
| Pencarian nama/email member | Tinggi | Selesai (desain) | Data Protection §8.4; ADR-002 §2.5–2.6; DEMO-0212 |
| Prisma + RLS diremehkan | Tinggi | Selesai (desain) — menunggu spike | ADR-001 §3.9; Infrastructure §8.7.2 |
| Klaim kekuatan GUC/READ ONLY berlebihan | Tinggi | Selesai | ADR-001 §3.10; ADR-003 §2.3; Infrastructure §8.7.3 |
| Kewajiban PDP (Pengendali/Prosesor, notifikasi, hak subjek, RoPA) | Tinggi | Selesai (engineering) — perlu Legal/DPO | Data Protection §2.1, §12–§13 |
| Inkonsistensi klasifikasi tabel, role assignment, settings tenant, audit, API `/users` | Tinggi/Sedang | Selesai | Infrastructure §8.3, §9; General §5, §9, §10 |
| Kapasitas sprint tidak realistis; story & dependensi hilang | Tinggi | Selesai | Sprint Plan §2.2, §7–§12 |
| KMS/HSM pada VPS | Sedang | Sebagian — opsi ditetapkan, pilihan belum | Data Protection §9.2; DEMO-0010 |
| Notifikasi in-app & audit lintas context | Sedang | Selesai (desain) | ADR-003 §2.3–2.4; Lampiran A F-14/F-15; DEMO-0313 |
| Regulasi sektoral / isolation tier | Sedang | **Belum** — perlu ADR bila ada tenant regulated | General §30; ADR-001 §4.1 |
| Integritas tenant `sessions`/`refresh_tokens` tanpa composite FK | Kritis | Selesai (desain) | Demo §7.3; DEMO-0203 |
| Constraint konseptual (`UNIQUE active assignment`, "ownership scope") | Tinggi | Selesai | Demo §7.3; DEMO-0302, 0401 |
| Urutan dependency Sprint 1 (membership sebelum `users`) | Tinggi | Selesai | Sprint Plan §8.2; DEMO-0101, 0104 |
| Urutan dependency login sebelum session persistence | Tinggi | Selesai | Sprint Plan §9.2; DEMO-0202, 0203 |
| `invitation_roles` memerlukan `roles` yang baru ada di Sprint 3 | Tinggi | Selesai | Sprint Plan §10.2; DEMO-0302, 0309 |
| Sprint 3 UI menuntut effective menu (kapabilitas Sprint 4) | Sedang | Selesai | Sprint Plan DEMO-0307, 0408 |
| Mitigasi "specialist checkpoint Sprint 1–4" tanpa gate pendukung | Sedang | Selesai | Sprint Plan §8.3, §10.3, §16 |

## 7. Pemeriksaan konsistensi

Kriteria lulus:

1. Folder utama hanya berisi 7 file pada §1, folder `_archive/`, dan folder implementasi `app/`. Dokumen di `app/` adalah dokumentasi kode: tidak memuat salinan dokumen normatif (tidak ada berkas dengan `document_id` baseline) dan merujuk dokumen normatif dengan nama + bagian.
2. Dokumen aktif tidak merujuk file berakhiran versi (`_vX.Y.md`), `DOCUMENT_VERSION_INDEX.md`, atau file review secara langsung kecuali melalui `_archive/`.
3. Dokumen aktif tidak memuat penanda revisi (`Perubahan vX.Y`, `(baru vX.Y)`, `(vX.Y)`) atau rujukan versi dalam teks ("Infrastructure SSOT v1.3").
4. Setiap dokumen memiliki `edition` dan bagian Riwayat.
5. Story point per milestone di Sprint Plan sama dengan angka yang tertulis, dan setiap ID story memiliki acceptance criteria.

Hasil terakhir: lihat bagian bawah.

## 8. Masih terbuka

1. **Verifikasi teks resmi PP 33/2026** dan status Permenkominfo 20/2016 — Legal/DPO (blocker production).
2. Konfirmasi peran Pengendali/Prosesor dan template DPA dengan tenant — Legal/DPO.
3. Status kelembagaan Lembaga PDP untuk alur notifikasi 3×24 jam — perlu verifikasi.
4. Pilihan KMS production (opsi A atau B di Data Protection §9.2 — **berbeda** dari Opsi A akses database di ADR-001) — Technical/Security.
5. Hasil spike DEMO-0100 (GO/NO-GO), termasuk bukti Opsi A.
6. Velocity terukur → target demo date (400 point P0/P1).
7. Approval Technical, Security/Privacy, Operations, Legal/DPO; review Security atas Lampiran A.
8. Verifikasi Prisma 7 + `@prisma/adapter-pg` dan Node.js `24.21.x`.
9. MFA superadmin (blocker production), permission set support, dan daftar `reason_code`.
10. Sinkronisasi contact email saat email global berubah; retensi email undangan.
11. ADR isolation tier untuk tenant sektor teregulasi (kesehatan, keuangan) bila dibutuhkan.

## Hasil pemeriksaan terakhir

**LULUS** — 2026-09-28 (edisi 2.14; perubahan 2.14 menyentuh Demo Foundation, ADR, dan Infrastructure, seluruhnya menyelaraskan dokumen dengan implementasi DEMO-0409 Bagian A; kriteria 1-5 tetap seperti hasil di bawah, dan folder utama tetap 7 file + `_archive/` + `app/`). Satu perbedaan dokumen-vs-implementasi ditutup dengan mengubah DOKUMEN: contoh respons `GET /me/menu` di Demo Foundation §10.3 memakai amplop `{success,data,meta}` yang tidak dipakai satu endpoint pun — menyelaraskan kode dengan contoh itu justru akan menjadikan satu endpoint pengecualian, jadi contohnya yang dikoreksi dan keputusan amplop seragam dicatat sebagai belum diambil. Satu fungsi `SECURITY DEFINER` ditemukan berjalan di luar register dan didaftarkan (F-20) — pola yang sama dengan F-15 dan F-17 sebelumnya, dan alasan mengapa kriteria "tidak ada fungsi di luar register" perlu menjadi test CI, bukan pemeriksaan manual.

Pemeriksaan sebelumnya: **LULUS** — 2026-09-27 (edisi 2.13, mencakup 2.12; perubahan 2.12 menyentuh ADR, Infrastructure, dan Demo Foundation, seluruhnya menyelaraskan dokumen dengan implementasi slice 14 (DEMO-0312); kriteria 1-5 tetap seperti hasil di bawah, dan folder utama tetap 7 file + `_archive/` + `app/`). Satu perbedaan dokumen-vs-implementasi ditutup dengan mengubah DOKUMEN, bukan kode: ADR-003 §2.4 menuliskan DEK tenant untuk `reason_text`, sementara implementasi memakai DEK platform - dan alasan implementasinya lebih kuat (lihat baris 2.12).

Pemeriksaan sebelumnya: **LULUS** — 2026-09-26 (edisi 2.11; perubahan 2.11 menyentuh ADR, Infrastructure, dan Demo Foundation, seluruhnya menyelaraskan dokumen dengan implementasi slice 13; kriteria 1-5 tetap seperti hasil di bawah, dan folder utama tetap 7 file + `_archive/` + `app/`).

Pemeriksaan sebelumnya: **LULUS** — 2026-09-23 (edisi 2.10; perubahan 2.5–2.10 menyentuh ADR, Demo Foundation, Infrastructure, Sprint Plan (editorial, tanpa perubahan story maupun point), dan README; kriteria 1–5 tetap seperti hasil edisi 2.4 di bawah; §7.3 kini memuat kolom implementasi, bukan rujukan versi):

1. Folder utama: 7 file aktif, `_archive/`, dan `app/`. Tidak ada berkas di `app/` yang memuat `document_id` baseline.
2. Tidak ada rujukan ke file berversi, `DOCUMENT_VERSION_INDEX.md`, atau file review di dokumen aktif kecuali melalui `_archive/`.
3. Rujukan `vX.Y` yang tersisa hanya di frontmatter `supersedes_archive` dan baris Riwayat, keduanya menunjuk arsip.
4. Setiap dokumen punya `edition` dan Riwayat (README: §5).
5. Tidak terdampak: Sprint Plan tidak berubah sejak pemeriksaan edisi 2.1 (71 story, 400 point P0/P1).

Pemeriksaan sebelumnya: **LULUS dengan satu catatan** — 2026-09-21 (edisi 2.2): kriteria 2–5 lulus; kriteria 1 dilanggar oleh `app/`, kini diselesaikan di edisi 2.4. Sebelumnya lagi: **LULUS** — 2026-09-19 (edisi 2.1).
