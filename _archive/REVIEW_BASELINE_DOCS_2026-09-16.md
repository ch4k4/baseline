---
title: "Review Dokumen Baseline SaaS Multi-Tenant"
reviewed_at: "2026-09-16"
scope:
  - ADR-001-SAAS-MULTI-TENANCY.md (v1.0)
  - INFRASTRUCTURE_SSOT_v1.2.md
  - GENERAL_FEATURE_BASE_SSOT_v1.2.md
  - DATA_PROTECTION_ENCRYPTION_SSOT_v1.0.md
  - SAAS_DEMO_FOUNDATION_SSOT_v1.0.md
  - SAAS_DEMO_SPRINT_PLAN_v1.0.md
method: "Baca penuh 6 dokumen, cek konsistensi silang, verifikasi web untuk regulasi & versi teknologi"
---

# Review Dokumen Baseline SaaS Multi-Tenant

## 0. Ringkasan

Kualitas dokumen di atas rata-rata. Keputusan intinya bisa dipertanggungjawabkan: shared schema, `tenant_id` di setiap tabel, RLS sebagai lapisan kedua, dan pemisahan tenant dari organization. Aturan tentang kontrol dan approval juga ditulis dengan disiplin.

Masalah terbesarnya **bukan kekurangan kontrol**. Masalahnya ada tiga:

1. **Ada lubang desain di jalur sebelum tenant context terbentuk.** Login, refresh, resolusi domain, dan audit login gagal harus membaca tabel yang dilindungi RLS sebelum tenant diketahui. Belum ada dokumen yang menjelaskan bagaimana jalur ini dibuka dengan aman. Kalau diimplementasikan persis seperti tertulis, login tidak akan jalan. Kalau developer menambal sendiri, hampir pasti hasilnya bypass RLS yang tidak terkontrol.
2. **Model identitas global bertentangan dengan dokumen induk dan membuka kebocoran lintas tenant.**
3. **Regulasi sudah berubah.** PP 33/2026, aturan pelaksana UU PDP, terbit 16 Juli 2026 dan tidak dirujuk sama sekali, padahal dokumen mengklaim "diverifikasi 2026-09-16".

Sprint plan (338 story point dalam 6 minggu) tidak realistis jika dikerjakan tim kecil atau satu orang.

Label: **[KRITIS]** memblokir implementasi atau keamanan · **[TINGGI]** harus diputuskan sebelum sprint terkait · **[SEDANG]** perbaiki saat revisi · **[RENDAH]** kerapian.

---

## 1. Temuan desain dan keamanan

### 1.1 [KRITIS] Jalur "pre-tenant-context" tidak didefinisikan

Aturan yang ada saat ini:

- RLS memakai `FORCE ROW LEVEL SECURITY`.
- Runtime role tidak memiliki `BYPASSRLS`.
- Query tanpa `app.current_tenant_id` harus mengembalikan 0 baris (fail-closed).

Di sisi lain, Demo SSOT §7.2 menandai `tenant_domains`, `tenant_memberships`, `sessions`, dan `refresh_tokens` sebagai tabel yang wajib RLS. Beberapa operasi berikut justru harus membaca tabel-tabel itu sebelum tenant diketahui:

| Operasi | Tabel yang harus dibaca tanpa tenant context |
|---|---|
| Resolusi host/domain → tenant (Infra §8.6) | `tenant_domains` |
| Login: "list active tenant memberships" (Demo §8.1) | `tenant_memberships` |
| `POST /auth/refresh`: cari token berdasarkan hash | `refresh_tokens`, `sessions` |
| `GET /me/tenants` sebelum tenant dipilih | `tenant_memberships`, `tenants` |
| Audit `auth.login.failed` (user/tenant belum diketahui) | insert `audit_logs` dengan `tenant_id NULL`, yang ditolak oleh `WITH CHECK` |
| Route `/platform/*` | `tenants`, audit platform |

Konsekuensinya, desain seperti tertulis **tidak bisa berjalan**. Developer yang tertekan jadwal biasanya "memperbaikinya" dengan cara berbahaya: memakai koneksi owner, mematikan FORCE RLS, atau menambah policy `OR current_setting(...) IS NULL`.

**Rekomendasi:** tambahkan satu bagian normatif "Pre-context & platform access path" di ADR-001 dan Infra SSOT. Isinya:
- Fungsi `SECURITY DEFINER` yang sempit per use case, misalnya `auth_find_memberships(user_id)`, `auth_find_refresh_token(token_hash)`, dan `resolve_tenant_by_host(host)`. Fungsi dimiliki role terpisah, `search_path` dikunci, dan hanya mengembalikan kolom minimum.
- *Atau* role DB kedua (`app_auth`) dengan policy khusus. Pilih salah satu dan jangan dicampur.
- Policy untuk baris `tenant_id IS NULL` (menu platform, audit platform) yang dipisahkan untuk operasi baca dan tulis.
- Test negatif bahwa fungsi-fungsi ini tidak bisa dipakai untuk enumerasi.

Keputusan ini harus masuk Sprint 1. Saat ini belum ada story untuk itu.

### 1.2 [KRITIS] Identitas global `users` membuka kebocoran lintas tenant

Demo SSOT §7.3 menetapkan `users` sebagai tabel global dengan `email_blind_index UNIQUE` global. Admin tenant juga bisa `POST /users` dan `PATCH /users/:id`. Akibatnya:

- **Enumerasi lintas tenant.** Admin Tenant A membuat user dengan email yang sudah terdaftar di Tenant B dan mendapat `409 CONFLICT`. Respons itu membocorkan bahwa orang tersebut adalah pengguna platform.
- **Penulisan lintas tenant.** Kalau admin A mengubah `full_name` user multi-tenant, perubahan itu ikut terlihat di Tenant B. Admin A mengubah data yang "dimiliki" identitas di tenant lain.
- **Account linking tanpa persetujuan.** Dokumen tidak menjelaskan apa yang terjadi saat admin A "membuat" user yang emailnya sudah ada. Apakah identitas lama dilampirkan ke Tenant A tanpa persetujuan pemiliknya?
- **Offboarding tenant tidak bisa menghapus identitas.** Nama dan email dienkripsi dengan kunci platform (bukan DEK tenant), jadi crypto-shredding per tenant tidak berlaku.

Masalah ini diperparah kontradiksi dokumen. Demo SSOT §24 masih mencantumkan "email globally unique vs tenant-scoped" sebagai *open decision*, padahal skema di §7.3 sudah memutuskannya secara diam-diam. Ini melanggar aturan "open decision tidak boleh diisi asumsi" yang ditulis di dokumen yang sama.

**Rekomendasi:** putuskan secara eksplisit lewat ADR-002 "Identity model":
- Admin tenant hanya boleh **mengundang**, bukan membuat identitas. Undangan diterima oleh pemilik email.
- Respons create/invite dibuat seragam, apa pun status email tersebut.
- Profil per tenant (display name, jabatan) dipisah ke tabel tenant-owned. Identitas global hanya bisa diubah oleh pemiliknya.

### 1.3 [TINGGI] Enkripsi identitas bertentangan dengan Data Protection SSOT

Beberapa aturan saling bertabrakan:

- DP SSOT §8.1 menetapkan AAD berisi `tenant_id`. §8.2 mewajibkan blind index yang "tenant-scoped" dan memasukkan tenant ke input/key. §9 mewajibkan "setiap tenant memiliki logical DEK separation".
- Demo SSOT dan DEMO-0105 memakai **platform-identity key** dan blind index **global** untuk `users`.

Deviasi ini masuk akal secara teknis, karena login memang perlu lookup email global. Masalahnya, deviasi hanya tercatat di dokumen anak. DP SSOT sendiri menyatakan perubahan key hierarchy "MUST diperbarui dan disetujui di dokumen ini sebelum implementasi". Artinya, perlu revisi **DP SSOT v1.1** yang menambah key purpose `platform_identity` beserta aturan AAD dan blind index untuk data global.

### 1.4 [TINGGI] Enkripsi `full_name` mematikan fungsi admin dasar

`full_name` dienkripsi acak. Pencarian prefix/fuzzy "tidak tersedia secara default" (DP SSOT §8.2), sementara Users admin UI wajib punya list, filter, dan pagination. Hasilnya, admin tenant **tidak bisa mencari user berdasarkan nama** dan tidak bisa mengurutkan list berdasarkan nama. Untuk aplikasi SaaS nyata, ini akan jadi keluhan pertama pengguna.

Tidak ada dokumen yang mengakui trade-off ini. Opsi yang bisa dipertimbangkan:
- n-gram blind index yang disetujui (ada risiko inferensi; perlu review);
- dekripsi di aplikasi lalu filter di memori untuk tenant kecil (ada batas skala);
- menerima keterbatasan ini dan mendokumentasikannya.

Pilih salah satu sebelum Sprint 3.

Catatan terkait: klaim bahwa nama lengkap *wajib* field-encryption adalah **keputusan kontrol internal, bukan kewajiban eksplisit UU PDP** (DP SSOT §2 sendiri mengakui hal ini). Dasar yang lebih kuat adalah Permenkominfo 20/2016 Pasal 15(2), tetapi status dan relasinya dengan PP 33/2026 perlu dicek ulang (lihat §2). [Medium confidence]

### 1.5 [TINGGI] Integrasi Prisma + RLS diremehkan

- **Prisma Migrate tidak merepresentasikan `CREATE POLICY`, `ENABLE/FORCE RLS`, fungsi `SECURITY DEFINER`, maupun composite FK tertentu di schema model.** Semua itu harus ditulis sebagai SQL manual di migration, atau dikelola dengan tool lain. Akibatnya, `prisma migrate dev` bisa mendeteksi drift. Tidak ada dokumen yang menetapkan strateginya. [High confidence; sumber: Atlas guide]
- Untuk menyetel tenant context, pola yang umum dipakai adalah Client Extension yang membungkus setiap query dalam batch `$transaction([set_config(...,true), query])`. Pola ini bentrok dengan interactive transaction (`$transaction(async tx => …)`) yang dibutuhkan use case multi-langkah seperti refresh rotation dan replace permissions. Dokumen perlu satu pola resmi: **satu interactive transaction per unit of work, dengan `set_config` sebagai statement pertama**, beserta aturan timeout-nya.
- Setiap request protected juga memverifikasi status tenant dan membership ke DB (Infra §8.6). Artinya ada minimal 1–2 query tambahan per request. Ini dapat diterima, tetapi sebaiknya dinyatakan eksplisit sebagai biaya yang disadari. JWT tidak benar-benar stateless.

**Rekomendasi:** jadikan spike Prisma + RLS + pool-reuse sebagai **story pertama Sprint 1** dengan timebox dan kriteria go/no-go. Saat ini spike hanya disebut di risk register.

### 1.6 [SEDANG] KMS/HSM wajib, tetapi target produksinya "Linux VPS"

Acceptance global Infra §17 mewajibkan "KMS/HSM … diuji". Deployment target-nya VPS, sementara provider KMS masih open decision di tiga dokumen. Di VPS tunggal tidak ada HSM. Opsi realistisnya OpenBao/Vault Transit (self-hosted, sehingga Anda sendiri yang harus mengoperasikan dan mem-backup unseal key) atau cloud KMS yang dipanggil dari VPS (latensi dan data residency).

Keputusan ini memengaruhi desain crypto adapter di Sprint 1. Jangan biarkan terbuka sampai produksi.

---

## 2. Regulasi: temuan hasil riset

### 2.1 [KRITIS] PP 33/2026 tidak dirujuk

PP 33 Tahun 2026, aturan pelaksana UU PDP, **ditetapkan 16 Juli 2026 dan mulai berlaku 16 Januari 2027** (6 bulan setelah diundangkan). Menurut ringkasan sekunder, isinya mencakup:
- kewajiban Pengendali dan **Prosesor** (termasuk kewajiban Prosesor melaporkan kegagalan ke Pengendali);
- notifikasi kegagalan pelindungan **paling lambat 3×24 jam** kepada subjek data dan Lembaga;
- kriteria wajib PPDP/DPO;
- DPIA untuk pemrosesan berisiko tinggi;
- langkah teknis (pseudonimisasi, enkripsi, ketahanan sistem, pengujian berkala);
- pencatatan transfer lintas negara.

[Medium confidence. Bersumber dari artikel sekunder, bukan teks resmi PP. **Perlu verifikasi terhadap teks resmi di JDIH/peraturan.go.id**, termasuk apakah PP ini mengubah atau mencabut Permenkominfo 20/2016.]

DP SSOT §2 menyatakan baseline "diverifikasi pada 2026-09-16" tetapi hanya merujuk UU 27/2022, Permenkominfo 20/2016, dan PP 71/2019. Klaim verifikasi itu **tidak akurat** dan harus dikoreksi.

### 2.2 [TINGGI] Celah kewajiban PDP yang belum ada di dokumen

| Kewajiban | Status di dokumen |
|---|---|
| **Peran Pengendali vs Prosesor.** Dalam SaaS B2B, platform biasanya Prosesor untuk data milik tenant, tetapi Pengendali untuk data akun/billing sendiri | Tidak dibahas sama sekali. Ini dasar untuk kontrak (DPA) dengan tenant |
| Notifikasi kegagalan 3×24 jam (UU PDP Pasal 46; dipertegas PP 33/2026) | Tidak ada runbook, alur deteksi, atau data yang dibutuhkan untuk menentukan subjek terdampak per tenant |
| Hak subjek data (akses, koreksi, penghapusan, portabilitas) beserta tenggat respons | Hanya disebut sekilas ("subject-right workflow", "extension") |
| Record of Processing Activities | Data Field Register sudah mendekati, tetapi belum mencakup pencatatan per aktivitas pemrosesan |
| Transfer lintas negara (email/SMS provider, KMS cloud luar negeri) | Hanya "processor_or_recipient" di register |
| PPDP/DPO | Hanya placeholder approver |

### 2.3 [SEDANG] Regulasi sektoral multi-industri

Dokumen menyebut healthcare sebagai target. Sektor kesehatan punya aturan sendiri (rekam medis, retensi, lokasi data), begitu pula keuangan (OJK/BI). Dokumen sudah benar menyerahkannya ke domain module. Namun ada satu keputusan yang **tidak bisa ditunda ke domain**: *shared database* dengan kunci per tenant bisa saja tidak cukup untuk tenant yang diwajibkan isolasi fisik atau lokasi data tertentu. ADR-001 §4.1 sudah menyebut "premium isolation tier", tetapi belum menjelaskan jalur migrasi portability-nya. [Low confidence terhadap persyaratan spesifik tiap sektor; perlu verifikasi per domain.]

---

## 3. Inkonsistensi antar dokumen

| # | Level | Temuan | Lokasi |
|---|---|---|---|
| 3.1 | TINGGI | `sessions`, `refresh_tokens`, `tenant_memberships`, `tenant_role_assignments`, `audit_logs`, dan `roles` masuk daftar **"global/control-plane"** di Infra, tetapi Demo mewajibkannya `tenant_id` + RLS | Infra §8.3 vs Demo §7.2 |
| 3.2 | TINGGI | Model role: General menyebut `user_role_assignments` **dan** `tenant_role_assignments`; Infra menyebut `tenant_role_assignments`; Demo hanya `user_role_assignments` berbasis `membership_id`. Belum jelas satu atau dua tabel | General §5.3 & §6.0, Infra §8.3, Demo §7.1 |
| 3.3 | TINGGI | Precedence settings `system → organization → unit → user` **tidak memuat level tenant** | General §9 |
| 3.4 | SEDANG | Ada dua skema klasifikasi data: `public/internal/confidential/restricted` dan `DP-0…DP-4`, tanpa mapping | General §25 vs DP SSOT §4 |
| 3.5 | SEDANG | Audit event minimum berisi `organization_id` tanpa `tenant_id`, dan masih mengizinkan `changes_json` diff, padahal DP SSOT melarang raw DP-1/DP-2 di diff | General §10.1 vs DP §6.6, Demo §7.3 |
| 3.6 | SEDANG | Feature flag targeting hanya "organization/user", tanpa tenant | General §21 |
| 3.7 | SEDANG | External ID unique `(system, entity_type, external_id, scope)` tanpa `tenant_id` eksplisit | General §19.3 |
| 3.8 | SEDANG | `reference_sets/values` tidak memodelkan pemisahan global vs tenant override, padahal Infra §8.8 mewajibkannya | General §8 vs Infra §8.8 |
| 3.9 | SEDANG | Provisioning membuat "default organization", tetapi tabel `organizations` tidak ada di inventory Demo | Demo §7.1 vs DEMO-0106 |
| 3.10 | RENDAH | ADR-001 `related_ssot` masih menunjuk **v1.1** | ADR-001 frontmatter |
| 3.11 | RENDAH | Diagram lifecycle ADR tidak memuat jalur reactivation, sedangkan Infra/General memuatnya | ADR §3.6 |
| 3.12 | RENDAH | Struktur repo Infra §6 hanya menaruh Infra + DP SSOT di root; General SSOT dan Demo docs tidak punya lokasi | Infra §6 |
| 3.13 | RENDAH | Satu versi dokumen (v1.0 → v1.2) naik tiga kali di hari yang sama tanpa satu pun approval teknis. Change log mencatat "adopted", padahal approval masih pending semua | Semua |

---

## 4. Review sprint plan

### 4.1 [TINGGI] Kapasitas tidak realistis

| Sprint | Point |
|---|---:|
| 0 | 38 |
| 1 | 53 |
| 2 | 63 |
| 3 | 61 |
| 4 | 58 |
| 5 | 65 |
| **Total** | **338** |

Dengan timebox 1 minggu per sprint, beban ini membutuhkan velocity ±55 point/minggu sejak minggu pertama. Untuk tim 2–3 orang, jumlah itu jauh di atas kebiasaan. Dokumen sendiri menyebut velocity belum diketahui. Kalau dikerjakan satu orang yang merangkap 7 role, **pemisahan approval (Security, Ops, Technical) bersifat seremonial**: orang yang sama menyetujui pekerjaannya sendiri. Kondisi ini perlu dicatat jujur sebagai risk acceptance, bukan disembunyikan di balik tabel approval.

Perkiraan saya, dengan asumsi 1–2 engineer: **12–18 minggu** untuk scope yang sama. [Low confidence, karena komposisi tim tidak diketahui.]

### 4.2 [TINGGI] Dependensi dan story yang hilang

- **Tidak ada story untuk jalur pre-context/auth DB access** (lihat §1.1).
- **Tidak ada story skema `audit_logs`** sebelum Sprint 5, padahal audit event wajib sejak Sprint 1 (provisioning) dan Sprint 2 (login).
- DEMO-0104 (skema `users` dengan kolom ciphertext) hanya bergantung ke 0101. Seharusnya juga ke **0105 (crypto adapter)**.
- Sprint 0 membuat Next.js (DEMO-0004), padahal Infra §2 dan §15 menetapkan frontend dibuat **setelah** tenant isolation dan API (Phase 6 setelah Phase 4). Pilih salah satu: revisi urutan fase di Infra, atau pindahkan story ini.
- Story DEMO-0105 (8 point) mencakup crypto adapter, blind index, AAD test, field register, dan key source. Menurut skala di dokumen itu sendiri, ini realistisnya 13 dan wajib dipecah.

### 4.3 [SEDANG] Scope demo yang layak dipangkas

- **Menu administration per tenant** (DEMO-0404/0406, 16 point). Route menu dibatasi allowlist route yang ada di kode, jadi tenant hanya bisa mengubah label, urutan, dan permission. Nilai demonya rendah dibanding biayanya. Cukup menu registry dari seed + resolver. CRUD bisa dijadikan P2.
- **Profile update** (`PATCH /me/profile`) terkait masalah identitas global §1.2. Tunda sampai ADR-002.

---

## 5. Verifikasi versi teknologi (per 2026-09-16)

| Klaim dokumen | Hasil cek | Catatan |
|---|---|---|
| Next.js 16.x, minimum `16.3.3` | **Terverifikasi.** 16.3.3 dirilis 25 Agustus 2026 (Active LTS) dan memperbaiki dua RCE kritis | Salah satu CVE (CVE-2026-75604) **khusus server Next.js di filesystem Windows**. Dev lokal Anda di Windows, jadi pastikan patch ini terpasang dan dev server tidak diekspos ke jaringan |
| NestJS 12.x | **Terverifikasi.** Dirilis 28 Agustus 2026, ESM-first, Node ≥20.19/22.12 | Baru ±3 minggu. **Risiko ekosistem:** `@nestjs/swagger`, throttler, passport/JWT, dan library pihak ketiga belum tentu kompatibel. Masukkan compatibility check ke DEMO-0003 |
| PostgreSQL 18.6 | **Terverifikasi** (release Agustus 2026) | — |
| Prisma 7 GA + `@prisma/adapter-pg` | Tidak diverifikasi rinci pada review ini | This needs verification, terutama perilaku transaction dengan driver adapter |
| Node.js 24 LTS, pin `24.21.x` | Tidak diverifikasi pada review ini | This needs verification |

---

## 6. Hal yang sudah kuat (tetap dipertahankan)

- Tenant ≠ organization. Keputusan ini tepat dan sering salah di SaaS lain.
- RLS diposisikan sebagai defense-in-depth, bukan pengganti filter aplikasi. Runtime role non-owner tanpa `BYPASSRLS` + `FORCE`.
- Composite FK `(tenant_id, id)` untuk menolak relasi lintas tenant di level DB.
- Isolasi di luar DB (cache, file, job, webhook, search) sudah diperlakukan sebagai kewajiban, bukan catatan kaki.
- Token disimpan sebagai keyed hash, dengan refresh rotation + reuse detection + revocation family.
- Pemisahan tegas antara "adopted direction" dan "approval", dan antara demo dan production readiness.

Risiko dari kekuatan terakhir: dokumen menjadi **sangat berat** (±180 KB aturan untuk demo tanpa fitur bisnis). Bahayanya bukan kurang kontrol, tetapi aturan yang tidak dibaca atau dijalankan. Pertimbangkan satu halaman "Top 20 invariants" yang benar-benar di-enforce lewat test/CI, dan jadikan sisanya referensi.

---

## 7. Urutan tindakan yang disarankan

1. **ADR-001 addendum.** Tambahkan pre-context/platform access path (`SECURITY DEFINER` atau role auth), policy untuk baris `tenant_id NULL`, dan audit pre-auth.
2. **ADR-002 Identity model.** Tetapkan global identity + invite flow + profil per tenant, lalu tutup open decision soal email.
3. **DP SSOT v1.1.** Rujuk PP 33/2026 (setelah dicek teks resminya), definisikan peran Pengendali/Prosesor, alur notifikasi 3×24 jam, key purpose `platform_identity`, dan keputusan pencarian nama.
4. **Rekonsiliasi Infra §8.3 dan General §5/§9/§10/§21** dengan klasifikasi tabel Demo §7.2.
5. **Sprint plan v1.1.** Tambahkan spike Prisma+RLS dan story auth-path + audit schema di Sprint 1, perbaiki dependensi, pecah DEMO-0105, turunkan menu CRUD ke P2, dan hitung ulang timebox berdasarkan kapasitas nyata.
6. Putuskan KMS (OpenBao/Vault Transit vs cloud KMS) sebelum Sprint 1.

---

## Sumber riset eksternal

- [Veritask — PP 33/2026](https://veritask.ai/id/artikel/pengaturan-teknis-pelindungan-data-pribadi-dan-kewajiban-pengendali-serta-prosesor-akhirnya-terbit-lewat-pp-33-2026)
- [Robere — PP 33 2026: Panduan PDP](https://robere.co.id/id/pp-33-2026-pelindungan-data-pribadi/)
- [Hukumonline — PP PDP telah terbit](https://www.hukumonline.com/berita/a/pp-pdp-telah-terbit-saatnya-perkuat-kompetensi-pelindungan-data-pribadi-melalui-pelatihan-dan-sertifikasi-bersama-hukumonline-dan-appdi-lt6a98d9eb5889f/)
- [Next.js — August 2026 Security Release](https://nextjs.org/blog/august-2026-security-release)
- [Trilon — NestJS v12 is now available](https://trilon.io/blog/nestjs-12-is-now-available)
- [PostgreSQL 18.6 release notes](https://www.postgresql.org/docs/release/18.6/)
- [Atlas — Using Row-Level Security in Prisma](https://atlasgo.io/guides/orms/prisma/row-level-security)
- [Prisma client extensions — row-level-security example](https://github.com/prisma/prisma-client-extensions/tree/main/row-level-security)
