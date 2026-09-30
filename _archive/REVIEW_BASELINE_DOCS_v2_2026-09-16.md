---
title: "Review v2 — Dokumen Baseline SaaS Multi-Tenant (setelah revisi)"
document_id: "REVIEW-BASELINE-DOCS-V2"
reviewed_at: "2026-09-16"
scope_active:
  - ADR-001-SAAS-MULTI-TENANCY_v1.2.md
  - ADR-002-IDENTITY-MODEL_v1.0.md
  - ADR-003-PLATFORM-SUPERADMIN-SUPPORT-ACCESS_v1.0.md
  - INFRASTRUCTURE_SSOT_v1.4.md
  - GENERAL_FEATURE_BASE_SSOT_v1.3.md
  - DATA_PROTECTION_ENCRYPTION_SSOT_v1.1.md
  - SAAS_DEMO_FOUNDATION_SSOT_v1.2.md
  - SAAS_DEMO_SPRINT_PLAN_v1.2.md
  - DOCUMENT_VERSION_INDEX.md
scope_archive: "10 file SUPERSEDED — dicek penandaannya saja"
method: "Baca dokumen aktif, cek silang antar dokumen, cek otomatis (versi, story point, ID story, katalog permission)"
note: "Sebagian besar isi yang direview ditulis pada sesi yang sama; temuan di bawah termasuk kesalahan dari revisi sebelumnya."
---

# Review v2 — Dokumen Baseline (setelah revisi)

## 0. Ringkasan

**Hal yang lolos pemeriksaan otomatis:**

- 8 dokumen aktif dan 10 arsip bertanda `SUPERSEDED`, dan tidak ada dokumen aktif yang merujuk file arsip.
- File di folder sama persis dengan salinan kerja, jadi tidak ada suntingan manual yang tertimpa.
- Story point per sprint sama dengan angka yang tertulis: 40/76/71/74/47/70, total 378 point P0/P1 ditambah 16 point P2.
- 65 ID story unik, dan setiap story punya rincian acceptance criteria.

**Masalah utama.** Revisi sebelumnya punya **dua kesalahan desain yang membuat implementasi macet kalau diikuti persis seperti tertulis**. Keduanya ada di fitur yang baru ditambahkan, yaitu jalur akses sebelum tenant context terbentuk dan superadmin:

1. Fungsi `SECURITY DEFINER` milik `app_auth_definer` **tetap kena RLS**, sehingga login dan refresh akan selalu mendapat 0 baris (§1.1).
2. Superadmin **tidak punya tempat menyimpan session**, karena `sessions.tenant_id` NOT NULL sementara superadmin tidak punya membership tenant (§1.2).

Selain itu ada satu kontradiksi fungsional yang besar: daftar member wajib menampilkan dan mencari email, padahal admin tenant sengaja tidak diberi akses ke `users` (§1.3).

Label: **[KRITIS]** implementasi macet atau muncul celah keamanan · **[TINGGI]** harus diputuskan sebelum sprint terkait · **[SEDANG]** perbaiki saat revisi · **[RENDAH]** kerapian.

---

## 1. Temuan desain

### 1.1 [KRITIS] Fungsi pre-context tidak bisa membaca data karena tetap kena RLS

ADR-001 v1.2 §3.7 menetapkan fungsi `SECURITY DEFINER` dimiliki `app_auth_definer`. Role ini bukan pemilik tabel dan tidak punya `BYPASSRLS`. Aturan yang sama juga melarang `BYPASSRLS` untuk role auth, dan Infra v1.4 §8.7.1 melarang `BYPASSRLS` untuk "role apa pun yang dipakai aplikasi".

Di PostgreSQL, fungsi `SECURITY DEFINER` berjalan dengan hak **pemilik fungsi**. RLS tetap berlaku untuk role itu, kecuali role tersebut pemilik tabel (dan tabelnya tidak `FORCE`) atau punya `BYPASSRLS`. Semua policy yang ada hanya mengizinkan baris `tenant_id = current_setting('app.current_tenant_id')`, dan konteks itu **kosong** saat login. Akibatnya:

| Fungsi | Hasil kalau diikuti persis seperti tertulis |
|---|---|
| `auth.list_active_memberships` | 0 baris, jadi login selalu gagal |
| `auth.find_refresh_token` | 0 baris, jadi refresh selalu gagal |
| `auth.resolve_tenant_by_host` | 0 baris |
| `audit.write_pre_context_event` | insert `tenant_id NULL` ditolak oleh `WITH CHECK` |

[High confidence. Dasarnya perilaku RLS PostgreSQL yang terdokumentasi. Tetap perlu dibuktikan di spike DEMO-0100, dan saat ini spike itu belum menguji skenario ini.]

Kesalahan ini persis jenis masalah yang sebelumnya mau dicegah, dan sekarang justru terbawa ke dokumen. Developer yang menemukannya di tengah sprint cenderung menambahkan `BYPASSRLS`, yang oleh dokumen dilarang tanpa ada alternatif yang diberikan.

**Rekomendasi** (pilih satu, lalu tulis di ADR-001 §3.7):

- **A (disarankan).** Policy khusus `TO app_auth_definer` per tabel dan per operasi. Contoh: `CREATE POLICY auth_read ON tenant_memberships FOR SELECT TO app_auth_definer USING (true)`, ditambah grant kolom minimum. Karena role ini `NOLOGIN` dan hanya bisa dipakai lewat fungsi yang terdaftar, cakupan aksesnya tetap sempit.
- **B.** `app_auth_definer` diberi `BYPASSRLS` dengan syarat `NOLOGIN`, tidak bisa di-`SET ROLE` oleh `app_user`, dan diawasi schema inspection test. Cara ini lebih sederhana, tetapi larangan di ADR-001 dan Infra harus diubah secara eksplisit.

Tambahkan juga ke DEMO-0100 dan DEMO-0109: "fungsi pre-context membaca baris lintas tenant tanpa `app.current_tenant_id`, dan `app_user` tetap mendapat 0 baris pada tabel yang sama".

### 1.2 [KRITIS] Superadmin tidak punya session dan jalur login

- `sessions.tenant_id` dan `refresh_tokens.tenant_id` **NOT NULL** (Infra v1.4 §8.3, Demo v1.2 §7.3).
- Seed Demo v1.2 §16.2 menulis Demo Superadmin sebagai "Platform only", tanpa membership tenant.
- Alur login Demo §8.1 selalu memanggil `auth.list_active_memberships` lalu memilih tenant. Untuk superadmin, daftarnya kosong.
- ADR-003 hanya mengatur token support session. Token dan session **platform** tidak didefinisikan sama sekali.

Ada celah yang berhubungan: user yang punya **beberapa** membership belum punya status di antara "password benar" dan "tenant dipilih". Session belum bisa dibuat (karena butuh `tenant_id`), tetapi client perlu memegang sesuatu untuk memanggil `GET /me/tenants`.

**Rekomendasi:**

- Ubah `sessions` menjadi *mixed-ownership* dengan kolom `context_kind` (`TENANT`/`PLATFORM`/`PENDING_TENANT_SELECTION`), dengan `tenant_id` NULL hanya untuk `PLATFORM` dan `PENDING`. Alternatifnya, buat tabel `platform_sessions` terpisah.
- Untuk status pemilihan tenant, pakai tiket berumur pendek (misalnya 5 menit, disimpan sebagai hash, sekali pakai) yang hanya bisa dipakai untuk `GET /me/tenants` dan `POST /auth/select-tenant`.
- Alur login bercabang: punya role platform, punya membership, atau keduanya. Tentukan juga apakah superadmin boleh sekaligus menjadi member tenant.
- **Urutan sprint:** login superadmin butuh `platform_role_assignments` (DEMO-0311, Sprint 3), padahal login dibangun di Sprint 2. Pindahkan skema dan bootstrap superadmin ke Sprint 1 atau 2, atau tambahkan dependensi eksplisit.

### 1.3 [TINGGI] Daftar member butuh email, tetapi admin tenant tidak punya akses ke email

Beberapa aturan saling bertabrakan:

- Demo v1.2 §11.3 mewajibkan filter "email exact", §13 menampilkan "email (masked)", dan DEMO-0305 menyebut "email exact via tenant-scoped lookup".
- ADR-002 §2.3, DP v1.1 §9.1, dan Infra v1.4 §8.3 menyatakan admin tenant **tidak punya jalur** ke `users`, dan `tenant_member_profiles` tidak menyimpan email.
- `user_invitations.email_*` memang ada, tetapi hanya berlaku sampai undangan diterima atau kedaluwarsa, dan tidak ada aturan retensinya.

Tidak ada kolom maupun fungsi yang memungkinkan email tampil atau dicari di daftar member.

**Rekomendasi:** simpan salinan per tenant di `tenant_member_profiles`, yaitu `contact_email_ciphertext` (DEK tenant) dan `contact_email_blind_index_tenant`, yang diisi saat undangan diterima. Catat bahwa salinan ini **tidak otomatis ikut berubah** kalau email global berubah (perubahan email global memang di luar scope demo). Alternatifnya, identity service menyediakan email masked hanya untuk member tenant aktif. Cara ini lebih sinkron, tetapi membuka jalur baca yang harus diaudit.

### 1.4 [TINGGI] Kepercayaan pada `app.context_kind` dan `READ ONLY` dinyatakan terlalu kuat

ADR-001 §3.8 dan ADR-003 §2.3 menyebut `context_kind = platform` dan `SET TRANSACTION READ ONLY` sebagai penegakan di tingkat database. Keduanya diset oleh `app_user` sendiri:

- kode aplikasi mana pun (atau SQL injection) bisa memanggil `set_config('app.context_kind','platform',true)` atau `set_config('app.current_tenant_id', <tenant lain>, true)`;
- `READ ONLY` berlaku per transaksi, sehingga kode yang tidak lewat wrapper bisa membuka transaksi baru yang read-write.

Artinya, RLS berbasis GUC hanya melindungi dari **bug aplikasi**, bukan dari **aplikasi yang sudah dibobol**. Arsitekturnya masih bisa diterima, tetapi batasan ini harus ditulis jujur di bagian konsekuensi ADR-001 dan ADR-003 serta di threat model. Tanpa itu, reviewer bisa salah menilai kekuatan kontrolnya.

**Mitigasi yang bisa ditambahkan:** lint atau test yang melarang `set_config('app.` di luar modul unit-of-work, pemanggilan parameterized (tanpa string SQL), dan alert jika ada query ke tabel tenant-owned di luar wrapper. Sebagai opsi production, tenant context bisa diambil dari claim yang ditandatangani dan diverifikasi di database, tetapi ini mahal dan hanya perlu dicatat sebagai opsi.

### 1.5 [SEDANG] Support session ke tenant SUSPENDED bertentangan dengan verifikasi status

ADR-003 §2.2 mengizinkan support session ke tenant dengan "status apa pun kecuali PURGED". Infra v1.4 §8.6 mewajibkan setiap request protected memverifikasi tenant `ACTIVE`. Kebutuhannya masuk akal, karena support justru sering dibutuhkan untuk tenant yang sedang di-suspend. Tetapi pengecualiannya harus ditulis di Infra §8.6 (context `support` boleh menembus status SUSPENDED, CLOSING, dan ARCHIVED dengan scope READ_ONLY), dan harus ada test-nya.

### 1.6 [SEDANG] Notifikasi in-app diwajibkan tanpa modul atau tabel

ADR-003, Demo v1.2 §18.2b dan Scenario 6, serta DEMO-0312/0409 mewajibkan "notifikasi in-app ke tenant owner". Masalahnya:

- tabel `notifications` tidak ada di inventory Demo v1.2 §7.1;
- tidak ada story untuk membangun modul Notifications;
- General v1.3 §12 mendefinisikan modulnya, tetapi di luar scope demo.

**Pilihan:** tambahkan story notifikasi in-app minimal (tabel, endpoint list/mark-read, badge UI) sekitar 5–8 point, atau untuk demo cukup tampilkan banner "Ada akses support baru" yang membaca `support_sessions` di dashboard tenant owner.

### 1.7 [SEDANG] Audit tenant untuk event support dan platform belum punya jalur tulis

ADR-003 menulis event `support.session.started` ke audit platform **dan** audit tenant, dari context platform. Policy `audit_logs` (ADR-001 §3.8) hanya mengizinkan tenant menulis barisnya sendiri dan platform menulis baris `tenant_id NULL`. Belum ada aturan yang membolehkan context platform menulis baris audit milik tenant. Solusinya fungsi `audit.write_cross_context_event` yang terdaftar, atau policy khusus untuk `app_auth_definer`, sejalan dengan §1.1.

### 1.8 [SEDANG] Daftar fungsi pre-context tidak konsisten antar dokumen

| Fungsi | ADR-001 §3.7 | Infra §8.3 | DEMO-0109 |
|---|---|---|---|
| identity lookup (email → user) | tidak ada | ada | ada |
| accept invitation | tidak ada | ada | ada |
| platform role lookup | tidak ada | ada (v1.4) | tidak ada |
| resolve host, memberships, refresh, audit | ada | ada | ada |

ADR-001 §3.7 menyatakan dirinya daftar resmi, tetapi daftarnya paling tidak lengkap. Sebaiknya daftar fungsi hanya ada di satu tempat (Pre-context Function Register), dan dokumen lain cukup merujuk ke sana.

### 1.9 [RENDAH] Detail skema ADR-002 berbeda dengan Demo

- ADR-002 §2.2 masih menulis permission `users.invite`, padahal seharusnya `members.invite`.
- ADR-002 memakai `accepted_user_id`, sedangkan Demo v1.2 memakai `accepted_membership_id`.
- `tenant_memberships` di ADR-002 tidak punya `UNIQUE (tenant_id, id)`, padahal composite FK di Demo membutuhkannya.
- `intended_role_ids UUID[]` tidak bisa diberi FK, sehingga validasi lintas tenant hanya dilakukan aplikasi. Tabel `invitation_roles (tenant_id, invitation_id, role_id)` dengan composite FK lebih konsisten dengan prinsip penolakan di tingkat database.

---

## 2. Sisa dari versi lama dan konsistensi

| # | Level | Temuan | Lokasi |
|---|---|---|---|
| 2.1 | TINGGI | Kontrak API baseline masih `GET/POST/PATCH /api/v1/users`, bertentangan dengan ADR-002 (tidak ada create/update identitas oleh tenant) | Infra v1.4 §9 (baris ~585–588) |
| 2.2 | SEDANG | Contoh struktur modul backend masih `modules/users/` dengan `users.controller.ts` | Infra v1.4 §6.1 |
| 2.3 | SEDANG | ADR-001 §3.9 masih merujuk "Sprint Plan **v1.1** DEMO-0100". Pemeriksaan otomatis hanya mencocokkan nama file, sehingga rujukan dalam bentuk teks lolos | ADR-001 v1.2 §3.9 |
| 2.4 | RENDAH | Tabel pelacakan di index (§4) menunjuk lokasi perbaikan di versi yang kini sudah SUPERSEDED (ADR-001 v1.1, Infra v1.3, Demo v1.1, Sprint v1.1) | DOCUMENT_VERSION_INDEX §4 |
| 2.5 | RENDAH | Pemeriksaan konsistensi (index §6) belum menangkap rujukan versi berbentuk teks ("Infra v1.3 §8.3"), dan belum mencakup file review | DOCUMENT_VERSION_INDEX §6 |
| 2.6 | RENDAH | Heading §4.1 (mapping klasifikasi) terselip di antara DP-3 dan DP-4 | DP v1.1 §4 |

---

## 3. Regulasi (tidak ada perubahan sejak review v1)

- PP 33/2026 masih berstatus "belum diverifikasi dari teks resmi", dan DP v1.1 sudah jujur mencatatnya. Ini tetap **blocker production**.
- Rujukan ke "Lembaga" dalam alur notifikasi 3×24 jam bergantung pada lembaga pengawas PDP yang benar-benar sudah beroperasi. Status kelembagaannya **perlu verifikasi** dan tidak saya cek pada review ini.
- Regulasi sektoral (review v1 §2.3) masih terbuka.

---

## 4. Sprint plan

- **Angka konsisten.** Kapasitas 378 point P0/P1 sudah dihitung ulang dan cocok.
- **Dependensi yang salah urut:** login superadmin (butuh DEMO-0311, Sprint 3) sudah diperlukan sejak Sprint 2 (§1.2).
- **Story yang belum ada:**
  - policy/role auth-definer (§1.1), cukup ditambahkan ke DEMO-0100 dan DEMO-0109;
  - platform session dan tiket pemilihan tenant (§1.2), sekitar 5 point;
  - salinan email member per tenant (§1.3), sekitar 3 point;
  - notifikasi in-app minimal (§1.6), sekitar 5–8 point.

  Perkiraan tambahan 13–16 point, sehingga total menjadi sekitar 391–394 point. [Low confidence, estimasi relatif.]
- **DEMO-0100 perlu tiga kriteria tambahan:** fungsi definer membaca lintas tenant, `app_user` tetap 0 baris, dan `set_config` di luar wrapper terdeteksi.

---

## 5. Yang sudah baik

- Pemisahan tenant, organization, dan identitas global sudah konsisten di semua dokumen aktif.
- Superadmin tidak punya bypass RLS dan tidak bisa impersonation. Setiap aksesnya punya batas waktu, alasan, dan terlihat oleh tenant.
- Disiplin versi sudah berjalan: `supersedes`, banner arsip, dan catatan errata.
- Sprint plan sudah memperhitungkan velocity dan jujur soal self-review.

---

## 6. Urutan perbaikan yang disarankan

1. **ADR-001 v1.3.** Pilih opsi A atau B di §1.1, kelola daftar fungsi pre-context di satu tempat (§1.8), jalur tulis audit lintas context (§1.7), dan tulis batasan kepercayaan GUC (§1.4).
2. **ADR-003 v1.1 + Infra v1.5.** Platform session dan tiket pemilihan tenant (§1.2), pengecualian status untuk context support (§1.5), serta perbaikan §9 API dan §6.1 (§2.1–2.2).
3. **ADR-002 v1.1 + Demo v1.3.** Salinan email member per tenant (§1.3), `members.invite`, `invitation_roles`, keselarasan skema (§1.9), dan keputusan soal notifikasi (§1.6).
4. **Sprint Plan v1.3.** Pindahkan dependensi superadmin, tambahkan story dan kriteria spike (§4).
5. **Index.** Perbarui lokasi di tabel pelacakan dan perluas pemeriksaan ke rujukan versi berbentuk teks (§2.4–2.5).
