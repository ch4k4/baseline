# SETUP - panduan lengkap dari nol

Ditulis untuk diikuti baris demi baris tanpa perlu menebak apa pun. Setiap langkah
menyebutkan **apa yang seharusnya muncul di layar**, supaya Anda tahu sendiri kapan
sesuatu melenceng, tanpa menunggu ditanya.

Semua perintah dijalankan di **PowerShell**, di mesin Anda sendiri. Tidak ada yang
menyentuh internet, tidak ada yang menyentuh database lain selain `saas_demo`.

> **Database `app_db` milik Anda tidak akan disentuh.** Seluruh skrip di sini hanya
> membuat, menghapus, dan mengisi database bernama `saas_demo`.

---

## Langkah 0 - Periksa prasyarat (sekali saja)

Buka PowerShell, lalu jalankan tiga perintah ini satu per satu:

```powershell
node -v
npm.cmd -v
psql --version
```

Yang seharusnya muncul:

| Perintah | Harus menunjukkan | Kalau tidak |
|---|---|---|
| `node -v` | `v22.x` atau lebih tinggi | Pasang Node 22+ dulu; versi di bawah itu akan gagal di tempat yang membingungkan |
| `npm.cmd -v` | `10.x` atau lebih tinggi | Ikut terpasang bersama Node |
| `psql --version` | `psql (PostgreSQL) 18.x` | Tambahkan `D:\tools\postgresql\bin` ke PATH |

**Kenapa `npm.cmd`, bukan `npm`?** PowerShell menolak menjalankan `npm.ps1` karena
berkas itu tidak bertanda tangan digital. `npm.cmd` melewati pembungkus PowerShell
sepenuhnya dan fungsinya persis sama. Pakai `npm.cmd` di seluruh panduan ini.

---

## Langkah 1 - Set password superuser PostgreSQL

```powershell
$env:DEMO_DB_SUPER_PASSWORD = 'pa55word'
```

**Ini hilang setiap kali jendela PowerShell ditutup.** Bukan bug - begitulah cara
variabel lingkungan bekerja. Setiap buka jendela baru, ulangi langkah ini dulu.
Kalau lupa, skrip akan memberi tahu Anda, bukan gagal diam-diam.

Password ini tidak pernah ditulis ke berkas mana pun.

---

## Langkah 2 - Diagnosa (jalankan ini dulu, selalu)

```powershell
cd D:\claude\base\app\db\scripts
.\db.ps1 doctor
```

Yang seharusnya muncul:

```
db.ps1 2026-09-20.4

PowerShell   : 5.1.26100.xxxx (Desktop)
psql         : D:\tools\postgresql\bin\psql.exe
psql (PostgreSQL) 18.6
Target       : postgres@127.0.0.1:5432

Uji argumen -c (harus mencetak angka 1, BUKAN membuka prompt):
1
OK - psql menerima -c dengan benar.

Database yang ada:
app_db
postgres
```

Tiga hal yang Anda periksa di sini:

1. **Baris pertama menunjukkan `2026-09-21.8` atau lebih baru.** Kalau angkanya lebih
   kecil, berkas Anda versi lama - minta versi terbaru sebelum lanjut.
2. **Muncul angka `1`, bukan prompt `postgres=#`.** Kalau yang muncul prompt, berhenti
   di sini dan laporkan; jangan lanjut ke langkah berikutnya.
3. **Daftar database.** Kalau `saas_demo` sudah ada dari percobaan sebelumnya, pakai
   `reset` di langkah 4, bukan `setup`.

---

## Langkah 3 - Pasang dependensi API (sekali saja)

Langkah ini sekarang HARUS sebelum membangun database: sejak enkripsi field (slice 8),
identitas demo dibuat oleh seed di `app\api`, bukan oleh SQL.

```powershell
cd D:\claude\base\app\api
npm.cmd install
```

Yang seharusnya muncul: `added ... packages` (jumlahnya boleh berbeda).

Sejak D-12 (Prisma), `npm.cmd install` juga menampilkan peringatan
`allow-scripts` untuk `prisma` dan `@prisma/engines`, ditambah 4 temuan audit
*high* dari CLI `prisma`. Keduanya dapat diabaikan untuk demo lokal. **Jangan**
jalankan `npm audit fix --force`: perintah itu menurunkan Prisma ke versi 6.
Unduhan mesin Prisma terjadi saat `prisma generate` pertama kali dijalankan
(butuh akses ke `binaries.prisma.sh`).

Setiap pemanggilan `prisma generate` di repo ini memakai `--no-hints`. Pada
2026-09-23 CLI Prisma menawarkan memasang "agent skills" ke dalam folder proyek,
dan tawaran itu diterima sendiri setelah 30 detik tanpa jawaban - isinya diunduh
dari GitHub ke `app\api`. Folder itu sudah dihapus. Kalau tawaran serupa muncul
lagi, jawab **No**: tidak ada yang boleh masuk ke folder proyek ini tanpa diminta.

Kalau muncul `npm.ps1 cannot be loaded ... not digitally signed`, Anda mengetik `npm`,
bukan `npm.cmd`.

---

## Langkah 4 - Bangun database

```powershell
cd D:\claude\base\app\db\scripts
.\db.ps1 reset
```

(`setup` juga bisa bila `saas_demo` belum ada; `reset` selalu aman.)

Yang seharusnya muncul:

```
db.ps1 2026-09-21.8
  -> hapus database saas_demo
  -> buat database saas_demo
  -> role, schema auth, grant dasar (0001)
  -> migrasi 0002_schema.sql
  ...
  -> migrasi 0011_field_encryption.sql
  -> seed demo (0005, sebagai superuser)
  -> build API (seed memakai kode kripto yang sama dengan API)
  -> seed identitas demo terenkripsi
  -> KEK demo baru dibuat di C:\Users\<anda>\.saas-demo\kek-dev.key
  -> 7 kunci baru, 4 identitas, 5 profil (terenkripsi)
4 identitas demo siap dipakai login.
  -> tes slice1_test.sql sebagai app_user
NOTICE:  SEMUA 15 KASUS LULUS
  ...
NOTICE:  SEMUA 8 KASUS SLICE 8 LULUS

  SEMUA TEST LULUS (5 berkas)
```

Baris `KEK demo baru dibuat` hanya muncul sekali, pada `reset` pertama. Setelahnya
tertulis `KEK demo: ...` saja.

Satu baris `NOTICE: role "app_owner" has already been granted...` boleh muncul dan
tidak apa-apa - itu pemberitahuan, bukan error.

**`SEMUA TEST LULUS` berarti isolasi tenant dan bentuk enkripsi terbukti di database
Anda**, bukan sekadar "tidak error": setiap kasus memeriksa nilai, termasuk kasus
negatif seperti "tenant lain tidak boleh terbaca walau id-nya diketahui" dan "nama
polos yang dikirim ke kolom ciphertext ditolak".

Kalau berhenti di `Dependensi API belum terpasang`, Anda melewati langkah 3.

### `reset` adalah alat anti-macet

Begitu keadaan database mulai tidak jelas, **jangan menebak apa yang berubah**.
Jalankan `reset`. Seluruh isinya dibentuk dari berkas migrasi yang deterministik dan
seed dengan UUID tetap, jadi hasilnya selalu sama. Ini jauh lebih cepat daripada
mendiagnosis database yang sudah campur aduk.

`.\db.ps1 test` boleh dijalankan sesering apa pun tanpa `reset`: tes SQL tidak
meninggalkan data. Sejak slice 8 perintah itu juga butuh `$env:DEMO_DB_SUPER_PASSWORD`.

---

## Langkah 5 - Kunci enkripsi demo (KEK) - baca sekali

Email dan nama di database tersimpan terenkripsi. Kunci-kunci datanya (DEK) ada di
tabel `crypto_keys`, dibungkus oleh satu kunci induk (KEK) yang **tidak pernah ada di
database maupun di repo**. KEK demo tinggal di:

```
C:\Users\<anda>\.saas-demo\kek-dev.key
```

Tiga hal yang perlu diketahui:

- **Jangan salin berkas ini ke folder repo, dan jangan kirim ke siapa pun.** Berkas
  itu saja cukup untuk membuka seluruh data demo. Untuk data sintetis ini diterima;
  untuk data nyata tidak (lihat DEFERRED.md D-13).
- **Kalau berkas itu hilang, data demo tidak dapat dibuka lagi - dan itu memang
  intinya.** Obatnya `.\db.ps1 reset`: database dibangun ulang dan KEK baru dibuat.
  API dan seed akan menyebut langkah ini sendiri bila KEK tidak ditemukan atau tidak
  cocok; keduanya berhenti, bukan menulis data yang tidak dapat dibaca.
- Lokasinya dapat dipindah dengan `$env:DEMO_KEK_FILE` - variabel itu harus sama di
  jendela yang menjalankan `db.ps1`, API, dan tes.

Isi ulang identitas tanpa membangun ulang database: `.\db.ps1 seed` (nama lama
`.\db.ps1 passwords` tetap berfungsi). Password demo semuanya `Demo#12345`; untuk
menggantinya set `$env:DEMO_PASSWORD` sebelum `seed`.

---

## Langkah 6 - Jalankan tes API

```powershell
npm.cmd run test:e2e
```

Yang seharusnya muncul di bagian akhir:

```
tests 155
pass 155
fail 0
```

(Di Windows setiap baris diawali simbol info, misalnya `i tests 155`.)

Kalau ada yang `fail`, **jangan langsung memperbaiki kode**. Kirimkan keluarannya;
155 kasus ini sudah terbukti bisa gagal - lihat AUDIT.md (setiap kasus diuji dengan cara merusak
kodenya sendiri), jadi kegagalan di sini berarti ada perbedaan nyata antara mesin
Anda dan lingkungan tempat kode ini dibangun - itu informasi, bukan sekadar error.

---

## Langkah 7 - Jalankan API dan coba sendiri

```powershell
npm.cmd run dev
```

Yang seharusnya muncul: `API siap di http://127.0.0.1:3001`

Biarkan jendela itu terbuka. **Buka jendela PowerShell kedua**, lalu:

```powershell
# login sebagai pemilik Tenant Alpha
$login = Invoke-RestMethod -Uri http://127.0.0.1:3001/api/v1/auth/login -Method Post `
  -ContentType 'application/json' `
  -Body '{"email":"owner@alpha.demo","password":"Demo#12345"}'
$login

# lihat anggota tenant yang sedang aktif
Invoke-RestMethod -Uri http://127.0.0.1:3001/api/v1/members `
  -Headers @{ Authorization = "Bearer $($login.token)" } | ConvertTo-Json -Depth 5
```

Yang seharusnya muncul: tiga anggota - Alpha Owner, Alpha User, Multi di Alpha.

Sekarang buktikan isolasinya sendiri. Ulangi dengan identitas tenant lain:

```powershell
$beta = Invoke-RestMethod -Uri http://127.0.0.1:3001/api/v1/auth/login -Method Post `
  -ContentType 'application/json' `
  -Body '{"email":"admin@beta.demo","password":"Demo#12345"}'

Invoke-RestMethod -Uri http://127.0.0.1:3001/api/v1/members `
  -Headers @{ Authorization = "Bearer $($beta.token)" } | ConvertTo-Json -Depth 5
```

Yang seharusnya muncul: dua anggota Beta, **tanpa satu pun nama Alpha**.

Dan identitas yang punya dua tenant:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3001/api/v1/auth/login -Method Post `
  -ContentType 'application/json' `
  -Body '{"email":"multi@demo.local","password":"Demo#12345"}' | ConvertTo-Json -Depth 5
```

Yang seharusnya muncul: `status: CONTEXT_REQUIRED` dengan dua pilihan tenant, dan
**tanpa token** - karena context belum dipilih.

Hentikan API dengan Ctrl+C di jendela pertama.

---

## Langkah 8 - Halaman web (slice 3)

**Jendela PowerShell kedua**, biarkan API tetap berjalan di jendela pertama:

```powershell
cd D:\claude\base\app\web
npm.cmd install
npm.cmd run build
npm.cmd start
```

Yang seharusnya muncul: `Ready in ...` dan alamat `http://localhost:3000`.

Buka `http://127.0.0.1:3000` di browser. Yang seharusnya terjadi:

1. Anda diarahkan ke halaman **Masuk**.
2. Masuk sebagai `owner@alpha.demo` / `Demo#12345` -> muncul **tiga** anggota Alpha.
3. Klik **Keluar**, lalu masuk sebagai `admin@beta.demo` -> muncul **dua** anggota
   Beta, tanpa satu pun nama Alpha.
4. Masuk sebagai `multi@demo.local` -> diarahkan ke halaman pilih tenant; setelah
   memilih, tombol "Pindah ke ..." berpindah tenant tanpa masuk ulang.
5. Perhatikan kolom email kontak: tampil ber-masker (`o***@alpha.demo`). Email
   lengkap tidak pernah dikirim ke halaman daftar (slice 8).

6. **Undangan (slice 9).** Masuk sebagai `owner@alpha.demo`. Di bawah daftar anggota
   ada form **Undang anggota** - hanya owner yang melihatnya (coba `multi@demo.local`
   di Alpha: form tidak ada). Undang email apa saja yang sintetis, misalnya
   `tamu@contoh.demo`. Respons selalu "Undangan dikirim", baik email itu sudah punya
   akun maupun belum.
7. Undangan tidak dikirim lewat email. Buka folder
   `C:\Users\<anda>\.saas-demo\outbox`: setiap undangan satu berkas `.txt` berisi
   tautan `http://127.0.0.1:3000/invite?token=...`. Buka tautan itu di jendela
   penyamaran (tanpa login), isi nama dan password (minimal 10 karakter), lalu
   masuk dengan email undangan. Tautan yang sama tidak dapat dipakai dua kali.
   `reset` juga menulis satu undangan contoh untuk `baru@alpha.demo`.

8. **Hak akses (slice 10).** Anggota yang baru bergabung lewat undangan belum punya
   role, jadi setelah masuk ia melihat halaman **Tidak punya akses** - bukan daftar
   anggota, dan tidak dikeluarkan. `admin@beta.demo` bukan owner, tetapi tetap dapat
   mengundang karena role-nya memuat permission `members.invite`.

Isi folder outbox adalah email dan token sungguhan (walau sintetis) - perlakukan
seperti KEK: jangan disalin ke repo (DEFERRED.md D-22).

Butir 3 di atas adalah demo isolasi tenant yang sebenarnya - dua pengguna,
data yang sama sekali terpisah, disaring database dan bukan oleh kode halaman.

### Tes browser (opsional)

```powershell
npx.cmd playwright install chromium    # sekali saja, unduhan sekitar 150 MB
npm.cmd run test:e2e
```

Kedua server (3000 dan 3001) harus hidup, dan jendela ini juga butuh
`$env:DEMO_DB_SUPER_PASSWORD` (tes undangan membersihkan anggota yang ia tambahkan).
Target: `60 passed`.

Tes `d20.spec.ts` menyalakan instance Next KEDUA sendiri di port acak (dari build
yang sama) dan mematikannya lagi setelah selesai. Karena itu `npm.cmd run build`
wajib sudah dijalankan setelah kode web berubah.

---

## Catatan tentang `DEMO_JWT_SECRET`

Sejak slice 7 access token adalah JWT bertanda tangan. Di lokal Anda **tidak
perlu menyetel apa pun**: kalau `DEMO_JWT_SECRET` kosong, API memakai kunci
pengembangan bawaan.

Dua hal yang berlaku begitu ini bukan lagi demo lokal:

- Di `NODE_ENV=production` API **menolak start** tanpa `DEMO_JWT_SECRET`. Itu
  disengaja. Kunci acak yang dibuat sendiri saat start berarti setiap restart
  mencabut semua sesi, dan setiap instance menolak token instance lain - gejala
  yang muncul sebagai "kadang-kadang pengguna terlempar keluar".
- Mengganti kunci mencabut seluruh sesi yang sedang berjalan. Belum ada rotasi
  kunci; itu tercatat sebagai utang di `DEFERRED.md`.

---

## Memverifikasi semuanya dengan satu perintah

Langkah 6 dan tes browser di atas menguji satu lapisan masing-masing. Untuk memeriksa
SELURUHNYA sekaligus - reset database, tes SQL, tes API, `lint:guc`, dan tes browser -
ada satu perintah:

```powershell
cd D:\claude\base\app\scripts
$env:DEMO_DB_SUPER_PASSWORD = 'pa55word'
.\verify.ps1
```

Keluarannya satu putusan:

```
SQL                          117 kasus / 12 berkas (diharapkan 117 / 12)
API                          155 lulus / 0 gagal (diharapkan 155)
lint:guc                     lint-guc: bersih
server API                   dihidupkan oleh verify.ps1
server web                   dihidupkan oleh verify.ps1
browser                      60 lulus / 0 gagal (diharapkan 60)

HIJAU: 332 kasus
```

Kalau ada yang tidak beres, keluarannya `MERAH:` diikuti daftar alasan dan jalur folder
log lengkap. **Kirimkan jalur log itu**, bukan hanya baris merahnya.

Yang perlu diketahui:

- Angkanya dijaga di `scripts\verify-expected.json`. Jumlah yang KURANG adalah kegagalan -
  dan yang LEBIH juga, karena berarti ada tes ditambahkan tanpa memperbarui angka itu.
- Server API (3001) dan web (3000) **dihidupkan sendiri** bila belum hidup, dan hanya yang
  dihidupkannya yang dimatikan. Server yang sudah berjalan dipakai apa adanya.
- `.\verify.ps1 -TanpaReset` memakai database apa adanya (jauh lebih cepat, tetapi tidak
  memeriksa bahwa database dapat dibangun dari nol).
- `.\verify.ps1 -TanpaBrowser` melewati lapisan browser. Ini satu-satunya jalan menuju
  hijau tanpa browser, dan harus diminta dengan sengaja - lapisan yang gagal dijalankan
  tidak pernah dihitung hijau.
- Sekali saja sebelum lapisan browser dapat berjalan: `npx.cmd playwright install chromium`.

Perintah ini sudah terbukti di mesin target pada 2026-09-29: `HIJAU: 332 kasus` dari
database kosong, dan kedua server yang dihidupkannya mati bersih sesudahnya. Empat cacat
khas Windows ditemukan dan diperbaiki sepanjang jalan (rinciannya di AUDIT.md), semuanya
di verifikator dan bukan di kode yang diuji.

Satu hal yang normal di log Windows dan BUKAN kegagalan: blok `NativeCommandError` di
sekitar baris `NOTICE` dari psql. PowerShell menulis stderr perintah native seperti itu;
`NOTICE` adalah keluaran biasa migrasi yang idempoten.

Kalau masih gagal di mesin Anda, itu informasi yang dicari - kirimkan isi folder log yang
disebut pada baris terakhir.

---

## Ringkasan harian

Sesudah setup pertama selesai, ini saja yang perlu tiap kali mulai kerja:

Jendela 1 - API:

```powershell
cd D:\claude\base\app\api
$env:DEMO_DB_SUPER_PASSWORD = 'pa55word'
npm.cmd run dev
```

Jendela 2 - web:

```powershell
cd D:\claude\base\app\web
npm.cmd start
```

Kalau database terasa aneh:

```powershell
cd D:\claude\base\app\db\scripts
.\db.ps1 reset
```

Sebelum melaporkan bahwa "semua hijau", jalankan verifikatornya - bukan tiga jendela
dibaca mata:

```powershell
cd D:\claude\base\app\scripts
.\verify.ps1
```

---

## Kalau ada yang salah

| Yang Anda lihat | Artinya | Lakukan ini |
|---|---|---|
| `npm.ps1 cannot be loaded ... not digitally signed` | Mengetik `npm`, bukan `npm.cmd` | Pakai `npm.cmd` |
| Prompt `postgres=#` muncul saat menjalankan `db.ps1` | Skrip versi lama, atau berkasnya rusak encoding | Cek baris versi; harus `2026-09-20.4` atau lebih baru |
| PowerShell mencetak potongan kode skrip | Berkas `.ps1` tersimpan tanpa BOM UTF-8 dan memuat karakter non-ASCII | Jangan edit `.ps1` dengan editor yang menyimpan UTF-8 tanpa BOM |
| `Database "saas_demo" belum ada` | Langkah 4 terlewat | `.\db.ps1 reset` |
| `Database "saas_demo" sudah ada` | `setup` dipakai padahal database sudah ada | `.\db.ps1 reset` |
| `Tidak ada yang menjawab di 127.0.0.1:5432` | Service PostgreSQL mati | `Get-Service *postgres*` lalu `Start-Service <nama>` |
| `Password ditolak PostgreSQL` | `$env:DEMO_DB_SUPER_PASSWORD` kosong atau salah | Ulangi langkah 1 |
| `Tabel yang dibutuhkan belum ada` | Migrasi tidak lengkap | `.\db.ps1 reset` |
| Tes API gagal sebagian | Perbedaan nyata lingkungan | Kirim keluarannya, jangan tambal kodenya dulu |
| Semua login ditolak "Email atau password salah" setelah `reset` | Seed identitas tidak berjalan | Lihat keluaran `reset`; lalu `.\db.ps1 seed` |
| `KEK demo tidak ditemukan` | Berkas `.saas-demo\kek-dev.key` hilang, atau `$env:DEMO_KEK_FILE` berbeda antar jendela | `.\db.ps1 reset` (data demo dibuat ulang) |
| `KEK di mesin ini tidak dapat membuka kunci di database` | KEK dibuat ulang setelah seed, atau database dari mesin lain | `.\db.ps1 reset` |
| `Dependensi API belum terpasang` saat `reset` | Langkah 3 terlewat | `cd app\api` lalu `npm.cmd install` |
| Daftar anggota: `Data anggota tidak dapat dibaca` | Ciphertext tidak cocok dengan tempatnya (fail-closed) | `.\db.ps1 reset`; bila berulang, kirim log API |
| Halaman login berkata "Terlalu banyak percobaan masuk" (atau API menjawab `429`) walau passwordnya benar | Rate limiting: 5 percobaan gagal berturut-turut mengunci identitas selama 5 menit. Tes API sengaja mengunci `user@alpha.demo` | Tunggu 5 menit, **atau** `.\db.ps1 reset` (audit ikut terhapus, jadi hitungannya nol) |
| Halaman berkata "API tidak menjawab tepat waktu" | API hidup tapi tidak menjawab dalam 5 detik (query macet, database lambat). Batasnya dapat diubah dengan `$env:API_TIMEOUT_MS` di jendela web | Lihat log di jendela API; `Get-Service *postgres*` |
| `Tidak berwenang` terus walau baru saja masuk | Migrasi 0010 belum dijalankan, sehingga fungsi rotasi refresh token belum ada | `.\db.ps1 reset` |

---

## Satu aturan yang menghemat banyak waktu

Kalau sebuah langkah tidak menghasilkan keluaran seperti yang tertulis di panduan ini,
**berhenti di langkah itu**. Jangan lanjut ke langkah berikutnya sambil berharap
masalahnya hilang sendiri.

Alasannya bukan kehati-hatian berlebihan: kegagalan yang dibawa ke langkah berikutnya
akan muncul kembali dengan wajah yang sama sekali berbeda - dan mendiagnosis gejala
palsu itulah yang membuat orang berputar-putar berjam-jam.
