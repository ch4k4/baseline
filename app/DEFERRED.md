# Utang yang sengaja diambil

Daftar acceptance criteria yang dilewati untuk mencapai demo e2e lebih cepat.
Ini utang, bukan hilang. Setiap baris menyebut story asalnya supaya bisa ditagih.

Aturan: baris hanya boleh dihapus kalau AC-nya benar-benar sudah dipenuhi dan
ada tes yang membuktikannya — bukan karena sudah tidak terasa penting.

| # | Yang ditunda | Asal AC | Kenapa ditunda | Ditagih di |
|---|---|---|---|---|
| ~~D-01~~ | ~~Enkripsi field + blind index~~ | DEMO-0105A, 0105B | **LUNAS slice 8** - AES-256-GCM + AAD, DEK per scope dibungkus KEK, blind index HMAC global (login) dan per tenant (kontak), pseudonim audit berkunci, Data Field Register ditegakkan tes | selesai |
| D-02 | argon2id diganti scrypt (node:crypto) | DEMO-0104 | Menghindari langkah kompilasi native yang bisa gagal dan menyamarkan bug lain. scrypt tetap adaptive hash (RFC 7914) | Review Security sebelum data nyata |
| ~~D-03~~ | ~~Access token bertanda tangan (JWT + klaim tenant/session)~~ | DEMO-0203 | **LUNAS slice 7** - HS256 di atas `node:crypto`, algoritma dipatok kode, klaim dicocokkan dengan baris session | selesai |
| ~~D-04~~ | ~~Refresh token, rotasi, reuse detection~~ | DEMO-0204 | **LUNAS slice 7** - rotasi atomik (`FOR UPDATE`), pemakaian ulang mencabut seluruh family beserta session-nya | selesai |
| ~~D-05~~ | ~~Logout dan pencabutan server-side~~ | DEMO-0205 | **LUNAS slice 5** - `auth.revoke_session`, keluar mencabut di server; diuji dengan memasang ulang cookie lama | selesai |
| ~~D-06~~ | ~~Tiket pemilihan context (login >1 tenant)~~ | DEMO-0211 | **LUNAS slice 5** - tiket sekali pakai, TTL <= 5 menit ditegakkan CHECK, disimpan sebagai hash | selesai |
| ~~D-07~~ | ~~Rate limiting dan backoff login~~ | DEMO-0202 | **LUNAS slice 6** - berbasis audit (bertahan restart), per identitas, dinihilkan oleh login berhasil | selesai |
| ~~D-08~~ | ~~Audit event~~ | DEMO-0110, 0202 | **LUNAS slice 6** - append-only, tanpa data pribadi (ditolak database), terisolasi per tenant | selesai |
| ~~D-09~~ | ~~Undangan dan non-enumeration~~ | DEMO-0210, 0212 | **LUNAS slice 9 (2026-09-22; mesin target: SQL 64, API 83, browser 35)** - undangan hanya oleh owner, respons 202 seragam, token sekali pakai lewat outbox, penerimaan atomik lewat F-11/F-16/F-12. Lihat catatan D-09 di bawah | selesai |
| D-10 | RBAC, menu dinamis, superadmin, break-glass | Sprint 3-4 | **Sebagian lunas slice 10-12 (2026-09-23):** katalog, role, resolver, guard deny-by-default (0301-0304); administrasi anggota dan role, role saat undangan, tes eskalasi API (0305, 0306, 0309, 0308); layar administrasi dan skenario demo 1-2 (0307). guard platform, admin platform, dan notifikasi keamanan tenant (0311, 0313, slice 13). Sisa: menu dinamis (0403/0405), tes eskalasi browser penuh, break-glass support session (0312), konsol platform penuh (0409) | Slice 13 dan seterusnya |
| ~~D-11~~ | ~~Verifikasi di PostgreSQL 18~~ | DEMO-0100 | **LUNAS 2026-09-20** — 14 kasus SQL + 11 tes API lulus di PostgreSQL 18.6, Windows PowerShell 5.1 | selesai |
| D-12 | ~~Keputusan Prisma vs SQL langsung~~ **LUNAS 2026-09-22** | DEMO-0100 | Spike GO (`spike-prisma/SPIKE_RESULT.md`); `api/` kini di atas Prisma 7.10.0. Lihat catatan D-12 di bawah | - |

## Yang TIDAK ikut lunas bersama D-03/D-04

Supaya tidak dikira selesai padahal belum:

- **`DEMO_JWT_SECRET` masih satu kunci statis.** Tidak ada rotasi kunci, dan
  tidak ada `kid` di header token. Merotasi kunci hari ini berarti mencabut
  semua sesi sekaligus. Ditagih bersama keputusan KMS.
  *Sebagian lunas 2026-09-30:* kunci bawaan yang tertulis di kode sudah dihapus.
  Tanpa `DEMO_JWT_SECRET` (minimal 32 byte), API memakai 32 byte acak dari berkas
  buatan seed di sebelah KEK, dan menolak start bila keduanya tidak ada - tanpa
  bergantung pada `NODE_ENV` (`src/auth/jwt-secret-source.ts`,
  `test/jwt-secret.test.ts`). Rotasi dan `kid` tetap belum ada.
- **Tidak ada daftar cabut per-`jti`.** Pencabutan bekerja lewat baris session,
  bukan lewat token. Itu memadai selama guard tetap memeriksa session setiap
  permintaan - dan berhenti memadai pada hari seseorang "mengoptimalkan"
  pemeriksaan itu. Lihat komentar di `session.guard.ts`.
- **Umur access token 15 menit belum diuji beban.** Angkanya pilihan, bukan
  hasil pengukuran.

## Yang TIDAK ikut lunas bersama D-01

Dicatat supaya "enkripsi field sudah ada" tidak dibaca sebagai "perlindungan
data sudah selesai":

| # | Celah | Kenapa penting | Rujukan |
|---|---|---|---|
| D-13 | **LUNAS 2026-09-21 lewat amandemen SSOT, bukan perubahan kode.** KEK demo berupa berkas acak tanpa passphrase kini sah sebagai opsi C2 (Data Protection SSOT edisi 2.1 §9.2), keputusan pemilik proyek. Syarat C2 izin baca terbatas terverifikasi 2026-09-22 (lihat D-14). | Berkas KEK di `%USERPROFILE%\.saas-demo\` tetap cukup untuk membuka seluruh data demo; karena itu C2 hanya untuk data synthetic. | SSOT DP sec.9.2 |
| ~~D-14~~ | **TERVERIFIKASI 2026-09-22 (`icacls`, mesin target).** Berkas KEK dan foldernya hanya memberi akses ke `NT AUTHORITY\SYSTEM`, `BUILTIN\Administrators`, dan akun pengembang (`INDONESIARE\rusli`); tidak ada `Users`, `Authenticated Users`, maupun `Everyone`. Syarat C2 terpenuhi. | Risiko yang diterima: anggota grup Administrators - pada mesin domain termasuk admin TI domain - tetap dapat membaca KEK. Layak untuk data synthetic, tidak untuk data nyata. | SSOT DP sec.9.2 |
| D-15 | **Rotasi kunci belum ada.** Kolom `*_key_version` dan `crypto_keys.key_version` sudah siap, tapi tidak ada perintah rotasi maupun re-enkripsi, dan cache kunci tanpa TTL (rotasi menuntut restart). | Tanpa rotasi, kunci yang bocor tidak dapat diganti tanpa membangun ulang data. | SSOT DP sec.9, sec.20 |
| D-16 | **Hash token (refresh, tiket) tanpa kunci.** SSOT sec.8.3 meminta keyed hash; implementasi memakai SHA-256 atas 32 byte acak. | Risikonya kecil karena inputnya berentropi tinggi (tidak dapat ditebak), tapi tetap selisih terhadap SSOT. | SSOT DP sec.8.3 |
| ~~D-17~~ | ~~Tenant baru tidak mendapat kunci~~ | **LUNAS 2026-09-29 (fondasi langkah 3)** — `POST /platform/tenants` membuat kunci tenant baru lewat F-26 dalam transaksi provisioning; lihat catatan fondasi langkah 3 di bawah | selesai |
| D-18 | **Pencarian nama (token kata) belum ada.** Daftar anggota diurutkan setelah dekripsi di memori; tidak ada pencarian. | Memadai untuk tenant kecil; halaman besar butuh paginasi dan search token (SSOT sec.8.4). | SSOT DP sec.8.4 |
| D-19 | **Register hanya mencakup kolom database skema public.** Log, cache, payload antrean, dan ekspor belum tercatat. | SSOT sec.13 mencakup semua penyimpanan, bukan hanya tabel. | SSOT DP sec.13 |

## D-20 - LUNAS (2026-09-21): batas waktu panggilan web ke API

Sebelumnya tujuh panggilan `fetch()` di web tidak punya batas waktu. API yang
mati terdeteksi cepat, tapi API yang hidup dan macet membuat halaman ikut
menggantung tanpa pesan.

Kini semua panggilan lewat `web/src/lib/api-fetch.ts`
(`AbortSignal.timeout`, default 5000 ms, dapat diubah dengan `API_TIMEOUT_MS`;
nilai tidak sah membuat halaman gagal keras, bukan diam-diam kembali ke default).
Login, pilih tenant, dan refresh membedakan "API macet" (`?error=lambat`) dari
"API mati" (`?error=api`).

Tes: `web/test/d20.spec.ts` (1 kasus, 3 bagian): tidak ada `fetch()` di `src/`
yang melewati `apiFetch`; login macet; daftar anggota macet. Tes memasang proxy
"macet" dan instance Next kedua sendiri, jadi server di port 3000 tidak disentuh.
7 mutasi, 7 tertangkap.

Yang TIDAK dicakup: batas waktu hanya berlaku untuk web -> API. Query database
yang macet di dalam API tetap tanpa `statement_timeout`; itu utang terpisah
bila nanti diperlukan.

## Catatan D-12 — Prisma di `api/` (2026-09-22)

Semula `api/` memakai `pg` langsung karena Prisma belum terbukti. Spike DEMO-0100
membuktikannya (GO dengan empat syarat), lalu `api/` dipindahkan.

Yang berubah:
- `unit-of-work.ts` kini berjalan di atas Prisma interactive transaction, di pool
  pg yang sama. Statement pertamanya tetap `set_config` tenant, ditambah
  `statement_timeout` (syarat GO 2).
- `Tx` tetap punya `query(sql, params)` untuk fungsi `auth.*` (Opsi A), ditambah
  `tx.db` untuk model bertipe. Daftar anggota sudah memakai `tx.db`.

Yang TIDAK berubah, dan sengaja begitu:
- Skema database tetap dari `db/migrations/*.sql`. `prisma migrate` tidak dipakai
  (syarat GO 1): migrasi Prisma tidak akan membuat RLS, policy, fungsi, grant,
  maupun CHECK.
- Fungsi `auth.*` tetap dipanggil lewat SQL. Prisma tidak punya padanan untuk
  fungsi `SECURITY DEFINER`.
- Seed (`scripts/seed-demo.ts`) tetap memakai `pg` sebagai superuser. Seed adalah
  jalur provisioning, bukan jalur aplikasi.

Belum dikerjakan: query mentah lain ke tabel (bukan fungsi) dipindah ke `tx.db`
saat tabelnya disentuh fitur berikutnya, bukan sekaligus.

## Catatan D-09 — Undangan anggota (2026-09-22)

Keputusan pemilik proyek (2026-09-22): hanya owner tenant yang mengundang
(penanda sementara), Lampiran A diamandemen dengan F-16, token dikirim lewat
folder outbox lokal.

Yang dijamin, dan di mana dijaganya:

| Jaminan | Lapisan | Tes |
|---|---|---|
| Pengundang tidak dapat membedakan email terdaftar dari email baru | Aplikasi: `invite()` tidak pernah menyentuh identitas; respons selalu `202 {status:'INVITED'}` | API slice9 #5 |
| Token hanya sampai ke pemilik email | Outbox; token tidak pernah di respons, log, atau audit; disimpan sebagai hash yang tidak terbaca `app_user` | API #1, #10; SQL #1 |
| Sekali pakai; mati saat diundang ulang atau dicabut | F-11/F-12 (`status = 'PENDING'`), policy `definer_update` | API #4, #7; SQL #10 |
| Identitas yang menerima = pemilik email undangan | Aplikasi + F-16 + F-12 (blind index global = `identity_hint`) | SQL #7, #8 |
| Menebak password lewat undangan dikunci | Keranjang rate limit yang sama dengan login | API #6b |
| Membership yang ditangguhkan tidak hidup lagi lewat undangan | F-12 | SQL #13 |
| Tenant yang ditangguhkan tidak menerima anggota | F-11/F-12/F-16 | API #8b |

34 mutasi: 31 tertangkap, 2 ekuivalen, 1 tidak sah (rincian di AUDIT.md).

### Yang TIDAK ikut lunas bersama D-09

| # | Celah | Kenapa penting | Ditagih di |
|---|---|---|---|
| ~~D-21~~ | **LUNAS slice 10 (2026-09-22).** Hak mengundang kini permission `members.invite` yang diperiksa guard; kolom `is_owner` dihapus (migrasi 0013). | - | selesai |
| D-22 | **Outbox menggantikan penyedia email.** Berkas outbox memuat email dan token plaintext di `%USERPROFILE%\.saas-demo\outbox`, di luar database dan di luar cakupan Data Field Register (lihat D-19). Token juga ada di URL (`/invite?token=`), jadi tercatat di riwayat browser; halaman undangan mematikan `Referer`, tetapi riwayat tidak dapat dicegah. | Hanya layak untuk data synthetic. Sebelum data nyata: penyedia email, kebijakan retensi outbox/log pengiriman, dan pertimbangan token di fragmen URL atau langkah tukar-token. | Sebelum data nyata |
| D-23 | **Tidak ada job kedaluwarsa undangan.** Undangan lewat masa berlaku tetap `PENDING` di database; API menampilkannya `EXPIRED` dan F-11/F-12 menolaknya berdasarkan `expires_at`. Undangan PENDING yang kedaluwarsa masih memblokir undangan baru untuk email yang sama sampai diundang ulang (undang ulang memperbarui baris itu, jadi tidak macet). | Konsistensi laporan dan retensi ciphertext email undangan. | Bersama kebijakan retensi |

Tes API kini berjalan berurutan (`--test-concurrency=1`): slice 9 menambah
anggota sementara, dan slice 2/5/8 memeriksa daftar anggota secara persis.
Anggota tambahan itu dibersihkan oleh `api/scripts/test-cleanup.ts`, yang juga
dipanggil tes browser slice 9. Baris `users` hasil tes tidak dihapus (audit
merujuknya); identitas itu tertinggal tanpa tenant sampai `reset` berikutnya.

## Catatan slice 10 — RBAC ditegakkan di endpoint (2026-09-22)

Cakupan (keputusan pemilik proyek, 2026-09-22): DEMO-0301 sampai 0304, ditambah
pelunasan D-21. Role akun seed: Alpha Owner = `tenant_owner`, Alpha User =
`tenant_user`, Beta Admin = `tenant_admin`, Multi = `tenant_auditor` di kedua tenant.

Yang kini berlaku:
- Setiap route wajib mendeklarasikan aksesnya (`@Public`, `@Authenticated`, atau
  `@RequirePermission`). Route tanpa deklarasi ditolak guard global, dan tes API
  slice 10 #9 memindai seluruh controller.
- Keputusan hanya atas kode permission, tidak pernah nama role. Permission efektif
  dihitung per permintaan (tanpa cache) dari view `effective_permissions`
  (`security_invoker`), jadi RLS tenant tetap berlaku.
- Anggota yang ditangguhkan kehilangan seluruh permission walau session-nya masih
  hidup. Sebelum slice 10, anggota yang ditangguhkan masih dapat membaca daftar
  anggota: `auth.find_session` tidak memeriksa status membership.
- Halaman web membedakan 401 (session habis) dari 403 (tanpa hak): pengguna tanpa
  hak diberi tahu, tidak dikeluarkan paksa.

### Yang TIDAK ikut lunas bersama slice 10

| # | Celah | Kenapa penting | Ditagih di |
|---|---|---|---|
| ~~D-24~~ | **LUNAS slice 11 (2026-09-22).** Endpoint penulis role kini ada, dan setiap jalannya menegakkan anti-eskalasi (hanya role/permission yang seluruhnya dipegang pelaku), larangan mengubah diri sendiri, dan perlindungan terkunci-dari-tenant; dibuktikan tes API slice 11 #6, #7, #7b, #8. Database tetap tidak mengenal pelaku - lapis ini sengaja di aplikasi. | - | selesai |
| ~~D-25~~ | ~~Role sistem hanya dibuat seed~~ | **LUNAS 2026-09-29 (fondasi langkah 3)** — role sistem tenant baru dibuat dari template lewat F-27 dalam transaksi provisioning; lihat catatan fondasi langkah 3 di bawah | selesai |
| ~~D-26~~ | ~~Nama role adalah teks bebas tenant, dicatat DP-0~~ | **LUNAS 2026-09-26** — tetap DP-0 dan dinyatakan label konfigurasi, dengan penegakan di database: CHECK `roles_name_label_ck` menolak alamat email dan deretan 8+ digit (migrasi 0017); API menolak lebih dulu dengan pesan; layar pembuatan role memperingatkan; entri Data Field Register `roles.name` dilengkapi | selesai |

Belum ada: halaman profil (DEMO-0206). Pengguna `tenant_user` (hanya `profile.*`)
saat ini hanya melihat halaman "tidak punya akses".

## Catatan slice 11 — administrasi anggota dan role (2026-09-22)

Cakupan (keputusan pemilik proyek, 2026-09-22): DEMO-0305, 0306, 0309, dan bagian
API dari 0308. Layar administrasi (0307) dipisah ke slice 12.

Aturan yang kini ditegakkan di setiap jalan penulis role:
- **Anti-eskalasi.** Memberi, mencabut, atau mengubah isi role hanya boleh bila
  pelaku memegang SELURUH permission role itu. Berlaku juga untuk role undangan
  dan penangguhan anggota (menangguhkan pemegang hak yang lebih tinggi ditolak).
- **Tidak mengubah diri sendiri.** Role dan status sendiri tidak dapat diubah.
- **Tidak terkunci dari tenant.** Minimal satu anggota aktif memegang
  `members.assign_role`; diperiksa di transaksi yang sama, di bawah kunci advisory
  per tenant.
- **Penangguhan mencabut session** anggota itu di tenant tersebut.
- **Optimistic locking**: `version` pada membership dan role; versi basi = 409.
- `GET /invitations` kini `members.read`, sesuai Demo Foundation §11.1a. Slice 9–10
  memakai `members.invite` - penyimpangan yang saya buat dan kini diperbaiki.

### Yang TIDAK ikut lunas bersama slice 11

| # | Celah | Kenapa penting | Ditagih di |
|---|---|---|---|
| ~~D-27~~ | ~~Tidak ada endpoint mengaktifkan kembali anggota yang ditangguhkan~~ | **LUNAS 2026-09-22** — `POST /members/:id/reactivate` (`members.suspend`), aturan sama dengan penangguhan; Demo Foundation 2.3 §11.3. Session lama tidak hidup kembali | selesai |
| ~~D-28~~ | ~~Admin dapat mencabut role owner dari owner lain~~ | **LUNAS 2026-09-22** — permission penanda `owners.manage` hanya di `tenant_owner` (migrasi 0015; Demo Foundation 2.3 §5–§6). Anti-eskalasi yang sudah ada kini melindungi pemegang role owner | selesai |
| ~~D-29~~ | ~~Nama event audit menyimpang dari Demo Foundation §15~~ | **LUNAS 2026-09-22** — ternyata ±14 nama, bukan 3: kode memakai `<domain>.<aksi>` + `outcome`, SSOT memasukkan hasil ke nama. Keputusan: SSOT ikut kode (Demo Foundation 2.4 §15); satu perubahan kode, `auth.refresh.reuse_detected` | selesai |
| ~~D-30~~ | ~~F-14 tanpa allowlist; `count_recent_failures` tidak terdaftar~~ | **LUNAS 2026-09-23** — allowlist menjadi katalog `audit_event_types` + foreign key dari `audit_logs` (migrasi 0016), berlaku untuk setiap penulis audit; F-14 dicatat sesuai implementasi dan F-17 didaftarkan (ADR 2.4; Demo Foundation 2.5; Infrastructure 2.3) | selesai |
| ~~D-31~~ | ~~Skema logis §7.3 berbeda dari implementasi~~ | **LUNAS 2026-09-23** — §7.3 ditulis ulang mengikuti `db/migrations` (kolom, tipe, constraint, partial index) dan diperiksa kolom-per-kolom terhadap database: 17 tabel cocok. `crypto_keys` ditambahkan ke §7.1/§7.2/§7.3 dan Table Ownership Register (Demo Foundation 2.6, Infrastructure 2.4) | selesai |

Belum ada: halaman profil sendiri (DEMO-0206: `GET /me`, `PATCH /me/profile`).

## Catatan slice 13 — guard platform dan notifikasi keamanan (2026-09-26)

Cakupan: DEMO-0311 (guard platform + pengelolaan admin platform) dan DEMO-0313
(notifikasi keamanan tenant). Break-glass support session (DEMO-0312) TIDAK ikut.

Yang membuat batas platform nyata, bukan sekadar guard aplikasi: tabel platform
tidak punya `tenant_id`, dan yang menjaganya adalah GUC `app.context_kind`.
Pembacanya, `app_context_kind()`, **fail-closed** — nilai kosong dibaca sebagai
`tenant`, bukan `platform`. Jadi kode yang lupa menetapkan context mendapat nol
baris, bukan akses penuh.

### Yang TIDAK ikut lunas bersama slice 13

| # | Celah | Kenapa penting | Ditagih di |
|---|---|---|---|
| D-32 | **Aksi yang gagal mengosongkan isian formulir.** Render ulang server sesudah `useActionState` mengembalikan kegagalan mengembalikan input tak-terkendali ke nilai awal, sehingga apa yang sudah diketik hilang. | Orang mengetik ulang seluruh formulir setelah satu kesalahan kecil. Bukan kehilangan data di server, tetapi cukup menjengkelkan untuk membuat orang berhenti memakai layar. | Slice berikutnya yang menyentuh formulir |
| D-33 | **Tidak ada perpindahan ke context PLATFORM dari session tenant yang sedang berjalan.** Pemilihan platform hanya terjadi saat login. | Superadmin yang juga anggota tenant harus keluar lalu masuk lagi untuk berpindah. Asimetri dengan `POST /me/context-switch` yang sudah ada untuk tenant. | DEMO-0409 |
| D-34 | **Menambah admin platform memerlukan `user_id`, bukan email.** Tidak ada pencarian identitas global di jalur platform. | Sengaja: superadmin tidak membaca email/nama identitas global dalam bentuk terbuka (ADR-003 §2.1), dan pencarian lewat email akan menjadi permukaan enumerasi baru di tingkat platform. Akibatnya id harus didapat dari luar aplikasi. | Bersama `platform.identities.read_status` (DEMO-0311 sisa) |
| D-35 | **Mencabut hak platform tidak mencabut session platform yang sedang berjalan.** Hak hilang pada login berikutnya, bukan seketika. | Superadmin yang baru dicabut masih dapat memakai session platformnya sampai kedaluwarsa. Pencabutan session adalah bagian dari alur support session. **TIDAK dikerjakan di DEMO-0312**: slice itu mengakhiri sesi SUPPORT saat session platform berakhir (arah sebaliknya), bukan mencabut session platform saat haknya dicabut. | DEMO-0409 |
| D-36 | **Tidak ada job periodik yang menutup sesi support kedaluwarsa.** Statusnya berubah menjadi `EXPIRED` saat jalur yang peduli berjalan (membuka sesi baru atau memuat daftar sesi). | Token support sudah mati sejak `expires_at` (F-18 fail-closed), jadi ini bukan celah akses. Akibatnya: notifikasi "sesi berakhir" ke tenant bisa terlambat sampai ada superadmin yang membuka konsol, dan index "satu sesi aktif" baru terbebas saat itu. | Bersama scheduler (di luar baseline) |
| D-37 | **Membuka masker DP-1 di dalam sesi support belum ada.** Nama anggota selalu ber-masker; tidak ada aksi "reveal" beralasan dan teraudit. | Support tidak dapat memastikan identitas anggota saat menangani kasus yang memang menuntutnya. Nama event `support.data_revealed` sudah ada di katalog audit tetapi TIDAK dipakai kode - sengaja, supaya nama yang tidak pernah ditulis tidak terlihat seperti sudah dipakai. ADR-003 sec.2.2 butir 3 menuntut reveal DP-1 beralasan; reveal DP-2 tetap tidak tersedia. | DEMO-0409 |
| D-38 | **Database tidak menuntut `support_sessions.superadmin_user_id` benar-benar memegang role platform.** Yang menjaganya adalah route platform di aplikasi. | Baris sesi support dapat dibuat atas nama identitas mana pun oleh kode yang keliru, dan RLS akan tetap membukakan tenant itu untuk sesi tersebut. Bukan celah lewat API (route platform yang membuatnya), tetapi satu lapis lebih sedikit daripada yang lain di slice ini. Diuji apa adanya di kasus SQL slice 14 #3, bukan disembunyikan. | Bersama role platform kedua |
| D-39 | **Teks alasan sesi support tidak dapat dibaca kembali dari mana pun.** Disimpan terenkripsi dengan DEK PLATFORM, dan tidak ada endpoint yang mengembalikannya. | Alasan bebas adalah inti pertanggungjawaban break-glass, tetapi saat ini hanya dapat dibaca lewat database + KEK. Daftar sesi (platform dan tenant) hanya memuat `reason_code` dan nomor tiket. | DEMO-0409 |

### Mutasi yang LOLOS di slice 13, dicatat apa adanya

- **A4** — menghapus penjaga "superadmin terakhir tidak dapat dicabut" tidak
  menggagalkan tes apa pun. Sebabnya bukan tes yang kurang: dengan larangan
  mengubah assignment diri sendiri berlaku, aturan itu **tidak terjangkau** lewat
  endpoint yang ada — pelaku selalu seorang admin aktif dan tidak boleh mencabut
  dirinya sendiri, jadi sesudah pencabutan minimal satu admin selalu tersisa.
  Penjaganya tetap dipasang sebagai lapis kedua untuk saat penangguhan identitas
  global (`platform.identities.suspend`) atau role platform kedua masuk, karena
  keduanya membuka jalan yang tidak lewat larangan itu.
- **P9** — menghapus pemeriksaan keberadaan tenant di F-15 juga tidak
  menggagalkan tes: foreign key `tenant_notifications.tenant_id -> tenants`
  menolak hal yang sama dengan kode error yang sama. Ekuivalen, bukan celah.

### Batas yang perlu dikatakan terus terang

`tenant_notifications` lengkap dengan RLS, endpoint, dan layarnya — tetapi
**tidak ada alur produk yang memanggil F-15** sampai support session dibuat.
Yang memanggilnya hanya tes. Yang nyata di sini adalah skema, penjaga, dan
isolasi tenant; bukan fitur yang dapat didemonstrasikan.


## Catatan Bagian A DEMO-0409 — menu sebagai data (2026-09-28)

**LUNAS bersama Bagian A:** DEMO-0401 (skema menu), DEMO-0402 (validasi hierarki dan route
di database), DEMO-0403 (resolver menu efektif, `GET /me/menu`), DEMO-0405 (sidebar dan kartu
dasbor dibangun dari endpoint itu; `NAV` di `Kerangka.tsx` dihapus).

### Yang TIDAK ikut lunas bersama Bagian A

| # | Utang | Akibatnya sekarang | Ditagih |
|---|---|---|---|
| D-41 | **Administrasi menu belum ada (DEMO-0404/0406, P2).** `app_user` tidak punya grant INSERT/UPDATE/DELETE pada `menus` maupun `menu_permissions`, dan tidak ada endpoint `/menus`. | Menu hanya dapat diubah lewat migrasi. Tenant tidak dapat punya menu sendiri dalam demo, meskipun skemanya (`tenant_id`, `owner_key`) sudah mendukungnya dan diuji. Permission `menus.create/update/archive/assign_permission` sengaja TIDAK diseed. | P2, bila kapasitas tersisa setelah P0/P1 |
| D-42 | **Tidak ada menu `Profile`.** Demo Foundation sec.16.3 mencantumkannya, tetapi halaman `/profile` belum ada (DEMO-0206). | Seed menu berisi 6 menu tenant tanpa profil. Menu yang menunjuk halaman yang tidak ada lebih buruk daripada menu yang belum ada: ia menawarkan jalan buntu. | Bersama DEMO-0206 |
| D-43 | **Ikon menu hanya nama, belum dirender.** Kolom `icon` terisi (`home`, `settings`, ...) dan ikut dikembalikan `GET /me/menu`, tetapi web tidak memakainya. | Navigasi tampil sebagai teks saja. Registry ikon masih open decision di Demo Foundation sec.24. | Bersama keputusan icon registry |

### Batas yang perlu dikatakan terus terang

Menu yang disembunyikan **bukan** kontrol akses, dan itu diuji di dua lapisan sekaligus (API 15
#3 dan browser 15 #2): route-nya tetap dijawab 403 oleh API. Kalau suatu hari ada halaman yang
hanya "aman" karena menunya tidak muncul, kedua kasus itu tidak akan menangkapnya - yang
menjaga halaman tetap guard di route-nya, bukan resolver ini.

## Catatan fondasi langkah 1-2 (2026-09-28)

**LUNAS:** test inspeksi skema yang dituntut ADR §7 butir 7 sejak edisi pertama
(`api/test/register.test.ts`), dan ledger migrasi yang membuat baseline dapat dipasang MAJU ke
database berisi data (`schema_migrations`, `api/scripts/migrate.ts`).

| # | Utang | Akibatnya sekarang | Ditagih |
|---|---|---|---|
| D-44 | **Formulir yang disimpan dua kali berturut-turut mengirim `version` basi pada penyimpanan kedua.** `revalidatePath` menyegarkan halaman, tetapi tidak selalu sebelum klik berikutnya terjadi. | Penyimpanan kedua ditolak 409 dan layar menampilkan keadaan yang belum berubah - gejalanya menyesatkan ("tidak tersimpan"), padahal yang terjadi adalah optimistic locking bekerja. Tidak ada data tertimpa. Perbaikan sebenarnya: aksi mengembalikan `version` baru dan formulir memakainya, bukan menunggu penyegaran. Dijaga sementara oleh browser slice 12 #2 yang kini memeriksa versi di layar ikut segar. | Bersama perbaikan state formulir (D-32) |
| D-45 | **Tidak ada migrasi turun (down migration), dan tidak akan dipalsukan.** | Pembatalan perubahan skema bergantung pada backup terverifikasi + rehearsal (Infrastructure §8.4). Untuk database produk yang berisi data, ini prosedur operasional, bukan fitur aplikasi. | Sebelum data nyata |
| D-46 | **Ledger tidak tahu versi baseline sebagai satu kesatuan.** Yang tercatat adalah per berkas migrasi, bukan "baseline 2.15". | Produk tidak dapat menjawab "baseline versi berapa yang terpasang di sini" selain dengan membandingkan daftar migrasi. Terkait cara distribusi baseline, yang masih open decision (ADR-001 §3.11). | Bersama keputusan distribusi |

### Lima keputusan yang BELUM diambil, dan tidak boleh terbentuk diam-diam oleh kode

Dicatat di ADR-001 §3.11 sebagai open decision, diulang di sini karena masing-masing akan
menjadi utang besar kalau kode mendahului keputusannya:

1. **identitas lintas produk** - satu identitas bersama untuk semua produk, atau identitas per
   produk? Ini yang terbesar: ADR-002 menetapkan identitas global dalam satu database, dan
   database per produk membuat "global" tidak lagi punya arti yang sama;
2. **audit lintas produk** dan pelaporan gabungan;
3. **namespace permission per komponen** (`hr.*`, `pos.*`) beserta siapa yang boleh menambah
   entri katalog - hari ini katalog hanya dapat diubah migrasi baseline;
4. **entitlement modul per tenant** - permission `platform.entitlements.manage` ada di katalog
   sejak slice 10 tanpa apa pun di belakangnya;
5. **cara baseline didistribusikan** ke produk (paket, submodule, salinan).

## Catatan fondasi langkah 3 - provisioning tenant (2026-09-29)

**LUNAS:** D-17 (tenant baru tidak mendapat kunci enkripsi) dan D-25 (role sistem hanya dari
seed). Keduanya tertutup oleh `POST /platform/tenants`: kunci lewat F-26, role dari template
lewat F-27, owner pertama lewat F-28 - satu transaksi.

| # | Utang | Akibatnya sekarang | Ditagih |
|---|---|---|---|
| ~~D-47~~ | ~~`PATCH /platform/tenants/:id/status` belum ada~~ | **LUNAS 2026-10-02** — endpoint, transisi `ACTIVE ↔ SUSPENDED`, dan audit `tenant.status_changed` dua sisi; yang membuatnya berarti adalah F-21 (migrasi 0024), yang kini menolak session tenant non-`ACTIVE`. `PURGED`/`ARCHIVED` tetap belum ada (CHECK tabel bahkan belum mengenal `PURGED`). Dibuktikan `api/test/tenant-status.test.ts` | selesai |
| D-48 | **Provisioning tidak idempotent dan tidak dapat dilanjutkan.** ADR-001 §3.6 menuntut provisioning idempotent; yang ada sekarang adalah satu transaksi yang gagal seluruhnya atau berhasil seluruhnya. | Kegagalan berarti mengulang dari awal - dan itu AMAN (tidak ada tenant tertinggal), tetapi bukan yang dituntut ADR. Idempotensi baru diperlukan bila provisioning kelak menyentuh hal di luar transaksi database (mis. object storage atau layanan lain), dan saat itu ia harus dirancang, bukan ditambal. | Sebelum provisioning menyentuh sistem di luar database |
| D-49 | **Owner pertama tidak dimintai persetujuan.** Konsekuensi langsung pengecualian ADR-002 §2.3a. | Seseorang dapat menjadi owner sebuah tenant tanpa pernah menyetujuinya; yang membatasi dampaknya hanya audit di kedua sisi dan sifat sekali-pakai per tenant. Bila kelak persetujuan dituntut (Legal/DPO, atau produk yang menjual tenant ke pihak luar), jalurnya sudah ada: undangan owner dengan status tenant `PROVISIONING` sampai diterima. | Sebelum data nyata, atau saat Legal/DPO meninjau |
| D-50 | **Kunci tenant dibuat hanya versi 1, dan tidak ada rotasi.** Sama dengan D-15, tetapi sekarang menyentuh lebih banyak tenant: setiap tenant baru lahir dengan `key_version = 1` selamanya. | Tidak ada jalan mengganti kunci tenant tanpa menulis ulang seluruh ciphertextnya. F-24/F-25 sudah mendukung banyak versi, jadi yang belum ada adalah alur rotasinya - bukan skemanya. | Bersama D-15 |

## Catatan rate limit per IP klien (2026-09-30)

**LUNAS sebagian:** password spraying (satu password dicoba ke banyak email) kini diperlambat.
Lapis per email (slice 6) tidak dapat melakukannya, karena setiap email hanya mendapat satu
kegagalan. Lapis kedua menghitung kegagalan per IP klien: `DEMO_LOGIN_IP_MAX_FAILURES`
(bawaan 30) dalam jendela yang sama dengan lapis per email. BFF meneruskan IP lewat header
`x-demo-client-ip`, dan API hanya mempercayainya dari `DEMO_TRUSTED_PROXIES` (bawaan loopback).
Dibuktikan `api/test/ratelimit-ip.test.ts` (5 kasus), `web/test/ratelimit-ip.spec.ts` (BFF benar-benar meneruskan IP), dan mutasi yang tertangkap.

Batas global yang mengunci SEMUA login sengaja tidak dibuat: satu penyerang dapat memakainya
untuk mengunci semua orang.

| # | Utang | Akibatnya sekarang | Ditagih |
|---|---|---|---|
| D-51 | **Penghitung per IP ada di memori proses API.** Ini pengecualian terhadap alasan lapis pertama ("restart untuk membuka kunci bukan sifat yang diinginkan"), diambil karena versi database menuntut kolom baru di `audit_logs` dan perubahan fungsi `auth.*` terdaftar (Lampiran A). | Hitungan hilang saat API dimulai ulang, dan TIDAK dibagi antar-instance: dengan N instance, penyerang mendapat N kali kuota. Lapis per email tidak terdampak (tetap di database). | Sebelum API dijalankan lebih dari satu instance |
| D-52 | **IP klien hanya dapat dipercaya bila web berada di balik proxy.** Next mengisi `x-forwarded-for` dengan alamat socket hanya bila header itu belum ada; kiriman klien dibiarkan. `WEB_TRUSTED_PROXY_HOPS` (bawaan 0) menentukan posisi yang dipercaya. | Web yang diekspos langsung (bawaan, pengembangan) memungkinkan klien memilih IP-nya sendiri: batas per IP dapat diputari, dan kuota IP orang lain dapat dihabiskan. Batas per email tetap berlaku. | Sebelum web dapat dijangkau dari luar: pasang proxy dan setel `WEB_TRUSTED_PROXY_HOPS` |
| D-53 | **Jalur penerimaan undangan tidak diuji untuk batas per IP.** Kodenya memakai penghitung yang sama dengan login, tetapi tes per IP hanya melewati `POST /auth/login`. | Mutasi yang menghapus pencatatan kegagalan di `invitation.service.ts` akan lolos. | Bersama tes undangan berikutnya |
| D-54 | **Salah konfigurasi mengubah batas per IP menjadi kunci GLOBAL.** Bila API tidak menerima `x-demo-client-ip` dari proxy tepercaya - web berjalan di host lain yang alamatnya tidak ada di `DEMO_TRUSTED_PROXIES`, atau BFF versi lama yang tidak meneruskannya - semua pengguna terhitung sebagai SATU IP: alamat server web. | `DEMO_LOGIN_IP_MAX_FAILURES` kegagalan dari siapa pun mengunci login SEMUA orang selama jendela berjalan. Terbukti saat mutasi yang menghapus penerusan IP dari halaman login: 37 tes browser lain ikut gagal. Setiap deployment web di host terpisah WAJIB menyetel `DEMO_TRUSTED_PROXIES` di API ke alamat web. | Sebelum web dan API dipisah host |

## Catatan suspend tenant - D-47 (2026-10-02)

**Ditemukan saat merancangnya:** status tenant tidak diperiksa request mana pun. Infrastructure
SSOT §8.6 menuntutnya, dan baris F-21 di Lampiran A menyatakan F-21 membaca membership dan
tenant - fungsi yang terpasang sejak 0004 hanya membaca `sessions`. Endpoint suspend di atas
keadaan itu akan menulis status yang tidak dibaca siapa pun. Migrasi 0024 memperbaiki F-21;
untuk membership, celahnya sudah tertutup dari arah lain sejak slice 10-11 (penangguhan mencabut
session, `effective_permissions` hanya menghitung membership `ACTIVE`).

**Perubahan perilaku yang disengaja:** anggota yang membership-nya tidak `ACTIVE` kini mendapat
401 (session ditolak), bukan 403 (session diterima, permission kosong). Slice 10 #6 diperbarui;
jalur penangguhan lewat API sudah menghasilkan 401 sejak slice 11 karena mencabut session.

| # | Utang | Akibatnya sekarang | Ditagih |
|---|---|---|---|
| D-55 | **Session anggota tidak dicabut saat tenant disuspend.** F-21 menolaknya selama tenant tidak `ACTIVE`, tetapi barisnya tetap hidup. Mencabutnya dari context platform berarti menulis data tenant tanpa break-glass (ADR-003); jalan yang benar adalah fungsi definer terdaftar baru. | Reactivate menghidupkan kembali setiap session yang belum kedaluwarsa. Jendelanya sempit - session tenant berumur 60 menit (bawaan `createTenantSession`) dan refresh tidak memperpanjangnya - tetapi tidak nol. Untuk suspend karena tagihan ini tidak berbahaya; untuk suspend karena **insiden keamanan** ia salah - pengguna yang mungkin dikompromikan masuk lagi tanpa login. Dipaku `tenant-status.test.ts` #9 supaya perubahannya terlihat. | Sebelum suspend dipakai untuk insiden keamanan |
| D-56 | **Konsol platform belum punya layar tenant.** Endpoint ada; web belum. | Skenario demo 6 butir 2 (suspend Tenant Beta dari konsol) masih harus lewat API langsung. | Bersama layar registry tenant |

