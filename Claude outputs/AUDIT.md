# Audit tes - 2026-09-21

Pertanyaan yang dijawab dokumen ini: **kalau kode yang dijaga sebuah tes rusak,
apakah tes itu benar-benar gagal?** Jumlah tes yang hijau tidak menjawabnya.
Satu-satunya cara adalah merusak kodenya dengan sengaja (mutasi) dan melihat
tes mana yang gagal.

## Hasil

| Lapisan | Mutasi efektif | Tertangkap tes sasaran | Tertangkap tes lain | Penjaga berlapis (terbukti) | Lolos tanpa penjelasan |
|---|---|---|---|---|---|
| SQL | 42 | 38 | 1 (redundan) | 3 | 0 |
| API | 34 | 34 | 0 | 0 | 0 |
| Browser | 15 | 11 | 3 | 1 | 0 |
| **Total** | **91** | **83** | **4** | **4** | **0** |

"Mutasi efektif" tidak menghitung 8 mutasi yang saya ganti karena cacat: 4 terlalu
lemah (dibatalkan penjaga lain sebelum sempat diuji) dan 4 ditolak TypeScript
sebelum tes berjalan. Keduanya dijelaskan di bawah.

Keadaan tes setelah audit: **117 kasus - 43 SQL, 46 API, 28 browser.** Dua kasus
baru lahir dari audit ini (API kasus 12, browser kasus 11); sisanya diperbaiki di
tempat.

## Yang ditemukan

### Tes yang tidak menguji apa yang diklaimnya (diperbaiki, lalu dibuktikan ulang)

| Tes | Kenapa lolos | Perbaikan |
|---|---|---|
| **3 dari 4 berkas tes SQL** | Tes commit datanya. Menjalankan `db.ps1 test` dua kali tanpa `reset` gagal karena tiket, hash, dan hitungan kegagalan sisa run pertama | Setiap berkas berjalan dalam satu transaksi yang di-ROLLBACK. Nol baris tersisa; tiga run berturut-turut hijau |
| SQL slice 1 kasus 8, seluruh slice 7 | `IF x <> y` diam-diam lulus saat `x` NULL. Fungsi rotasi yang **tidak mengembalikan baris** lolos semua 10 kasus slice 7 | Semua perbandingan menjadi `IS DISTINCT FROM` / `IS NOT TRUE`; aturannya ditulis di kepala setiap berkas |
| SQL slice 1 kasus 14 | Fungsi probe berjalan sebagai `app_user`, jadi hanya mengulang kasus 6. Menambah grant kolom ke `app_auth_definer` tidak terdeteksi | Daftar kolom yang dapat dibaca definer dicocokkan PERSIS lewat katalog |
| SQL slice 5 kasus 5, API slice 5 kasus 7 | Tidak ada tiket terbuka saat tiket palsu dicoba, jadi fungsi yang mengabaikan hash pun lulus | Tiket sah dibuka lebih dulu dan harus tetap utuh sesudahnya |
| API slice 2 kasus 7 | Tidak ada "token sampah" yang berbentuk JWT; pengaman parsing dapat dihapus tanpa ada yang gagal | Ditambah `a.b.c`, header sah tanpa badan, dan varian lain |
| API slice 6 kasus 10 | Memakai akun yang baru saja login sukses - hitungannya selalu nol, jadi rate limit global pun lolos | Serang satu identitas sampai terkunci, lalu pastikan identitas baru belum ikut terkunci |
| Browser slice 5 kasus 6 | Pengalihan yang diuji dipicu cookie **session**, bukan tiket; tiket yang tertinggal tidak terdeteksi | Cookie tiket harus hilang, dan tiket lama yang dipasang ulang harus ditolak server |
| Browser slice 3 kasus 4 | Email tak dikenal yang tetap menumpuk kegagalan tanpa pernah pulih | Email acak per run |
| *(tidak ada tes)* | Menghapus `burnEquivalentWork` tidak membuat satu tes pun gagal - keberadaan akun dapat ditebak dari waktu respons (50 ms lawan 6 ms) | **API kasus 12 baru**: rasio waktu email tak dikenal / password salah harus > 0,5. Terukur 0,98 pada kode utuh, 0,12 tanpa kerja setara |

Ditambah tiga yang ditemukan dan diperbaiki pagi ini sebelum audit dimulai:
API slice 6 kasus 4 dan 9 (lulus dari data sisa) dan API slice 2 kasus 2
(identitas tetap). Lihat README.

### Cacat produk yang ikut terungkap

**Akun yang terkunci rate limit diberi tahu "Email atau password salah."**
Halaman login mengubah setiap jawaban tidak-ok menjadi pesan itu, termasuk
`429`. Orang yang mengetik password BENAR saat terkunci terus diberi tahu salah,
dan setiap percobaan memperpanjang kebingungannya. Sekarang `429` punya pesannya
sendiri. Ini tidak membocorkan keberadaan akun: API menjawab `429` yang sama untuk
email terdaftar maupun tidak (API slice 6 kasus 8). Dijaga browser kasus 11 baru.

### Kesalahan saya sendiri selama audit

Dicatat karena kesalahan jenis ini menghasilkan rasa aman palsu yang persis sama
dengan tes yang lemah:

- **Empat mutasi terlalu lemah.** Grant yang saya sisipkan dibatalkan penjaga
  defensif di `0001_roles.sql` dan `REVOKE` di `0008_audit_logs.sql`; satu lagi
  (`OR true`) terlalu lebar sehingga kasus lain gagal lebih dulu. Keempatnya
  ditulis ulang (`...v2`) dan semuanya tertangkap. Yang terungkap di sini justru
  kabar baik: penjaga kedua itu bekerja.
- **Parser harness melewatkan kegagalan berjudul panjang** dan melaporkannya
  LOLOS. Diganti dengan laporan JSON Playwright, dan harness sekarang BERHENTI
  bila jumlah kegagalan yang terbaca berbeda dari hitungan runner. Semua vonis
  web yang bukan "tertangkap" dijalankan ulang; kesimpulan bahwa kasus 6 yang lama
  lemah tetap benar, diuji dengan salinan asli dari mesin target.
- **Slice 7 kemarin memuat lubang NULL** (lihat tabel di atas). Tes API
  menangkap kerusakan yang sama, tapi klaim tes SQL-nya - "sifat ini ditegakkan
  database, terlepas dari aplikasi" - tidak terpenuhi.

### Penjaga berlapis

Empat mutasi lolos karena sifatnya dijaga lebih dari satu tempat. Itu tidak
cukup diklaim; setiap kasus dibuktikan dengan mematikan KEDUA lapis:

- TTL tiket: penjaga di fungsi dan CHECK tabel (S5-06a/b; keduanya -> tertangkap).
- Session tercabut: filter `status` dan `revoked_at` (S5-09a; keduanya -> tertangkap).
- Halaman anggota tanpa token: pemeriksaan halaman hanya penghemat satu
  perjalanan; API menolak token kosong (W3-02v2).

Satu batasan yang tersisa dari sini: CHECK tabel TTL tiket tidak pernah diuji
SENDIRI, karena penjaga fungsi selalu menolak lebih dulu. Ia baru berarti bila
suatu saat ada fungsi lain yang menulis tiket. Tidak ditambahkan tes berbasis
teks definisi constraint karena formatnya dapat berbeda antarversi PostgreSQL.

## Metode

Harness mutasi menegakkan aturan berikut dengan kode, bukan ingatan:

1. Teks yang dimutasi harus muncul **tepat sekali**; mutasi yang meleset ditolak.
2. Berkas **selalu** dipulihkan dan hash-nya dicocokkan; seluruh berkas proyek
   dicocokkan dengan sidik jari sebelum audit setelah setiap putaran.
3. Suite kontrol harus hijau sebelum mutasi pertama, dan (untuk API) setelah
   setiap mutasi, supaya kunci rate limit dari satu mutasi tidak membuat mutasi
   berikutnya tampak "tertangkap".
4. Mutasi API **tidak** membangun ulang database di antaranya, supaya tes yang
   bergantung pada data sisa ketahuan.
5. Jumlah kegagalan yang terbaca harus sama dengan hitungan runner.

Harness berjalan di lingkungan pengembangan (Linux, PostgreSQL 16, Chromium
Playwright) dan **tidak disertakan** di repo: ia memakai jalur dan kredensial
lingkungan itu. Hasil akhirnya diverifikasi ulang di mesin target (Windows,
PostgreSQL 18.6) lewat suite biasa.

## Batas audit ini

- Slice 7 hanya diaudit untuk lubang NULL (S7-NULL); mutasinya sudah dijalankan
  saat slice itu dibangun.
- Ambang tes waktu (0,5) dipilih dari pengukuran di lingkungan pengembangan.
  [Medium confidence] bahwa ia sama stabilnya di mesin target: selisihnya kelas
  besar (scrypt lawan tanpa scrypt), tapi belum diukur di sana.
- Mutasi memilih kerusakan yang *masuk akal*; bukan jaminan bahwa tidak ada
  kerusakan lain yang lolos.

## Tabel lengkap

"Awal" diisi bila putaran pertama berbeda dari hasil akhir.

### SQL (database)

| Mutasi | Kasus sasaran | Sifat yang dimatikan | Awal | Akhir | Catatan |
|---|---|---|---|---|---|
| S1-01 | slice1_test.sql #1 | tanpa context -> 0 baris (fail-closed) | - | tertangkap |  |
| S1-02 | slice1_test.sql #2 | context Alpha hanya baris Alpha | - | tertangkap |  |
| S1-03 | slice1_test.sql #3 | context Beta hanya baris Beta | - | tertangkap |  |
| S1-04 | slice1_test.sql #4 | known-ID lintas tenant tidak terbaca | - | oleh tes lain | redundan: setiap kebocoran lewat ID juga terlihat di hitungan kasus 1-2 |
| S1-05 | slice1_test.sql #5 | insert lintas tenant ditolak WITH CHECK | - | tertangkap |  |
| S1-06a | slice1_test.sql #6 | app_user tanpa grant ke users | - | tertangkap |  |
| S1-06b | slice1_test.sql #6 | app_user tanpa grant ke credentials | - | tertangkap |  |
| S1-07v2 | slice1_test.sql #7 | app_user tidak bisa SET ROLE app_auth_definer (grant SETELAH penjaga defensif) | mutasi lemah | tertangkap |  |
| S1-08a | slice1_test.sql #8 | definer membaca identitas tanpa context (policy definer_read users) | - | tertangkap |  |
| S1-08b | slice1_test.sql #8 | normalisasi email di fungsi | LOLOS | tertangkap | tes diperbaiki (perbandingan NULL) |
| S1-09 | slice1_test.sql #9 | identitas lintas tenant melihat 2 context | - | tertangkap |  |
| S1-10 | slice1_test.sql #10 | resolusi session tanpa GUC | - | tertangkap |  |
| S1-11 | slice1_test.sql #11 | session tak terlihat dari tenant lain | - | tertangkap |  |
| S1-12 | slice1_test.sql #12 | composite FK menolak session lintas tenant | - | tertangkap |  |
| S1-13 | slice1_test.sql #13 | session PLATFORM tak pernah terlihat app_user | - | tertangkap |  |
| S1-14 | slice1_test.sql #14 | kolom di luar grant tidak terbaca lewat jalur definer | LOLOS | tertangkap | tes ditulis ulang (katalog) |
| S5-01 | slice5_test.sql #1 | tiket dibuat tanpa tenant context | - | tertangkap |  |
| S5-02 | slice5_test.sql #2 | app_user tak menyentuh tabel tiket | - | tertangkap |  |
| S5-03 | slice5_test.sql #3 | konsumsi mengembalikan pemilik tiket | - | tertangkap |  |
| S5-04 | slice5_test.sql #4 | tiket sekali pakai | - | tertangkap |  |
| S5-05 | slice5_test.sql #5 | hash asing tidak diterima | LOLOS | tertangkap | tes diperbaiki (tiket terbuka) |
| S5-06a | slice5_test.sql #6 | TTL > 5 menit ditolak (penjaga fungsi saja dihapus) | LOLOS | berlapis | berlapis: CHECK tabel tetap menolak |
| S5-06b | slice5_test.sql #6 | TTL > 5 menit ditolak (CHECK tabel saja dihapus) | LOLOS | berlapis | berlapis: penjaga fungsi tetap menolak |
| S5-06c | slice5_test.sql #6 | TTL: KEDUA penjaga dihapus | - | tertangkap | kedua lapis dimatikan -> tertangkap |
| S5-07 | slice5_test.sql #7 | keanggotaan sah ditemukan | - | tertangkap |  |
| S5-08 | slice5_test.sql #8 | keanggotaan lintas tenant tidak ditemukan | - | tertangkap |  |
| S5-09a | slice5_test.sql #9 | session tercabut tak teresolusi (filter revoked_at saja dihapus) | LOLOS | berlapis | berlapis: filter status tetap menolak |
| S5-09b | slice5_test.sql #9 | pencabutan benar-benar mengubah baris | - | tertangkap |  |
| S5-09c | slice5_test.sql #9 | session tercabut: KEDUA filter (status & revoked_at) dihapus | - | tertangkap | kedua filter dihapus -> tertangkap |
| S5-10 | slice5_test.sql #10 | pencabutan kedua melapor false | - | tertangkap |  |
| S6-01 | slice6_test.sql #1 | audit pre-context tanpa tenant/pelaku | - | tertangkap | tertangkap sebagai error di baris kasus 1 |
| S6-02 | slice6_test.sql #2 | kegagalan terhitung | - | tertangkap |  |
| S6-03 | slice6_test.sql #3 | hitungan per identitas, bukan global | - | tertangkap |  |
| S6-04a | slice6_test.sql #4 | detail berisi email ditolak | - | tertangkap |  |
| S6-04b | slice6_test.sql #4 | detail berisi token ditolak | - | tertangkap |  |
| S6-05av2 | slice6_test.sql #5 | app_user tak bisa UPDATE audit (REVOKE diganti grant) | mutasi lemah | tertangkap |  |
| S6-05bv2 | slice6_test.sql #5 | app_user tak bisa DELETE audit (REVOKE diganti grant) | mutasi lemah | tertangkap |  |
| S6-06 | slice6_test.sql #6 | app_user tak bisa INSERT audit langsung | - | tertangkap |  |
| S6-07 | slice6_test.sql #7 | audit tenant lain tak terlihat | - | tertangkap |  |
| S6-08 | slice6_test.sql #8 | audit pre-context tak terlihat tenant | - | tertangkap |  |
| S6-09v2 | slice6_test.sql #9 | keberhasilan menihilkan hitungan (subquery SUCCESS tak pernah cocok) | mutasi lemah | tertangkap |  |
| S7-NULL | slice7_test.sql #2 | rotasi sukses mengembalikan status ROTATED (fungsi tidak mengembalikan baris) | LOLOS | tertangkap | tes diperbaiki (perbandingan NULL) |

### API

| Mutasi | Kasus sasaran | Sifat yang dimatikan | Awal | Akhir | Catatan |
|---|---|---|---|---|---|
| A2-01 | slice2 #1. password salah ditolak generik | password salah ditolak | - | tertangkap |  |
| A2-02 | slice2 #2. email tak dikenal ditolak dengan respons identik | pesan identik | - | tertangkap |  |
| A2-02t | slice2 #2. email tak dikenal ditolak dengan respons identik | waktu respons identik (burnEquivalentWork) | LOLOS | tertangkap | tertangkap kasus 12 BARU (waktu respons) |
| A2-03 | slice2 #3. login benar menghasilkan session pada tenant yang tepat | tenant session benar | - | tertangkap |  |
| A2-04 | slice2 #4. anggota tenant Alpha hanya berisi anggota Alpha | runtime tidak memakai role yang menembus RLS | - | tertangkap |  |
| A2-05 | slice2 #5. anggota tenant Beta tidak memuat satu pun nama Alpha | GUC mengikuti session, bukan konstanta | - | tertangkap |  |
| A2-06 | slice2 #6. tanpa token ditolak | tanpa header ditolak | - | tertangkap |  |
| A2-07 | slice2 #7. token sampah ditolak 401, bukan 500 | token rusak tidak menjadi 500 | LOLOS | tertangkap | tes diperluas (sampah berbentuk JWT) |
| A2-07b | slice2 #7. token sampah ditolak 401, bukan 500 | header JWT rusak tidak menjadi 500 | LOLOS | tertangkap | tes diperluas (sampah berbentuk JWT) |
| A2-08 | slice2 #8. beban bergantian dua tenant pada pool kecil tidak membocork | tidak ada status tenant bersama antar-request | - | tertangkap |  |
| A2-09 | slice2 #9. identitas lintas tenant wajib memilih context | multi-tenant wajib memilih | - | tertangkap |  |
| A2-11 | slice2 #11. query di luar unit-of-work tidak mewarisi context tenant m | GUC transaction-local | - | tertangkap |  |
| A5-01v2 | slice5 #1. login lintas tenant mengeluarkan tiket, bukan token | tidak ada token sebelum memilih (lolos tipe) | ditolak TypeScript | tertangkap |  |
| A5-02 | slice5 #2. tiket tidak dapat dipakai sebagai token session | tiket bukan token | - | tertangkap |  |
| A5-03 | slice5 #3. menukar tiket menghasilkan session pada tenant pilihan | keanggotaan dicari di tenant pilihan | - | tertangkap |  |
| A5-04 | slice5 #4. tiket hanya sekali pakai | sekali pakai | - | tertangkap |  |
| A5-05v2 | slice5 #5. tiket tidak dapat menunjuk tenant yang bukan haknya | pemeriksaan keanggotaan (lolos tipe) | ditolak TypeScript | tertangkap |  |
| A5-06 | slice5 #6. percobaan gagal tetap membakar tiket | kegagalan membakar tiket | - | tertangkap |  |
| A5-07 | slice5 #7. tiket palsu ditolak | hash tiket dicocokkan | LOLOS | tertangkap | tes diperbaiki (tiket terbuka) |
| A5-08 | slice5 #8. daftar context milik sendiri dapat dibaca setelah punya ses | daftar context lengkap | - | tertangkap |  |
| A5-09 | slice5 #9. berpindah tenant memberi session tenant baru | pindah ke tenant yang diminta | - | tertangkap |  |
| A5-10 | slice5 #10. session lama mati setelah berpindah | session lama dicabut | - | tertangkap |  |
| A5-11 | slice5 #11. berpindah ke tenant yang bukan anggota ditolak | penolakan tidak mengeluarkan pengguna | - | tertangkap |  |
| A5-12 | slice5 #12. logout mencabut session | logout mencabut | - | tertangkap |  |
| A6-01v2 | slice6 #1. login berhasil tercatat sebagai SUCCESS dengan tenant dan s | login sukses diaudit dengan session | ditolak TypeScript | tertangkap |  |
| A6-02 | slice6 #2. login gagal tercatat, dengan alasan tapi tanpa email | identifier di-hash | - | tertangkap |  |
| A6-03 | slice6 #3. tidak ada email atau token di seluruh isi audit | email tidak masuk detail (kunci samaran) | - | tertangkap |  |
| A6-04 | slice6 #4. password salah dicatat dengan alasan BAD_PASSWORD | alasan BAD_PASSWORD | - | tertangkap |  |
| A6-05 | slice6 #5. logout tercatat | logout diaudit | - | tertangkap |  |
| A6-06 | slice6 #6. perpindahan tenant tercatat beserta pencabutan session lama | detail pencabutan | - | tertangkap |  |
| A6-07 | slice6 #7. percobaan gagal berulang akhirnya ditolak 429 | batas 5 kegagalan | - | tertangkap |  |
| A6-08 | slice6 #8. pesan 429 tidak membocorkan keberadaan akun | pesan 429 seragam | - | tertangkap |  |
| A6-09 | slice6 #9. throttling ikut tercatat di audit | throttle diaudit | - | tertangkap |  |
| A6-10 | slice6 #10. akun yang tidak diserang tetap dapat masuk | rate limit per identitas | - | tertangkap | tes ditulis ulang (isolasi langsung) |

### Browser

| Mutasi | Kasus sasaran | Sifat yang dimatikan | Awal | Akhir | Catatan |
|---|---|---|---|---|---|
| W3-01 | slice3: 1. akar mengarahkan tamu ke login | akar mengalihkan | - | tertangkap |  |
| W3-02v2 | slice3: 2. halaman anggota tidak dapat diakses tanpa login | penjagaan tanpa token di halaman (lolos tipe) | ditolak TypeScript | berlapis | berlapis: API menolak token kosong |
| W3-03 | slice3: 3. password salah ditolak dengan pesan generik | pesan generik | - | tertangkap |  |
| W3-05 | slice3: 6. login Beta tidak menampilkan satu pun nama Alpha | BFF tidak meng-cache data antar-pengguna | - | oleh tes lain | cache per-header; data basi setelah dicabut ditangkap tes pencabutan |
| W3-07 | slice3: 7. token tidak dapat dibaca JavaScript halaman | cookie session httpOnly | - | tertangkap |  |
| W3-08 | slice3: 8. keluar mencabut akses ke halaman anggota | keluar benar-benar keluar | - | oleh tes lain |  |
| W3-10 | slice3: 10. cookie palsu diperlakukan sebagai tidak berwenang | token ditolak -> ke login | - | tertangkap |  |
| W3-11 | slice3: 11. akun terkunci diberi tahu terkunci, bukan "password salah" | 429 berpesan sendiri | - | tertangkap | tes BARU (pesan akun terkunci) |
| W5-01 | slice5: 1. identitas lintas tenant diarahkan ke halaman pilih tenant | multi diarahkan memilih | - | tertangkap |  |
| W5-02 | slice5: 2. halaman anggota belum dapat dibuka sebelum tenant dipilih | tiket tidak menjadi session | - | oleh tes lain |  |
| W5-03 | slice5: 3. tiket tersimpan httpOnly, tidak terbaca JavaScript | cookie tiket httpOnly | - | tertangkap |  |
| W5-04 | slice5: 5. memilih Beta menghasilkan daftar anggota Beta | tombol mengirim tenant yang dipilih | - | tertangkap |  |
| W5-06 | slice5: 6. tiket habis setelah dipakai: kembali ke halaman pilih tidak | tiket dibuang setelah dipakai | LOLOS | tertangkap | tes ditulis ulang (tiket sendiri diuji) |
| W5-07 | slice5: 7. berpindah tenant dari halaman anggota | cookie diganti setelah pindah | - | tertangkap |  |
| W5-08 | slice5: 8. pemindah tenant hanya menawarkan tenant lain | pemindah menyaring tenant aktif | - | tertangkap |  |

---

# Audit mutasi D-01 (slice 8) - 2026-09-21

Enkripsi field diuji dengan cara yang sama seperti audit di atas, dengan satu
aturan tambahan: untuk mutasi pada kode kripto, database dibangun ulang dan
**di-seed ulang dengan kode yang sudah dimutasi**. Seed memakai modul kripto yang
sama dengan API; tanpa langkah ini, mutasi seperti "AAD tanpa record id" akan
tampak tertangkap hanya karena data lama ditulis dengan AAD yang berbeda - bukan
karena tesnya menjaga sifat itu.

## Hasil

31 mutasi (12 database/migrasi, 13 kode kripto dan API, 6 register), ditambah 2
mutasi untuk membuktikan penjaga berlapis:

- 29 tertangkap langsung oleh kasus sasarannya.
- **1 lubang tes (E9):** menghapus pengurutan nama setelah dekripsi tidak membuat
  tes mana pun gagal, karena data seed kebetulan tersimpan dalam urutan abjad -
  urutan database dan urutan yang diharapkan sama persis. Seed kini sengaja
  mengacak urutan dan UUID profil; mutasi yang sama tertangkap.
- **1 penjaga berlapis (E13):** blind index email kontak dipisahkan per tenant oleh
  dua hal - kunci per tenant DAN tenant_id di dalam input. Mematikan salah satunya
  tidak mengubah apa pun; mematikan keduanya tertangkap di API kasus 7 dan SQL
  slice 8 kasus 8, yang memperlihatkan akibat nyatanya: email yang sama di dua
  tenant menghasilkan nilai yang sama dan dapat dikorelasikan lintas tenant.

## Temuan di luar mutasi

Tiga kesalahan ditemukan dengan menjalankan jalur kegagalan secara sungguhan,
bukan dengan membaca kode:

1. **API tanpa KEK mencetak pesan yang benar di bawah stack trace merah Nest.**
   Error dilempar di dalam dependency injection, yang mencetaknya sendiri. KEK kini
   diperiksa sebelum Nest dibuat; keluarannya satu layar pesan, kode keluar 2.
2. **Seed membuat KEK baru di atas database yang sudah berisi kunci.** KEK baru itu
   yatim - tidak dapat membuka kunci lama - dan kegagalan baru terlihat satu langkah
   kemudian dengan pesan yang lebih membingungkan. Seed kini hanya membuat KEK bila
   `crypto_keys` kosong; selain itu berhenti dan menyebut `reset`.
3. **Tes browser pertama menuduh halaman anggota membocorkan email** yang ternyata
   berasal dari payload halaman login (petunjuk identitas demo) yang tertinggal di
   DOM setelah navigasi sisi klien. Tesnya terlalu lebar, bukan halamannya yang
   bocor; tes kini memuat ulang halaman anggota sebelum memeriksa HTML mentah.
   Buktinya ada di keluaran: `user@alpha.demo`, yang tidak ada di teks petunjuk,
   memang tidak ditemukan.

Satu lagi, kesalahan hitung saya: saya menghitung 79 kolom dan 78 entri register,
lalu menunggu tes register gagal. Database memang berisi 78 kolom; tesnya benar.
Kemampuan tes itu untuk gagal dibuktikan terpisah oleh mutasi R1, R2, dan D12.

## Tabel lengkap

| Mutasi | Sifat yang dimatikan | Kasus sasaran | Awal | Akhir | Catatan |
|---|---|---|---|---|---|
| D1 | kunci tenant hanya di context tenantnya | SQL slice8_test.sql #3 | - | tertangkap |  |
| D2 | plaintext ditolak di kolom ciphertext | SQL slice8_test.sql #5 | - | tertangkap |  |
| D3 | blind index 32 byte | SQL slice8_test.sql #6 | - | tertangkap |  |
| D4 | keunikan email per tenant, bukan global | SQL slice8_test.sql #8 | tertangkap | tertangkap | awalnya tertangkap lewat error SQL mentah; kasus 8 kini punya pesannya sendiri |
| D5 | email kontak unik dalam tenant | SQL slice8_test.sql #7 | - | tertangkap |  |
| D6 | kolom plaintext lama benar-benar hilang | SQL slice8_test.sql #4 | - | tertangkap |  |
| D7 | definer tidak membaca ciphertext email | SQL slice1_test.sql #14 | - | tertangkap |  |
| D8 | definer tidak membaca profil | SQL slice1_test.sql #14 | - | tertangkap |  |
| D9 | app_user tanpa akses langsung ke crypto_keys | SQL slice8_test.sql #1 | - | tertangkap |  |
| D10 | scope kunci platform/tenant ditegakkan | API slice8: 12 | - | tertangkap |  |
| D11 | lookup login mencocokkan blind index | SQL slice1_test.sql #8 | - | tertangkap |  |
| D12 | kolom baru tanpa register menggagalkan tes | API slice8: 13 | - | tertangkap |  |
| E1 | nonce acak per enkripsi | API slice8: 2 | - | tertangkap |  |
| E2 | AAD memuat record id | API slice8: 3 | - | tertangkap |  |
| E3 | tag GCM diverifikasi | API slice8: 5 | - | tertangkap |  |
| E4 | normalisasi email huruf kecil | API slice8: 6 | - | tertangkap |  |
| E5 | pseudonim audit terpisah dari blind index login | API slice8: 7 | - | tertangkap |  |
| E6 | pseudonim audit berkunci (bukan sha256) | API slice8: 7 | - | tertangkap |  |
| E7 | daftar anggota hanya email ber-masker | API slice8: 8 | - | tertangkap |  |
| E8 | baris rusak menggagalkan jawaban | API slice8: 9 | - | tertangkap |  |
| E9 | nama diurutkan setelah dekripsi | API slice8: 8 | LOLOS | tertangkap | LUBANG TES: seed kebetulan sudah urut abjad; seed diacak, lalu tertangkap |
| E10 | DEK terikat ke scope | API slice8: 10 | - | tertangkap |  |
| E11 | KEK salah -> KekMismatchError | API slice8: 11 | - | tertangkap |  |
| E12 | katalog kripto = register | API slice8: 16 | - | tertangkap |  |
| E13 | blind index kontak memuat tenant (lapis kedua) | API slice8: 7 | - | berlapis | lapis kedua; lihat dua baris berikut |
| R1 | kolom tanpa catatan | API slice8: 13 | - | tertangkap |  |
| R2 | catatan tanpa kolom | API slice8: 13 | - | tertangkap |  |
| R3 | atribut wajib hilang | API slice8: 14 | - | tertangkap |  |
| R4 | label tidak sesuai kelas | API slice8: 14 | - | tertangkap |  |
| R5 | field personal disimpan sebagai teks | API slice8: 15 | - | tertangkap |  |
| R6 | purpose kunci berbeda dari aplikasi | API slice8: 16 | - | tertangkap |  |
| E13-dek-saja | kunci blind index sama untuk semua tenant (lapis pertama saja) | API slice8: 7 | - | berlapis | lapis pertama saja dimatikan: tenant tetap di input -> masih terpisah |
| E13-keduanya | KEDUA lapis dimatikan: kunci sama + tenant dibuang dari input | API slice8: 7 | - | tertangkap | kedua lapis dimatikan -> tertangkap API #7 dan SQL slice 8 #8 |

---

# D-20 - batas waktu web -> API (2026-09-21)

Satu tes baru (`web/test/d20.spec.ts`), tujuh mutasi, semuanya tertangkap. Kontrol
hijau sebelum dan sesudah. Setiap mutasi dibangun ulang (`next build`) karena tes
menjalankan instance Next-nya sendiri dari build.

| # | Mutasi | Tertangkap oleh |
|---|---|---|
| M1 | `signal` dihapus dari `apiFetch` | bagian B (login menggantung) |
| M2 | login memanggil `fetch()` langsung | bagian A (pemindai sumber) |
| M3 | login: timeout dilaporkan sebagai "API mati" | bagian B (teks pesan) |
| M4 | pesan `lambat` hilang dari peta pesan login | bagian B |
| M5 | daftar anggota: timeout dilaporkan sebagai "API mati" | bagian C |
| M6 | daftar anggota memanggil `fetch()` langsung | bagian A |
| M7 | `isTimeout` selalu false | bagian B dan C |

Penjaga di dalam tes itu sendiri: proxy mencatat permintaan yang ditahannya, dan
tes memeriksa waktu tunggu minimal sama dengan batas waktu. Tanpa keduanya, API
yang menolak koneksi (bukan macet) juga menghasilkan halaman error yang cepat,
dan tes akan lulus karena alasan yang salah.

Batas: hanya dua dari tujuh panggilan diuji perilakunya (login dan daftar
anggota). Lima lainnya dijaga bagian A - mereka memakai `apiFetch` yang sama -
tapi penanganan pesan di masing-masing halaman tidak diuji tersendiri.

---

# Migrasi `api/` ke ESM (2026-09-21)

Pilihan pemilik proyek, sesuai Infrastructure SSOT sec.4 (`"type": "module"`).
Migrasi ini dikerjakan TERPISAH dari migrasi Prisma. Kalau tes merah, sebabnya
hanya satu perubahan.

Yang berubah:
- `package.json` diberi `"type": "module"`, dan `tsconfig` memakai
  `module`/`moduleResolution: NodeNext`.
- 23 berkas: impor lokal diberi akhiran `.js`.
- `src/main.ts`: `require.main === module` diganti perbandingan realpath.
- `test/slice8.test.ts`: `__dirname` diganti `import.meta.dirname`.
- `scripts/lint-guc.mjs`: `URL.pathname` diganti `fileURLToPath`. Di Windows,
  `.pathname` menghasilkan `/D:/...`.

Hasil di lingkungan pengembangan: 51 tes SQL, 65 API, dan 31 browser, semuanya
hijau di atas build `dist/` yang bersih. Jalur kegagalan KEK hilang tetap
menghasilkan pesan bersih dengan exit 2.

Tes baru `test/esm.test.ts` (3 kasus). Kesalahan titik masuk ESM membuat API
tidak start dan tidak mencetak apa pun. 62 tes API lama tidak akan menangkapnya,
karena semuanya memanggil `bootstrap()` langsung.

| # | Mutasi pada `dijalankanLangsung` | Tertangkap oleh |
|---|---|---|
| M1 | selalu `false` | kasus 1 dan 1b |
| M2 | selalu `true` | kasus 2 |
| M3 | bandingkan `import.meta.url` dengan `file://` + argv mentah | kasus 1b |

M3 adalah bentuk yang paling mungkin ditulis orang. Di Linux, mutasi ini lolos
dari kasus 1 karena `argv[1]` sudah absolut, sehingga kedua string kebetulan
sama. Di Windows perbandingan yang sama selalu gagal (`D:\...` lawan
`file:///D:/...`). Kasus 1b menjalankan API lewat junction supaya kedua bentuk
path berbeda di sistem operasi mana pun, dan kasus itu yang menangkap M3.

Batas: perbaikan `lint-guc.mjs` tidak dapat dibuktikan di Linux, karena di sana
`.pathname` dan `fileURLToPath` memberi hasil yang sama. Hanya menjalankan
`npm.cmd run lint:guc` di mesin target yang membuktikannya.

---

# D-12 - `api/` pindah ke Prisma (2026-09-22)

Syarat GO spike DEMO-0100 diterapkan ke `api/`. Hasil di lingkungan
pengembangan: SQL 51, API 70, browser 31, semuanya hijau. `db.ps1 reset` juga
diuji dari keadaan bersih (tanpa `src/generated` dan tanpa `dist`), lewat pwsh.

Tes baru `test/prisma.test.ts` (5 kasus) menjaga syarat GO yang tidak terlihat
dari luar. Delapan mutasi, semuanya tertangkap:

| # | Mutasi | Tertangkap oleh |
|---|---|---|
| U1 | `set_config` tenant session-level (`false`) | slice2 #11 |
| U2 | `statement_timeout` dihapus | prisma #1 |
| U3 | hasil bytea tidak diubah ke Buffer | prisma #2 |
| U4 | validasi UUID tenant dihapus | prisma #4 |
| U5 | `fn` menerima client global, bukan transaksi | 10 tes slice 2/5/8 |
| U6 | aturan lint `$transaction` dihapus | prisma #5 |
| U7 | aturan lint `new PrismaClient` dihapus | prisma #5 |
| U8 | nama kolom salah di `schema.prisma` | 13 tes, termasuk prisma #3 |

Catatan:
- U3 hanya tertangkap prisma #2. Kode kripto ternyata tetap berjalan dengan
  Uint8Array untuk operasi yang dipakai sekarang. Tanpa tes itu, konversi
  Buffer bisa hilang diam-diam, lalu baru gagal saat kode kripto memakai
  metode khusus Buffer.
- Versi pertama prisma #5 gagal karena berkas tes itu sendiri memuat teks
  aturan yang diperiksa lint. Lint benar; tesnya yang diperbaiki (memeriksa
  nomor baris, bukan nama aturan).

# D-09 - undangan anggota (2026-09-22)

Hasil di lingkungan pengembangan: **SQL 64, API 83, browser 35** (182 kasus),
semuanya hijau. Mesin target (Windows, PostgreSQL 18.6), 2026-09-22: SQL 64/64,
API 83/83 (19,0 detik, berurutan), browser 35/35 (24,3 detik). Tes browser dijalankan dua kali berturut-turut tanpa `reset`
dan tetap hijau (anggota tambahan dibersihkan).

Tes baru: `db/tests/slice9_test.sql` (13 kasus), `api/test/slice9.test.ts`
(13 kasus), `web/test/slice9.spec.ts` (4 kasus).

34 mutasi: **31 tertangkap, 2 ekuivalen, 1 tidak sah.**

| # | Mutasi | Hasil | Tertangkap oleh |
|---|---|---|---|
| S1 | F-16 tanpa cek `identity_hint` = blind index | tertangkap | SQL #7 |
| S2 | F-12 tanpa cek blind index identitas | tertangkap | SQL #8 |
| S3 | F-11 tanpa cek kedaluwarsa | tertangkap | SQL #6 |
| S4 | F-12 tanpa syarat `status = 'PENDING'` | ekuivalen | lihat catatan 1 |
| S5 | policy tenant mengizinkan `ACCEPTED` | tertangkap | SQL #2 (setelah diperketat, catatan 2) |
| S6 | `app_user` boleh membaca `token_hash` | tertangkap | SQL #1 |
| S7 | `app_user` boleh mengubah `is_owner` | tertangkap | SQL #12 |
| S8 | F-11 tanpa cek tenant ACTIVE | tertangkap | API #8b (baru, catatan 3) |
| S9 | F-16 tanpa cek identitas sudah ada | tertangkap | SQL #7 |
| S10 | F-12 menghidupkan membership non-aktif | tertangkap | SQL #13 (baru, catatan 3) |
| S11 | unique index PENDING dihapus | tidak sah | seed gagal (`ON CONFLICT` butuh index itu) |
| S12 | CHECK TTL dihapus | tertangkap | SQL #5 |
| S13 | policy update tenant tanpa `USING status = 'PENDING'` | tertangkap | SQL #10 |
| A1 | bukan owner boleh mengundang | tertangkap | API #2 |
| A2 | token dikembalikan ke pengundang | tertangkap | API #1 |
| A3 | password identitas lama tidak diperiksa | tertangkap | API #6, #6b |
| A4 | tanpa panjang minimal password | tertangkap | API #3 |
| A5 | tanpa rate limit di penerimaan | tertangkap | API #6b (baru) |
| A6 | undang ulang tanpa token baru | tertangkap | API #7 |
| A7 | email di `detail` audit | tertangkap | API #10 |
| A8 | `identity.created` membawa tenant | tertangkap | API #10 |
| A9 | daftar undangan tanpa masker | tertangkap | API #5 |
| A10 | `hasAccount` terbalik | tertangkap | API #3, #6 |
| A11 | regex token dilonggarkan | tertangkap | API #9 |
| A12 | nama berkas outbox memuat email | tertangkap | API #1 |
| A13 | `canInvite` selalu `true` | tertangkap | API #2 |
| A14 | cabut tanpa filter `PENDING` | ekuivalen | policy `tenant_update USING` (S13 menguji lapis itu) |
| C1 | pembersihan tes menghapus undangan seed | tertangkap | API #11 |
| C2 | pembersihan tes meninggalkan membership | tertangkap | API #11 |
| W1 | form undangan tampil untuk semua | tertangkap | browser #1 |
| W2 | halaman undangan tanpa `no-referrer` | tertangkap | browser #2 |
| W3 | token disalin ke field tersembunyi | tertangkap | browser #2 |
| W4 | tombol cabut tampil untuk semua status | tertangkap | browser #3 |
| W5 | sukses tidak menuju halaman "diterima" | tertangkap | browser #2 |

Catatan:
1. **S4 ekuivalen, dibuktikan.** `SELECT ... FOR UPDATE` di F-12 ikut
   menerapkan `USING` policy UPDATE (`definer_update`: `status = 'PENDING'`),
   jadi baris yang sudah diterima tidak terlihat walau syarat di WHERE dihapus.
   S4 digabung dengan pelonggaran policy itu tertangkap SQL #10 ("token undangan
   dipakai dua kali"). Dua lapis, masing-masing cukup sendiri.
2. **S5 awalnya LOLOS.** SQL #2 menerima `insufficient_privilege` ATAU
   `check_violation`, sehingga CHECK status/`accepted_membership_id` menutupi
   policy yang dilonggarkan. Kini hanya `insufficient_privilege` yang diterima.
3. **S8, S10, A5 awalnya tanpa tes.** Kasus baru: API #8b (tenant ditangguhkan
   lewat superuser, dipulihkan di `finally`), SQL #13 (membership SUSPENDED),
   API #6b (keranjang rate limit dipakai bersama login).

Temuan di luar mutasi:
- **Upsert undangan gagal 500 pada percobaan pertama.** `ON CONFLICT DO UPDATE
  SET token_hash = EXCLUDED.token_hash` butuh hak SELECT atas `token_hash`,
  yang sengaja tidak dimiliki `app_user`. Nilai kini diambil dari parameter.
  Grant per kolom yang ketat menangkap ini sebelum tes pertama lulus.
- **Tes API slice 9 awalnya mengotori tes lain.** Anggota tambahan membuat
  daftar anggota persis di slice 2/5/8 (API) dan 3/5/8 (browser) gagal pada
  run berikutnya, dan pada `node --test` paralel bisa gagal acak. Perbaikan:
  `api/scripts/test-cleanup.ts` sebelum dan sesudah suite, tes API berurutan
  (`--test-concurrency=1`), dan API #11 membuktikan pembersihannya.
- **Hasil mutasi pertama API tercemar.** API #10 membaca audit "10 menit
  terakhir", sehingga baris dari run mutasi sebelumnya ikut terbaca. Kini hanya
  sejak suite mulai; mutasi yang terdampak dijalankan ulang.

# Slice 10 - RBAC ditegakkan di endpoint (2026-09-22)

Hasil di lingkungan pengembangan: **SQL 77, API 93, browser 37** (207 kasus),
semuanya hijau; tes browser dua kali berturut-turut tanpa `reset`. Mesin target
(Windows, PostgreSQL 18.6), 2026-09-22: SQL 77/77 (dua kali), API 93/93 (24,2 detik),
browser 37/37 (26,4 detik).

Tes baru: `db/tests/slice10_test.sql` (13 kasus), `api/test/slice10.test.ts`
(10 kasus), `web/test/slice10.spec.ts` (2 kasus). Diubah: SQL slice 9 kasus 12
(dulu `is_owner`, kini default-deny anggota baru) dan browser slice 9 kasus 2
(anggota baru kini melihat "tidak punya akses", bukan daftar anggota).

32 mutasi: **28 tertangkap, 3 ekuivalen atau berlapis, 1 tidak sah.**

| # | Mutasi | Hasil | Tertangkap oleh |
|---|---|---|---|
| R2 | FK permission tanpa `scope` | tertangkap | SQL #2 |
| R3 | role sistem dapat diubah tenant | tertangkap | SQL #3 |
| R4 | `is_system` di-grant ke `app_user` | berlapis | catatan 1 |
| R5 | isi role sistem dapat ditambah | tertangkap | SQL #3 |
| R6 | isi role sistem dapat dihapus | tertangkap | SQL #3 |
| R7 | FK assignment ke role tanpa `tenant_id` | tertangkap | SQL #4 |
| R8 | unique assignment tanpa `WHERE ended_at IS NULL` | tertangkap | SQL #5 |
| R9 | unique assignment aktif dihapus | tidak sah | seed gagal (`ON CONFLICT` butuh index itu) |
| R10 | assignment yang berakhir dapat dihidupkan | tertangkap | SQL #5 |
| R11 | resolver mengabaikan status membership | tertangkap | SQL #10, API #6 |
| R12 | resolver mengabaikan arsip role | tertangkap | SQL #8, API #5 |
| R13 | resolver mengabaikan `ended_at` | tertangkap | SQL #9, API #4 |
| R14 | resolver tanpa `DISTINCT` | tertangkap | SQL #7 |
| R15 | view tanpa `security_invoker` | tertangkap | SQL #6, API #1–#6 |
| R16 | resolver tanpa filter `scope = 'TENANT'` | ekuivalen | catatan 2 |
| R18 | `is_owner` tidak dihapus | tertangkap | SQL slice 9 #12, API #7 |
| R19 | katalog dapat ditulis tenant | tertangkap | SQL #1 |
| R20 | role terbaca lintas tenant | tertangkap | SQL #4 |
| P1 | route tanpa deklarasi diizinkan | tertangkap | API #10 |
| P2 | route identitas tanpa session | tertangkap | API #1, #2, slice 5 #8 |
| P3 | guard tanpa cek `context_kind` | ekuivalen | catatan 3 |
| P4 | permission selalu lolos | tertangkap | API #2–#6 |
| P5 | penolakan tanpa audit | tertangkap | API #3 |
| P6 | audit memakai URL, bukan pola route | tertangkap | API #3 (diperkuat, catatan 4) |
| P7 | resolver tanpa filter membership | tertangkap | API #1–#4 |
| P8 | `canInvite` selalu `true` | tertangkap | API #4, slice 9 #2 |
| P9 | daftar undangan cukup `members.read` | tertangkap | slice 9 #2 |
| P10 | katalog tenant memuat permission platform | tertangkap | API #8 |
| P12 | controller anggota tanpa deklarasi | tertangkap | API #3–#6 dan lainnya |
| W1 | 403 diperlakukan seperti 401 | tertangkap | browser slice 10 #2, slice 9 #2 |
| W2 | halaman tanpa hak tanpa tombol keluar | tertangkap | browser slice 10 #2 |

Catatan:
1. **R4 berlapis, dibuktikan.** Tanpa grant kolom `is_system`, policy
   `tenant_insert` (`is_system = false`) tetap menolak dengan kode yang sama.
   R4 digabung dengan pelonggaran policy itu tertangkap SQL #3; pelonggaran policy
   saja juga lulus (grant kolom menahannya). Dua lapis, masing-masing cukup.
2. **R16 ekuivalen.** Permission platform tidak dapat masuk ke `role_permissions`
   karena FK `(code, scope)`; filter di view adalah lapis kedua yang tidak dapat
   diuji terpisah tanpa merusak FK, dan kerusakan FK sudah tertangkap SQL #2.
3. **P3 ekuivalen.** CHECK di `sessions` menjamin `context_kind = 'TENANT'` tepat
   bila `tenant_id` dan `membership_id` terisi, jadi pemeriksaan `tenant_id`
   saja sudah menolak session PLATFORM.
4. **P6 awalnya akan lolos.** Kasus 3 semula hanya memakai `/api/v1/members`, yang
   URL-nya sama dengan pola route-nya. Kasus itu ditambah penolakan pada
   `/invitations/:id/revoke` sebelum mutasi dijalankan.

Tiga mutasi awal (P2, P3, P5) tidak dapat dikompilasi TypeScript dan ditulis
ulang dalam bentuk yang lolos kompilasi; hasil di atas adalah versi yang lolos.

Temuan di luar mutasi:
- **Anggota yang ditangguhkan dulu masih dapat membaca daftar anggota.**
  `auth.find_session` tidak memeriksa status membership, dan sebelum slice 10
  tidak ada lapis lain. Kini resolver mengembalikan nol permission (API #6).
- **403 dulu mengeluarkan paksa pengguna.** Halaman anggota memperlakukan 403
  sebagai 401. Sebelum RBAC tidak pernah terjadi; sesudah RBAC akan terjadi pada
  setiap anggota tanpa `members.read`.

# Slice 11 - administrasi anggota dan role (2026-09-22)

Hasil di lingkungan pengembangan: **SQL 83, API 104, browser 37** (224 kasus),
semuanya hijau; tes browser dua kali berturut-turut tanpa `reset`. Mesin target
(Windows, PostgreSQL 18.6), 2026-09-22: SQL 83/83, API 104/104 (26,5 detik; kasus
7b 605 ms, lulus), browser 37/37 (27,1 detik).

Tes baru: `db/tests/slice11_test.sql` (6 kasus), `api/test/slice11.test.ts`
(11 kasus). Diubah: API slice 9 #2 (auditor kini boleh melihat undangan, sesuai
Demo Foundation §11.1a).

29 mutasi: **29 tertangkap** (dua setelah perbaikan, catatan 1–2).

| # | Mutasi | Tertangkap oleh |
|---|---|---|
| Q1 | role undangan dapat ditambah setelah diterima | SQL #3 |
| Q2 | role undangan dapat dihapus setelah diterima | SQL #3 |
| Q3 | F-12 memberi role yang diarsipkan | SQL #2 |
| Q4 | F-12 tanpa cegah duplikasi | SQL #4 |
| Q5 | F-12 tidak memberi role sama sekali | SQL #2, API #6, #7, #9 |
| Q6 | F-12 tanpa pemberi (`assigned_by`) | SQL #2 |
| Q7 | definer dapat membaca nama role | SQL #6 |
| Q8 | versi membership tanpa CHECK | SQL #5 |
| Q9 | tenant dapat mengubah `user_id` membership | SQL #5 |
| A1 | tanpa kunci advisory per tenant | API #7b (catatan 2) |
| A2 | isi role tanpa cek terkunci-dari-tenant | API #7 |
| A3 | arsip role tanpa cek terkunci-dari-tenant | API #7 |
| A4 | boleh mengubah role sendiri | API #6 |
| A5 | boleh menangguhkan diri sendiri | owner seed ikut tertangguh; suite slice 9 berikutnya gagal total (runner harness) |
| A6 | memberi role tanpa anti-eskalasi | API #6 |
| A7 | mencabut role tanpa anti-eskalasi | API #6 |
| A8 | isi role tanpa anti-eskalasi | API #6 |
| A9 | penangguhan tanpa cek hak pemegang | API #8 |
| A10 | role undangan tanpa anti-eskalasi | API #6 |
| A11 | role yang diarsipkan dapat diberikan | API #5 |
| A12 | ganti nama role tanpa versi | API #4 |
| A13 | isi role selalu menaikkan versi | API #4 |
| A14 | ganti role anggota tanpa versi | API #5 |
| A15 | penangguhan tanpa mencabut session | API #8, #10 |
| A16 | daftar undangan kembali `members.invite` | API slice 9 #2 |
| A17 | undang ulang tidak mengganti role undangan | API #9 (catatan 1) |
| A18 | filter email diabaikan | API #1 |
| A19 | `rolesSkipped` selalu 0 | API #9 |
| A20 | ganti role anggota tanpa audit | API #10 |

Catatan:
1. **A17 awalnya tanpa tes.** Kasus 9 ditambah: undangan ulang tanpa role setelah
   undangan dengan role menghasilkan anggota tanpa akses.
2. **A1 awalnya LOLOS.** Tidak ada tes yang menjalankan dua perubahan bersamaan.
   Kasus 7b baru: dua pemegang terakhir `members.assign_role` melepas hak itu dari
   role masing-masing secara bersamaan, lima putaran. Tanpa kunci, putaran ke-3
   menghasilkan 200/200 (tenant tanpa administrator). **Tes ini probabilistik**:
   ia bergantung pada kedua permintaan benar-benar tumpang tindih. Tertangkap
   pada 3 dari 3 run mutasi; tetap bisa lolos pada mesin yang sangat lambat atau
   sangat cepat [Medium confidence].
3. Satu mutasi (Q5) awalnya ditulis sebagai SQL yang tidak sah dan ditulis ulang.

Temuan di luar mutasi:
- **Penyimpangan dari SSOT yang saya buat sendiri:** `GET /invitations` memakai
  `members.invite` sejak slice 9, padahal Demo Foundation §11.1a menetapkan
  `members.read`. Tes slice 9 #2 malah mengunci penyimpangan itu. Diperbaiki.
- **Aturan terkunci-dari-tenant hanya dapat dilanggar lewat role milik pelaku
  sendiri.** Anti-eskalasi membuat pelaku yang mencabut hak pemegang lain selalu
  ikut memegang `members.assign_role`, jadi jalan yang tersisa adalah pelaku
  melepas hak dari role yang ia pegang sendiri. Itulah yang diuji kasus 7 dan 7b.
- `pg_advisory_xact_lock` mengembalikan `void`, yang tidak dapat dibaca Prisma;
  pemanggilannya dibungkus `count(*)`.

# Slice 11b - reaktivasi anggota (D-27) dan penanda owner (D-28) (2026-09-22)

Hasil di lingkungan pengembangan: **SQL 84, API 108, browser 37** (229 kasus),
semuanya hijau. Mesin target (Windows, PostgreSQL 18.6), 2026-09-22: SQL 84/84
(8 berkas, `reset`), API 108/108 (32,3 detik; suite 11b 2,5 detik; kasus 7b
949 ms, lulus), browser 37/37 (30,8 detik).

Perubahan: migrasi `0015_owner_guard.sql` (katalog + `owners.manage`);
`POST /members/:id/reactivate`. Tes baru: `api/test/slice11b.test.ts` (4 kasus),
SQL slice 1 #15 (setiap tabel RLS ENABLE + FORCE). Diubah: SQL slice 10 #1 dan #6,
API slice 10 #1 (katalog tenant 16; `owners.manage` hanya di role owner).

14 mutasi: **13 tertangkap, 1 lolos** (catatan 2).

| # | Mutasi | Tertangkap oleh |
|---|---|---|
| A1 | reaktivasi diri sendiri diizinkan | API 11b #2 |
| A2 | reaktivasi tanpa anti-eskalasi | API 11b #2, #3 |
| A3 | anti-eskalasi reaktivasi memakai `effective_permissions` | API 11b #2, #3 (catatan 1) |
| A4 | reaktivasi tanpa versi | API 11b #1 |
| A5 | reaktivasi tanpa syarat status SUSPENDED | API 11b #1 |
| A6 | reaktivasi tanpa audit | API 11b #4 |
| A7 | route reaktivasi memakai `members.read` | API 11b #2 |
| A8 | reaktivasi menghidupkan session lama | API 11b #1 |
| A9 | reaktivasi tanpa kunci advisory per tenant | **LOLOS** (catatan 2) |
| A10 | reaktivasi tidak menaikkan versi | API 11b #1 |
| S1 | katalog tanpa `owners.manage` | SQL 10 #1; API 10 #1, 11b #3 |
| S2 | bundel admin memuat `owners.manage` | SQL 10 #6; API 10 #1, 11b #3 |
| S3 | bundel owner tanpa `owners.manage` | SQL 10 #6; API 10 #1, 11b #3 |
| S4 | migrasi 0015 tidak memasang FORCE kembali | SQL 1 #15 (catatan 3) |

Catatan:
1. **Cacat yang tertangkap sebelum ditulis.** Pemeriksaan anti-eskalasi yang ada
   (slice 11) membaca view `effective_permissions`, yang hanya menghitung
   membership ACTIVE. Dipakai ulang apa adanya untuk reaktivasi, anggota yang
   ditangguhkan tampak tanpa hak, sehingga admin dapat mengaktifkan kembali owner.
   Pemeriksaannya kini membaca role yang dipegang; A3 membuktikan tesnya menangkap.
2. **A9 lolos, dan bukan mutasi setara.** Tanpa kunci, versi tetap melindungi
   perubahan role anggota yang bersamaan (versi naik), tetapi **tidak** melindungi
   perubahan isi role yang dipegang anggota itu: owner menambah `owners.manage` ke
   role X tepat di antara pemeriksaan dan UPDATE reaktivasi oleh admin. Jendelanya
   milidetik dan hanya teruji dengan tes probabilistik seperti 7b. Kunci
   dipertahankan; tesnya belum dibuat [Medium confidence bahwa balapan itu nyata;
   tidak dibuktikan].
3. **S4 awalnya LOLOS.** Tidak ada tes yang memeriksa FORCE RLS per tabel. Katalog
   `permissions` tidak punya policy tulis untuk siapa pun, jadi migrasi 0015
   melepas FORCE sesaat di dalam satu transaksi. Kasus SQL slice 1 #15 baru
   memeriksa semua tabel `public` dan `auth`.

Temuan di luar mutasi:
- Nama event audit di kode menyimpang dari Demo Foundation §15 sejak slice 10–11
  (`authz.denied`, `member.roles_replaced`, `role.permissions_replaced`). Dicatat
  sebagai D-29; belum diubah karena perlu keputusan arah.

# D-29 - nama event audit (2026-09-22)

Keputusan pemilik proyek: Demo Foundation §15 diamandemen mengikuti konvensi kode
(`<domain>.<aksi>` + `outcome` + reason code). Satu perubahan kode: pemakaian ulang
refresh token dicatat sebagai `auth.refresh.reuse_detected` (nama sendiri untuk alarm);
kegagalan refresh lain tetap `auth.refresh`.

Tes: API slice 7 #11 diperluas (reuse -> nama sendiri; refresh setelah keluar -> tetap
`auth.refresh`). Lingkungan pengembangan: API 108/108. Mesin target 2026-09-23: lulus
bersama D-30 (slice 7 #11 hijau).

2 mutasi, 2 tertangkap:

| # | Mutasi | Tertangkap oleh |
|---|---|---|
| E1 | reuse tetap dicatat `auth.refresh` | API slice 7 #11 |
| E2 | semua kegagalan refresh dicatat `reuse_detected` (alarm palsu) | API slice 7 #11 |

Temuan: cakupan D-29 yang saya catat semula (3 nama) keliru; perbedaannya ±14 nama
karena konvensinya berbeda, bukan salah ketik. Temuan kedua (D-30): F-14 di kode tidak
punya allowlist action yang diwajibkan Lampiran A, dan `auth.count_recent_failures`
tidak terdaftar di Lampiran A.

# D-30 - allowlist nama event audit (2026-09-23)

Keputusan pemilik proyek: allowlist ditegakkan **katalog di database** (`audit_event_types`,
migrasi 0016) dengan foreign key dari `audit_logs.event_type`, bukan daftar di badan F-14;
Lampiran A dicatat sesuai implementasi (F-14) dan penghitung kegagalan rate limiting
didaftarkan sebagai F-17.

Kenapa tabel, bukan daftar di fungsi: aturan yang dipasang di tabel berlaku untuk setiap
penulis audit, termasuk F-15 yang belum dibuat. Hari ini F-14 memang satu-satunya penulis
(app_user tidak punya INSERT ke `audit_logs`, SQL slice 6 #6).

Tes baru: SQL slice 6 #10 (nama asing ditolak; katalog 36 nama; tenant tidak dapat menulis
katalog), API slice 6 #11 (daftar di kode adalah subset katalog; tidak ada nama terpakai di
luar katalog). Lingkungan pengembangan: SQL 85, API 109, browser 37. Mesin target (Windows, PostgreSQL 18.6),
2026-09-23: SQL 85/85 (8 berkas, `reset`), API 109/109 (47,5 detik). Tes browser tidak
terdampak; hasil 37/37 pada 2026-09-22 tetap berlaku.

5 mutasi, 5 tertangkap:

| # | Mutasi | Tertangkap oleh |
|---|---|---|
| G1 | foreign key ke katalog dihapus | SQL 6 #10 |
| G2 | katalog kehilangan `member.reactivated` | SQL 6 #10; API 6 #11, 11b #4 |
| G3 | katalog dapat ditulis tenant | SQL 6 #10 |
| G4 | nama baru ditambah di kode tanpa migrasi | API 6 #11 |
| G5 | AuditService menulis nama di luar katalog | API slice 11 #10 |

Catatan:
1. G5 penting justru karena TIDAK terlihat saat runtime: `AuditService` sengaja menelan
   kegagalan menulis audit, jadi baris yang ditolak foreign key hanya hilang diam-diam.
   Yang menangkapnya adalah tes yang memeriksa keberadaan barisnya, bukan pengguna.
2. Dua mutasi pertama dijalankan ulang di database bersih setelah ditemukan hasil SQL-nya
   tercemar sisa mutasi sebelumnya (G3 mengubah migrasi, dan reset tidak dijalankan untuk
   mutasi kode). Kesimpulan di tabel ini berasal dari run yang bersih.

Temuan di luar mutasi (D-31): skema logis Demo Foundation §7.3 tidak sama dengan
implementasi untuk `permissions` dan `audit_logs` (nama kolom berbeda, bukan sekadar gaya).
Belum diputuskan apakah §7.3 harfiah atau konseptual.

# D-31 - skema logis Demo Foundation sec.7.3 (2026-09-23)

Keputusan pemilik proyek: sec.7.3 diselaraskan dengan implementasi. Tidak ada perubahan
kode, tes, maupun database - yang berubah hanya dokumen, jadi tidak ada mutasi untuk
bagian ini.

Cara memeriksanya, karena "sudah saya baca ulang" bukan bukti: kolom setiap blok sec.7.3
diambil ulang dari dokumen dan dibandingkan dengan `pg_attribute` database demo, termasuk
URUTAN kolomnya. Hasil: 17 tabel implementasi cocok seluruhnya, dan tidak ada tabel di
database yang tidak punya blok. Tiga tabel yang belum dibuat (`menus`, `menu_permissions`,
`tenant_notifications`) ditandai rencana dan sengaja tidak ikut dibandingkan.

Temuan: `crypto_keys` ada sejak slice 8 tetapi tidak pernah tercatat di inventory tabel
mana pun - tidak di Demo Foundation sec.7.1/7.2, tidak di Table Ownership Register
Infrastructure. Tabel penyimpan DEK terbungkus luput dari daftar tabel. Kini terdaftar.

Batas: perbandingan ini sekali jalan, bukan tes yang berjalan sendiri. Dokumen normatif
ada di luar folder `app/` dan tes di sini tidak membacanya (README induk sec.7 kriteria 1),
jadi penyimpangan berikutnya tidak akan tertangkap otomatis.

# Slice 12 - layar administrasi dan skenario demo (2026-09-23)

Hasil di lingkungan pengembangan: **SQL 85, API 109, browser 43** (237 kasus), semuanya
hijau; tes browser dua kali berturut-turut tanpa `reset`. Mesin target (Windows,
PostgreSQL 18.6, Chromium Playwright), 2026-09-23: browser 43/43 (1,8 menit), setelah
`npm.cmd run build`; SQL 85/85 dan API 109/109 tidak berubah dari verifikasi hari yang sama.

Cakupan (keputusan pemilik proyek): struktur halaman mengikuti Demo Foundation sec.12
(`/dashboard`, `/administration/{members,invitations,roles}`, `/403`; `/members` menjadi
alias yang dialihkan), aksi anggota dan role lengkap, konfirmasi berupa halaman server,
dan dua skenario demo diuji penuh beserta state layar.

Tes baru: `web/test/slice12.spec.ts` (6 kasus). Diubah: seluruh tes browser lama yang
menunjuk `/members` atau mengandaikan login mendarat di sana (slice 3, 5, 7, 8, 9, 10,
D-20).

11 mutasi: **11 tertangkap** (satu setelah perbaikan, catatan 1).

| # | Mutasi | Tertangkap oleh |
|---|---|---|
| W1 | navigasi tidak disaring permission | browser 12 #2, 10 #2 |
| W2 | penolakan aksi (403) dialihkan ke dasbor, bukan `/403` | browser 12 #6 (catatan 1) |
| W3 | konfirmasi memakai versi terbaru, bukan versi yang dilihat | browser 12 #3 |
| W4 | editor permission mengabaikan isi role saat ini | browser 12 #1 |
| W5 | filter email tidak diteruskan ke API | browser 12 #3 |
| W6 | tautan halaman berikutnya selalu offset 0 | browser 12 #2, #4 |
| W7 | 409 diperlakukan sebagai sukses | browser 12 #3 |
| W8 | versi tidak dikirim saat menyimpan nama | browser 12 #3 |
| W9 | konfirmasi tidak menyebut tenant aktif | browser 12 #3 |
| W10 | dasbor menawarkan semua tautan administrasi | browser 12 #2, 9 #2 |
| W11 | kerangka "memuat" dihapus | browser 12 #5 |

Catatan:
1. **W2 awalnya LOLOS.** Dua jalur berbeda menangani 403: kegagalan MEMUAT halaman dan
   penolakan AKSI. Seluruh tes hanya menyentuh yang pertama, jadi merusak yang kedua
   tidak membuat satu tes pun gagal. Kasus 6 baru: hak dicabut sementara formulir sudah
   terbuka, lalu dikirim - ditolak API, mendarat di `/403`, dan session TIDAK dibuang.
   Kasus ini juga yang paling dekat dengan kejadian nyata: tombol yang disembunyikan
   tidak menolong siapa pun yang formulirnya sudah terbuka lebih dulu.

Temuan di luar mutasi:
- **Tes yang bergantung pada urutan.** Skenario 2 semula memakai akun seed
  `user@alpha.demo`. Tes API sengaja mengunci akun itu lima menit (rate limiting),
  sehingga tes browser lulus atau gagal tergantung suite mana dijalankan lebih dulu.
  Pemerannya kini anggota yang dibuat lewat undangan dengan role seed `tenant_user`.
- **Pengalihan ke diri sendiri saat API macet.** Rancangan awal memantulkan setiap
  kegagalan ke halaman asal dengan pesan di query. Untuk kegagalan MEMUAT, itu berarti
  halaman yang API-nya macet mengalihkan ke dirinya sendiri tanpa henti. Kegagalan muat
  kini dirender di tempat; hanya 401 dan 403 yang mengalihkan.
- **Tes yang lulus karena pesan lama.** Pesan sukses dibaca dari query, jadi setelah satu
  keberhasilan, penyimpanan berikutnya yang GAGAL tetap menampilkan pesan sukses yang
  lama. Dua kasus diperbaiki untuk memeriksa keadaan (centang, versi), bukan pesan.
- **Tiga tes lama gagal karena balapan, bukan karena kode.** `login()` tidak menunggu
  server action selesai, dan navigasi berikutnya membatalkannya. Helper login di enam
  berkas kini menunggu pendaratan.

# D-26 - nama role bukan tempat data pribadi (2026-09-26)

Keputusan pemilik proyek: nama role tetap DP-0 dan dinyatakan **label konfigurasi**, dengan
kontrol nyata - bukan hanya catatan. Penegakannya di DATABASE (CHECK `roles_name_label_ck`,
migrasi 0017) plus pesan yang dapat dibaca di API dan peringatan di layar pembuatan role.

Yang ditolak sengaja sempit: alamat email, dan deretan 8 digit atau lebih (NIK, telepon,
NPWP). Regex tidak dapat membedakan nama orang dari nama jabatan; aturan yang menebak akan
menolak "Manajer Gudang Budi" sambil meloloskan hal lain, lalu orang belajar mengakalinya.

Hasil di lingkungan pengembangan: **SQL 86, API 109, browser 44** (239 kasus), semuanya
hijau; tes browser dua kali berturut-turut.

Mesin target (Windows, PostgreSQL 18.6, Chromium Playwright), 2026-09-26:
**SQL 86/86** (8 berkas lewat `db.ps1 reset` 2026-09-22.9; keluarannya memuat
`-> migrasi 0017_role_name_guard.sql` dan `SEMUA 7 KASUS SLICE 11 LULUS`),
**API 109/109** (59,8 detik), **browser 44/44** (1,5 menit), setelah `npm.cmd run build`.

Durasi API naik lagi: 32,3 detik (2026-09-22) -> 47,5 (2026-09-23) -> 59,8 (2026-09-26).
Belum ditelusuri. Kenaikannya searah dengan jumlah tes yang menunggu rate limit dan lock
advisory, tetapi itu dugaan, bukan pengukuran.

Tes baru: SQL slice 11 #7, browser slice 12 #7. Diperluas: API slice 11 #4.
Data Field Register: `roles.name` naik dari singkatan `DP-0` menjadi entri lengkap yang
menyebut aturan dan penegaknya.

7 mutasi: **7 tertangkap**.

| # | Mutasi | Tertangkap oleh |
|---|---|---|
| X1 | CHECK `roles_name_label_ck` dihapus | SQL 11 #7 |
| X2 | `create` tanpa pemeriksaan nama | API 11 #4 (500 dari CHECK, bukan 400) |
| X3 | `rename` tanpa pemeriksaan nama | API 11 #4 |
| X4 | ambang deret angka dilonggarkan 8 -> 20 digit | API 11 #4 |
| X5 | peringatan di layar dihapus | browser 12 #7 |
| X6 | kegagalan aksi tidak ditampilkan di formulir | browser 12 #3, #7 |
| X7 | kegagalan aksi dipantulkan ke alamat halaman (pola lama) | browser 12 #3, #7 |

## Cacat yang ditemukan tes ini, bukan oleh pengguna

Kasus 7 gagal pada percobaan pertama, dan bukan karena D-26: **setelah satu kegagalan aksi
yang dipantulkan ke alamat halaman (`?gagal=...`), pengiriman BERIKUTNYA dari formulir yang
sama tidak lagi berpindah halaman.** Datanya tersimpan di server - role benar-benar dibuat -
sementara layar tetap menampilkan pesan gagal yang lama. Bagi pengguna: "gagal", lalu ia
mengirim ulang dan membuat duplikat.

Rancangan awal slice 12 memakai pola itu di lima formulir. Perbaikannya memakai jalur yang
disediakan React: `useActionState` (`web/src/components/FormAksi.tsx`). Aksi MENGEMBALIKAN
hasilnya dan React merendernya di tempat; pengalihan tinggal untuk hal yang memang berpindah
tempat (401, 403, sukses yang membuka halaman lain). Formulirnya tetap bekerja tanpa
JavaScript. Mutasi X7 mengembalikan pola lama dan kasus 7 gagal - jadi cacat ini sekarang
punya penjaga.

Pesan tingkat halaman (dari pengalihan lintas halaman) kini memakai `data-testid`
`pesan-halaman`, terpisah dari pesan di dalam formulir (`pesan-sukses`/`pesan-gagal`),
supaya tes tidak pernah salah menunjuk yang mana.

## Cacat proses: berkas yang diubah skrip tidak ikut tersalin (2026-09-26)

Pemindahan `PESAN_GAGAL`/`PESAN_SUKSES` dari `web/src/lib/guard.ts` ke `web/src/lib/pesan.ts`
dikerjakan satu skrip penulis-ulang impor yang menyentuh LIMA berkas. Yang disalin ke mesin
target hanya empat; `web/src/app/dashboard/page.tsx` tertinggal. Akibatnya `npm.cmd run build`
di mesin target gagal:

```
Export PESAN_GAGAL doesn't exist in target module
> 2 | import { tokenHalaman, PESAN_GAGAL } from '@/lib/guard';
```

Tidak ada satu pun tes yang dapat menangkap ini, dan bukan karena tesnya kurang: di
lingkungan pengembangan berkasnya SUDAH benar, jadi `next build` di sana lulus. Yang salah
bukan kode, melainkan langkah penyalinan - dan tidak ada yang memeriksanya.

Aturan yang lahir dari ini: sebelum menyatakan "siap diuji di mesin target", bandingkan
hash setiap berkas sumber di kedua tempat, bukan hanya berkas yang diingat telah diubah.
Perbandingan itu menemukan satu berkas basi dalam satu kali jalan.

# Slice 13 - guard platform (DEMO-0311) dan notifikasi keamanan (DEMO-0313)

Cakupan (keputusan pemilik proyek): pemetaan hak platform berupa TABEL, bukan turunan
katalog; F-15 memakai schema `auth` dan Lampiran A diamandemen; superadmin pertama lewat
perintah bootstrap tersendiri; lapisan web minimal.

Hasil di lingkungan pengembangan: **SQL 94, API 116, browser 50** (260 kasus), semuanya
hijau. Mesin target (Windows, PostgreSQL 18.6, Chromium Playwright), 2026-09-26:
**SQL 94/94** (9 berkas; keluaran memuat `-> migrasi 0018_platform_roles.sql`,
`-> migrasi 0019_tenant_notifications.sql`, `-> bootstrap superadmin platform`, dan
`SEMUA 8 KASUS SLICE 13 LULUS`), **API 116/116** (34,8 detik), **browser 50/50** (1,7 menit). Verifikasi browser PERTAMA gagal;
sebabnya dicatat di bawah ('Tes slice 13 bergantung pada urutan suite').

Tes baru: `db/tests/slice13_test.sql` (8 kasus), `api/test/slice13.test.ts` (7 kasus),
`web/test/slice13.spec.ts` (6 kasus). Diubah: SQL slice 1 #12 dan #13, browser slice 5 #1.

**21 mutasi: 19 tertangkap.**

| # | Mutasi | Tertangkap oleh |
|---|---|---|
| P1 | policy baca `platform_role_assignments` dibuka untuk semua context | SQL 13 #1 |
| P2 | `app_context_kind()` jatuh ke `platform` saat GUC kosong | SQL 13 #1 |
| P3 | FORCE tidak dilepas: peta hak platform terisi nol baris tanpa error | SQL 13 #2 |
| P4 | F-07 tidak memeriksa role platform | SQL 13 #5 |
| P5 | F-07 tidak memeriksa membership aktif milik user | SQL 13 #5 |
| P6 | `app_user` diberi hak INSERT ke `tenant_notifications` | SQL 13 #7 |
| P7 | F-15 tanpa allowlist tipe | SQL 13 #7 |
| P8 | notifikasi yang sudah dibaca dapat dikembalikan | SQL 13 #8 |
| P9 | F-15 tanpa pemeriksaan keberadaan tenant | **LOLOS - ekuivalen** (FK menolak dengan kode yang sama) |
| P10 | F-07 memeriksa tenant juga, sehingga menutupi composite FK | SQL 1 #12 |
| A1 | guard platform tidak memeriksa `context_kind` | API 13 #4 |
| A3 | tidak ada larangan mengubah assignment diri sendiri | API 13 #5 |
| A4 | tidak ada penjaga superadmin terakhir | **LOLOS - tidak terjangkau** (lihat di bawah) |
| A5 | pelanggaran unik tidak dipetakan menjadi 409 | API 13 #5 |
| A6 | pelanggaran foreign key tidak dipetakan menjadi 400 | API 13 #5 |
| A7 | notifikasi keamanan cukup session sah, tanpa `audit.read` | API 13 #7 |
| A8 | menandai terbaca tanpa mencatat pembacanya | API 13 #7 |
| W1 | session platform tidak dialihkan dari kerangka tenant | browser 13 #1 |
| W2 | pemindah tenant tidak menyaring baris context platform | browser 13 #4 |
| W3 | menandai terbaca tanpa memuat ulang halaman di server | browser 13 #6 |
| W4 | pemilihan context platform ikut mengirim `tenantId` | browser 13 #4 |

## Tiga cacat yang ditemukan sebelum ada tesnya

1. **Pengisian peta hak platform menyisipkan NOL BARIS tanpa error.** `FORCE ROW LEVEL
   SECURITY` pada `permissions` berlaku juga bagi `app_owner`, dan satu-satunya policy di
   tabel itu ditujukan ke `app_user` - sehingga `INSERT ... SELECT` di migrasi 0018 membaca
   nol baris dan berhasil tanpa pesan apa pun. Ini pelajaran migrasi 0015 yang terulang
   dalam bentuk yang lebih berbahaya: diam, bukan gagal. Penjaganya sekarang bukan komentar
   melainkan kasus SQL 13 #2, yang menuntut isi tabel itu sama dengan katalog.
2. **F-15 tidak dapat menulis karena `RETURNING id` menuntut hak SELECT.** Diperbaiki dengan
   membuat id di dalam fungsi. Hasilnya lebih baik daripada rancangan awal: penulis
   notifikasi kini tidak punya hak baca apa pun atas tabel yang ia tulisi - pantas untuk
   tabel yang berisi kesaksian tentang platform.
3. **Pemeriksaan membership baru di F-07 MENUTUPI composite FK.** Kasus SQL slice 1 #12 ada
   untuk membuktikan bahwa composite FK `(tenant_id, membership_id)` menolak session yang
   menunjuk membership tenant lain. Dengan pemeriksaan baru yang juga menuntut
   `m.tenant_id = p_tenant_id`, penolakan datang dari fungsi, dan kasus 12 lulus karena
   alasan yang salah. Dipisah: fungsi menjaga batas ORANG, FK menjaga batas TENANT, dan
   kasus 12 kini memakai membership milik orang yang sama di tenant lain. Mutasi P10
   membuktikan pemisahan itu punya penjaga.

## Dua mutasi yang LOLOS

**A4 - penjaga superadmin terakhir.** Menghapusnya tidak menggagalkan tes apa pun, dan
sebabnya bukan tes yang kurang: dengan larangan mengubah assignment diri sendiri berlaku,
aturan itu tidak terjangkau lewat endpoint yang ada. Pelaku selalu seorang admin aktif
(kalau tidak, ia tidak punya permission untuk sampai ke sana) dan tidak boleh mencabut
dirinya sendiri, jadi sesudah pencabutan minimal satu admin - pelakunya - selalu tersisa.
Penjaganya tetap dipasang sebagai lapis kedua untuk saat penangguhan identitas global atau
role platform kedua masuk, karena keduanya membuka jalan yang tidak lewat larangan itu.
Yang tidak saya lakukan: menulis tes yang seolah-olah mengujinya.

**P9 - F-15 tanpa pemeriksaan keberadaan tenant.** Ekuivalen: foreign key
`tenant_notifications.tenant_id -> tenants` menolak hal yang sama dengan kode error yang
sama (`23503`).

## Temuan lain

**`sqlState()` hanya memeriksa empat jalur tertentu.** Bentuk error pelanggaran foreign key
dari INSERT di context platform tidak ada di daftar itu, sehingga 400 yang seharusnya
menjadi 500. Kini fungsi itu menelusuri RANTAI error dan hanya menerima nilai berbentuk
SQLSTATE (lima karakter, diawali angka), sehingga kode Prisma sendiri (`P2010`) tidak
pernah tertukar. Bentuk objek error adalah urusan pustaka dan berubah antar versi; yang
tetap adalah kodenya.

**Tes browser #4 awalnya LULUS walau mutasi W2 dipasang.** Saya hampir mencatatnya sebagai
mutasi ekuivalen. Ternyata `toHaveURL` sudah lulus saat alamat berubah, sementara DOM
halaman lama masih terpasang - dan halaman lama memang tidak punya tombol pindah, jadi
hitungan nol lulus tanpa memeriksa apa pun. Kelas kekeliruan yang sama dengan temuan slice
12. Kini elemen dasbor ditunggu lebih dulu. Pelajarannya: sebelum menyimpulkan sebuah
mutasi ekuivalen, periksa apakah tesnya benar-benar melihat keadaan yang dimaksud.

**Tes slice 13 bergantung pada urutan suite - temuan slice 12 yang saya ulangi.**
Kedua tes slice 13 memakai `user@alpha.demo` sebagai anggota tanpa `audit.read`, karena itu
satu-satunya akun seed yang memenuhi syarat. Akun itu juga akun yang SENGAJA dikunci lima
menit oleh tes rate limiting slice 6. Akibatnya:

- tes browser slice 13 #4 dan #6 GAGAL di mesin target dengan `login?error=terkunci`, karena
  di sana tes API berjalan tepat sebelum tes browser;
- tes API slice 13 #7 lulus di mesin target hanya karena `slice13` berjalan sebelum `slice6`
  menurut urutan abjad berkas - kerapuhan yang sama, yang tinggal menunggu nama berkas berubah.

Di lingkungan pengembangan keduanya lulus karena saya tidak pernah menjalankan tes API tepat
sebelum tes browser. Ketergantungan pada urutan suite dengan akun yang sama persis sudah
tercatat sebagai temuan slice 12; saya membacanya, menuliskannya ulang di dokumen status, lalu
mengulanginya.

Perbaikan (bukan menunggu lima menit): calon admin platform menjadi `admin@beta.demo` - satu
tenant, sehingga pemeriksaan "tidak ada tombol pindah tenant" tetap punya arti - dan anggota
tanpa `audit.read` DIBUAT per run lewat undangan, seperti yang sudah dilakukan slice 11b dan 12.

Cara verifikasi ikut diperbaiki: tes API dijalankan LALU LANGSUNG tes browser, meniru urutan
mesin target. Tanpa urutan itu, kelas kegagalan ini tidak dapat dilihat di lingkungan
pengembangan sama sekali.

**Balapan di tes slice 12 #2 yang ikut ketemu.** Pada run yang sama, kasus itu gagal di mesin
target: sesudah role dicabut lewat layar, pengguna masih dapat membuka daftar anggota. Bukan
cacat aplikasi - cacat tesnya:

```ts
await page.uncheck(`[data-testid=role-${kode}]`);
await page.click('[data-testid=simpan-role]');
await expect(...).not.toBeChecked();   // lulus SEKETIKA
await user.goto('/administration/members');
```

`not.toBeChecked()` lulus tanpa menunggu apa pun, karena klik `uncheck()` sudah mengubah DOM di
browser. Jadi baris berikutnya kadang membaca hak yang belum dicabut. Yang diperiksa adalah
keadaan optimistik di browser, bukan keadaan server - padahal komentar di tes itu justru
mengklaim "keadaan centang yang diperiksa, bukan pesan sukses". Diperbaiki dengan `page.reload()`
sebelum memeriksa centang, sehingga yang dibaca adalah render server.

Ini kekeliruan yang sama untuk KETIGA kalinya dalam satu slice: menunggu alamat atau DOM alih-alih
keadaan server (browser 13 #4, slice 12 #2, dan pesan sukses yang hilang bersama barisnya di
halaman notifikasi). Aturan tes yang lahir darinya ada di bawah.

**Durasi API: koreksi atas catatan saya sendiri.** Di bagian D-26 saya menandai durasi tes
API "naik terus" (32,3 -> 47,5 -> 59,8 detik) dan menyebutnya layak ditelusuri. Pada
2026-09-26 dengan tujuh kasus LEBIH BANYAK angkanya 42,0 detik. Tren itu berbalik, jadi
dugaan bahwa penyebabnya jumlah tes yang menunggu rate limit tidak didukung angka; lebih
mungkin keadaan mesin saat pengukuran. Dugaan yang tidak diukur memang begitu nasibnya.

## Aturan tes yang lahir dari slice 13

1. **Satu penjaga tidak boleh menutupi penjaga lain.** Bila pemeriksaan baru di aplikasi
   menolak hal yang selama ini dibuktikan constraint database, kasus lama lulus karena alasan
   yang salah. Pisahkan apa yang dijaga tiap lapisan, dan uji masing-masing.
2. **Tes menunggu keadaan SERVER, bukan alamat halaman atau DOM lokal.** `toHaveURL` lulus saat
   alamat berubah sementara DOM halaman lama masih terpasang; `not.toBeChecked()` lulus karena
   klik sudah mengubah DOM sebelum penyimpanan sampai ke server. Tunggu elemen halaman baru,
   atau muat ulang, sebelum menyimpulkan apa pun.
3. **Sebelum menyebut sebuah mutasi "ekuivalen", periksa apakah tesnya benar-benar melihat
   keadaan yang dimaksud.** Mutasi W2 tampak ekuivalen; ternyata tesnya yang salah urutan.
4. **Tes tidak boleh memakai akun yang dikunci tes lain.** Di seed hanya `user@alpha.demo` yang
   tanpa `audit.read`, dan justru akun itu yang dikunci tes rate limiting. Anggota untuk peran
   semacam itu dibuat per run lewat undangan.
5. **Verifikasi dijalankan dalam urutan yang sama dengan mesin target**: tes API lalu LANGSUNG
   tes browser. Tanpa itu, kelas kegagalan nomor 4 tidak terlihat sama sekali di lingkungan
   pengembangan.

## Batas yang perlu dikatakan terus terang

`tenant_notifications` lengkap dengan RLS, endpoint, dan layarnya, tetapi tidak ada alur
produk yang memanggil F-15 sampai support session dibuat (DEMO-0312). Yang memanggilnya
hanya tes. Yang nyata di slice ini adalah skema, penjaga, dan isolasi tenant.

## Slice 14 - support session break-glass (DEMO-0312), 2026-09-27

**35 mutasi dijalankan: 32 tertangkap, 3 lolos dan dijelaskan.** Rinciannya: 14 di lapisan
database (12 tertangkap), 17 di API (16 tertangkap), 4 di web (4 tertangkap).

### Satu lubang yang ditemukan BUKAN oleh tes

Saat menulis guard, terlihat bahwa `POST /notifications/security/:id/read` memerlukan
`audit.read` - sebuah permission BACA yang dipakai route TULIS. Karena `audit.read` ada di
`SUPPORT_READ_SET`, sesi support akan dapat menandai notifikasi "sesi support dimulai" sebagai
sudah dibaca: yang diperingatkan menghapus peringatan tentang dirinya sendiri dari layar tenant.
Padahal transparansi itulah salah satu alasan break-glass dapat diterima (ADR-003 sec.2.2 butir 7).

Perbaikannya bukan mengeluarkan `audit.read` dari himpunan baca - support memang perlu membaca
audit untuk menjawab "kenapa aksi ini gagal" - melainkan memeriksa METODE: di dalam sesi support,
permintaan yang mengubah keadaan hanya lolos bila permissionnya ada di `SUPPORT_MUTATION_SET`
(hanya `members.update_profile`). Dijaga tes API slice 14 #4 dan browser #3; mutasi A1
membalik pemeriksaan itu dan keduanya gagal.

Pelajarannya: **himpunan permission tidak cukup untuk memutuskan hak menulis.** Yang menentukan
adalah pasangan (metode, permission), karena permission baca yang dipakai route tulis akan
menyelundupkan hak tulis tanpa satu pun daftar berubah.

### Tiga tes yang lulus karena alasan yang SALAH, ditemukan uji mutasi

1. **S4/S5 (CHECK durasi dan CHECK alasan READ_WRITE).** Kedua kasus memakai identitas yang
   sudah memegang sesi aktif, sehingga percobaan insert ditolak index unik LEBIH DULU. Dengan
   CHECK-nya dilonggarkan, kasusnya tetap "gagal" - tetapi karena `unique_violation`, bukan
   karena penjaga yang diujinya. Diperbaiki: percobaan yang harus ditolak CHECK memakai
   identitas keempat yang tidak memegang sesi apa pun.
2. **S7 (hak UPDATE atas `expires_at`).** Kasusnya menuntut `insufficient_privilege` saat mencoba
   memperpanjang sesi. Ternyata pelanggaran RLS dan hak kolom yang kurang memakai SQLSTATE yang
   SAMA (42501), jadi dengan grant diberikan kasusnya tetap lulus - yang menolak adalah policy,
   bukan hak kolom. Diperbaiki: hak kolom diperiksa langsung di `information_schema`, lalu
   perilakunya diperiksa terpisah.
3. **W4 "tertangkap" padahal PostgreSQL mati.** Mutasi yang menyembunyikan tabel sesi di layar
   tenant dilaporkan tertangkap oleh kasus browser #1 - kasus yang tidak menyentuh tabel itu
   sama sekali. Sebabnya database sedang mati, sehingga SEMUA kasus gagal. Dijalankan ulang
   setelah database hidup, mutasi itu tertangkap kasus #6, yang memang mengujinya.
   **Aturan baru:** sebuah mutasi baru dianggap tertangkap bila yang menggagalkannya adalah
   kasus yang memang menjaga perilaku itu. "Ada yang gagal" bukan hasil uji mutasi.

### Tiga mutasi yang LOLOS, dicatat apa adanya

- **A6** (`SET TRANSACTION READ ONLY` dihapus dari unit of work). Tidak ada tes API yang gagal,
  dan itu benar: READ_ONLY adalah lapis KEDUA. Lapis pertama - guard - sudah menolak setiap
  permintaan yang mengubah keadaan dalam sesi READ_ONLY, jadi jalur yang dijaga lapis kedua
  tidak terjangkau lewat API mana pun. Mekanismenya sendiri dibuktikan hidup oleh kasus SQL
  slice 14 #11 (mutasi ditolak `read_only_sql_transaction` di transaksi READ ONLY). Yang tidak
  terbukti lewat tes adalah bahwa unit of work MEMAKAInya - dan itu dikatakan apa adanya, bukan
  disembunyikan. Lapis ini ada untuk bug aplikasi di masa depan (ADR-001 sec.3.10).
- **S11** (filter `status = 'ACTIVE'` dihapus dari F-19) dan **S13** (filter yang sama dihapus
  dari policy `definer_update`). Masing-masing lolos karena yang lain masih menjaganya:
  keduanya menolak hal yang sama. Dibuktikan dengan menjalankan KEDUANYA sekaligus - lalu
  kasus SQL slice 14 #9 gagal ("F-19 mengakhiri sesi yang sama dua kali"). Redundansi yang
  disengaja, bukan penjaga yang tidak diuji.

### Yang dijaga lapisan mana

| Aturan ADR-003 | Dijaga | Kasus |
|---|---|---|
| durasi <= 60 menit | CHECK `support_sessions_duration_ck` | SQL #4 (S4) |
| READ_WRITE hanya untuk satu reason_code | CHECK `support_sessions_write_reason_ck` | SQL #5 (S5) |
| READ_WRITE menuntut permission tersendiri | service + tabel `platform_role_permissions` | API #10 (A10) |
| satu sesi aktif per superadmin | index unik parsial | SQL #6 (S6), API #7 |
| tidak dapat diperpanjang | hak kolom (tanpa grant UPDATE) | SQL #7 (S7) |
| sesi berakhir tidak dapat dihidupkan | policy UPDATE satu arah | SQL #7 (S8) |
| sesi dicabut/kedaluwarsa langsung ditolak | F-18 dipanggil SETIAP request | SQL #8 (S3), API #6/#7 (A3) |
| logout PLATFORM mengakhiri sesi support | F-19 + session platform diperiksa guard | API #8 (A13), API #11 (A4) |
| satu tenant saja | RLS, bukan kode | SQL #1, dan uow menolak tenant lain (A5) |
| masking DP-1 | service anggota | API #3, browser #2 (A7) |
| tenant melihat sesinya | policy per context | SQL #3 (S1, S9, S12), API #1/#3, browser #6 (W4) |


### Verifikasi target slice 14: satu cacat yang HANYA muncul di sana

Jalur pertama di mesin target: SQL 105/105 hijau, API **116 lulus 11 gagal**. Kesebelas
kegagalan adalah turunan dari kasus 1, dan kasus 1 gagal pada satu baris:

```
assert.ok(c.exp * 1000 <= new Date(row.expires_at).getTime() + 1000)
```

Umur token support dihitung aplikasi dari `expires_at` hasil query mentah. Di lingkungan
pengembangan benar; di mesin target token untuk sesi 30 menit ternyata berumur 450 menit.

**Sebabnya bukan zona waktu proses Node, melainkan zona waktu SERVER database.** Diukur di
container setelah `ALTER DATABASE saas_demo SET TimeZone='Asia/Jakarta'` - yaitu keadaan yang
sama dengan mesin target:

| Pembaca | `now() + interval '30 minutes'` | Selisih dari sekarang |
|---|---|---|
| node-postgres | `2026-09-27T05:45:28Z` | **30 menit** |
| Prisma (query mentah) | `2026-09-27T12:45:29Z` | **450 menit** |

Prisma membaca `timestamptz` sebagai jam DINDING sesi database, lalu melabelinya UTC. Dengan
TimeZone server UTC keduanya sama - tidak ada gejala. Dengan TimeZone +07, setiap nilai waktu
yang dibaca lewat query mentah bergeser tujuh jam.

Lingkupnya lebih luas daripada slice 14: setiap tanggal yang ditampilkan web lewat jalur ini
(`granted_at` admin platform, `created_at` notifikasi, `expires_at` undangan di berkas outbox)
sudah bergeser tujuh jam di mesin target **sejak slice 8**, dan tidak satu tes pun menangkapnya
karena tidak ada tes yang membandingkan tanggal yang ditampilkan dengan waktu sungguhan. Yang
membuatnya akhirnya terlihat adalah slice 14: kode pertama yang MENGHITUNG dengan nilai itu.

**Perbaikannya di satu tempat, bukan di tiap pemanggil:** unit of work memaksa
`set_config('TimeZone','UTC', true)` sebagai bagian statement pertama setiap transaksi. Seluruh
jalur karena itu benar sekali untuk selamanya, dan jawabannya sama di mesin mana pun. `lint:guc`
kini menolak `set_config('TimeZone'` di berkas lain - dua pendapat tentang arti sebuah waktu
adalah cara cacat ini kembali.

**Lapis kedua:** sisa umur sesi dihitung DATABASE dan dikembalikan sebagai bilangan bulat detik
(F-18 `remaining_seconds`, dan `RETURNING` saat sesi dibuka). Durasi tidak lagi pernah
diturunkan dari teks waktu yang perlu ditafsirkan siapa pun - termasuk oleh banner di layar,
yang sekarang memakai angka itu apa adanya.

**Penjaganya (diuji mutasi):**

- **T1** pematokan TimeZone dihapus -> `prisma.test.ts` #6 gagal ("unit of work memaksa TimeZone UTC").
- **T3** pematokan dihapus DAN umur token dihitung dari dua tanggal (keadaan asli mesin target)
  -> slice 14 #1 gagal, kali ini dengan pesan yang menyebut angkanya.
- **T2** hanya umur token dikembalikan ke dua tanggal: LOLOS, dan itu benar - dengan TimeZone
  dipatok, pengurangan dua tanggal memang sudah benar. Lapis kedua, bukan penjaga yang tak diuji.

**Dan dua cacat tes saya sendiri yang ikut ketemu saat menjalankan ulang seluruh suite:**

1. **Pembersihan tes API tidak dapat menangkap barisnya sendiri.** Kasus 6 sengaja MENUAKAN baris
   (`started_at` digeser dua jam ke belakang), sementara pembersihannya menyaring
   `started_at >= mulai` - jadi justru baris itu tertinggal. Empat baris menumpuk dan
   menggagalkan tes SQL di jalur berikutnya. Kini seluruh tabel dibersihkan DAN kebersihannya
   dibuktikan (`count(*) = 0`), mengikuti aturan slice 9 yang saya langgar lagi.
2. **Tes SQL menghitung seluruh tabel bersama.** Kasus 3 menuntut "tenant Alpha melihat 2 sesi" -
   angka mutlak atas tabel yang dipakai suite lain. Kini disaring pada session platform yang
   dibuat transaksi itu sendiri. Aturan lamanya sudah tertulis sejak audit slice 1-7: tes yang
   membaca tabel bersama wajib menyaring pada nilai miliknya sendiri.

**Aturan baru yang lahir dari sini:** lingkungan pengembangan harus MENANGGUNG bahaya yang sama
dengan mesin target di tempat yang murah. Database di container sejak sekarang berjalan dengan
`TimeZone='Asia/Jakarta'`, bukan UTC - persis seperti mesin target. Cacat kelas ini tidak dapat
ditemukan oleh tes yang lingkungannya lebih bersih daripada tempat kodenya akan berjalan.

**Jalur kedua verifikasi target (2026-09-27): hijau penuh.** SQL 105/105 (10 berkas), API 129/129
(36,5 detik, termasuk dua penjaga zona waktu yang baru), browser 56/56 (2,5 menit). Cacat D-40
karena itu terbukti benar-benar tertutup di mesin tempat ia muncul, bukan hanya di tempat ia
direproduksi.

Yang TETAP belum punya penjaga, dan tidak boleh dilupakan: **tidak ada satu pun tes yang
membandingkan tanggal yang DITAMPILKAN di layar dengan waktu sungguhan**, di lapisan mana pun.
Itulah sebabnya pergeseran tujuh jam bertahan sejak slice 8 tanpa terlihat. Perbaikan D-40 menutup
sumbernya di satu tempat (unit of work), tetapi tidak menambah mata yang mengawasi tampilan.

## Bagian A DEMO-0409 - menu sebagai DATA (DEMO-0401/0402/0403/0405), 2026-09-28

Yang dikerjakan: navigasi berhenti menjadi daftar tetap di kode React dan menjadi data yang
dijawab backend. Tabel `menus` dan `menu_permissions` (migrasi 0021, dengan `owner_key`
generated, `context_kind`, trigger penjaga hierarki, policy per context, dan seed 8 menu +
6 pemetaan), endpoint `GET /api/v1/me/menu`, dan `NAV` di `Kerangka.tsx` DIHAPUS - bukan
disimpan sebagai cadangan. Cadangan akan menawarkan halaman yang mungkin sudah tidak boleh
dibuka, dan cadangan yang tidak pernah dipakai tidak pernah ikut diuji.

### Satu lubang yang ditemukan tes, bukan pengguna: penjaga hierarki yang BUTA

Trigger anti-siklus versi pertama menelusuri rantai induk dengan
`WHERE m.owner_key = NEW.owner_key`. Di dalam trigger BEFORE nilai itu **NULL**:

> `owner_key` adalah kolom GENERATED STORED, dan PostgreSQL menghitungnya SESUDAH trigger
> BEFORE berjalan.

Akibatnya `WHERE owner_key = NULL` mengembalikan nol baris, penelusuran berhenti seketika, dan
**siklus lolos tanpa pesan apa pun**. Penjaga yang buta lebih berbahaya daripada tidak ada
penjaga, karena ia terlihat ada. Ditemukan kasus API 6, yang memang dibuat untuk menuntut
penolakan - bukan untuk memeriksa bahwa fungsinya "ada". Perbaikannya menghitung ulang pemilik
dari `NEW.tenant_id`, dan sebabnya ditulis di badan fungsi supaya tidak diperbaiki balik.

### Dua cacat pada tes saya sendiri

1. **Tes ini menghapus undangan SEED.** Versi pertama kasus 2 membuat undangan yang tidak
   pernah dipakai, lalu merapikannya dengan `DELETE FROM user_invitations WHERE status =
   'PENDING'` - termasuk undangan seed, sehingga slice 9 #11 gagal. Data seed bukan milik tes
   mana pun. Undangannya dihapus dari kasus itu seluruhnya; yang dibutuhkan hanyalah session
   tanpa hak, dan itu diperoleh dengan mencabut role lalu memulihkannya.
2. **M7 "tertangkap" oleh pernyataan yang salah.** Mutasi memberi `app_user` hak tulis pada
   `menus`; tes gagal - tetapi karena RLS menolak INSERT, dengan SQLSTATE `42501` yang SAMA
   dengan tidak adanya grant. Artinya tes itu tidak membuktikan apa pun tentang grant. Kini
   kasus SQL 4 memeriksa `role_table_grants` secara langsung dan berbunyi
   "app_user punya hak {DELETE,INSERT,SELECT,UPDATE} pada tabel menu".

### Uji mutasi: 19 mutasi, 19 tertangkap - tetapi dua di antaranya baru setelah tes ditambah

Database (migrasi 0021), seluruhnya dipasang lalu dipulihkan lewat `psql` sebagai `app_owner`:

| # | Mutasi | Tertangkap oleh |
|---|---|---|
| M1 | policy `platform_read` tanpa syarat `app_context_kind()` | SQL 15 #1 (navigasi tenant berisi menu platform) |
| M2 | policy `tenant_read` tanpa syarat `context_kind = 'TENANT'` | SQL 15 #1 |
| M3 | policy `tenant_read` tanpa batas tenant | API 15 #5 (menu tenant lain terlihat) |
| M4 | CHECK `permission_scope = context_kind` dihapus | API 15 #6 |
| M5 | CHECK allowlist route dihapus | API 15 #6 |
| M6 | trigger memakai `NEW.owner_key` (penjaga buta, cacat aslinya) | API 15 #6 |
| M7 | `app_user` diberi INSERT/UPDATE/DELETE pada `menus` | SQL 15 #4 |
| M8 | composite FK induk `(owner_key, parent_id)` dihapus | API 15 #6 |

Aplikasi dan web:

| # | Mutasi | Tertangkap oleh |
|---|---|---|
| R1 | deny-by-default menjadi allow-by-default | API 15 #10 (SETELAH kasus itu ditambah - lihat di bawah) |
| R2 | `match_mode = ALL` diperlakukan seperti `ANY` | API 15 #7 |
| R3 | pemangkasan grup tanpa anak dihapus | API 15 #2 |
| R4 | `ORDER BY sort_order, code` dihapus | API 15 #10 (SETELAH kasus itu ditambah; semula LOLOS) |
| R5 | saringan `is_active = true` dihapus | API 15 #7 |
| R6 | DTO membocorkan kode permission | API 15 #1 |
| R7 | `/me/menu` dijaga `RequirePermission('menus.read')` | API 15 #2 |
| R8 | sesi support memakai permission membership, bukan himpunan tetap | API 15 #9 |
| W1 | kerangka mengabaikan menu dari API | browser 15 #1, #2 |
| W2 | kartu dasbor menawarkan dirinya sendiri | browser 15 #2, #3 |
| W3 | grup dirender sebagai tautan, bukan label | browser 15 #1 |

**Dua temuan yang lebih penting daripada angka 19/19:**

- **R4 LOLOS seluruh suite.** Menghapus `ORDER BY` tidak menggagalkan satu kasus pun, termasuk
  kasus 1 yang judulnya memuat kata "terurut": urutan baris seed kebetulan sama dengan urutan
  `sort_order`, jadi yang lulus adalah kebetulan, bukan perilaku. Sekarang kasus 10 menyisipkan
  menu `sort_order = 5` PALING AKHIR dan menuntutnya muncul PERTAMA.
- **R1 tertangkap oleh kasus yang salah.** Deny-by-default hanya gagal di kasus 9 - dan itu pun
  karena kasus 6 meninggalkan menu ber-route tanpa pemetaan di tabel bersama. Seed tidak punya
  menu semacam itu (satu-satunya menu tak berpemetaan adalah grup, yang dipangkas, dan dasbor,
  yang ditandai terbuka), sehingga aturan terpenting Demo Foundation sec.10.2 sesungguhnya
  **tidak diuji sama sekali**. Kasus 10 menyatakannya sendiri, dan kasus 6 kini membersihkan
  barisnya sendiri - berlaku aturan yang sama dengan slice 9 dan slice 14: keadaan bersama tidak
  boleh menyeberang antar kasus.

Keduanya adalah bentuk kegagalan yang sama dengan pelajaran slice 14 (W4) dan M7 di atas: tes
yang lulus, atau mutasi yang tertangkap, **karena sebab yang bukan miliknya**. Uji mutasi
menemukannya hanya kalau yang diperiksa bukan sekadar "ada yang merah", melainkan "yang merah
adalah kasus yang memang memiliki perilaku itu".

### Aturan D-40 yang menguap, dan kini ditegakkan skrip

Pelajaran slice 14 berbunyi: lingkungan pengembangan harus menanggung bahaya yang sama dengan
mesin target, karena itu database container dijalankan dengan `TimeZone='Asia/Jakarta'`.
Saat Bagian A diverifikasi, database container kembali **UTC**: aturan itu hanya hidup sebagai
kalimat di berkas ini, dan `reset` berikutnya menghapusnya. Penjaga yang hilang tanpa suara.

Kini `db.sh` dan `db.ps1` memasang `ALTER DATABASE ... SET TimeZone='Asia/Jakarta'` tepat setelah
`CREATE DATABASE`, dengan alasannya ditulis di sebelahnya. Seluruh hasil di bawah diperoleh pada
database yang zona waktunya BUKAN UTC, termasuk `reset` penuh dari nol.

### Hasil lingkungan pengembangan (2026-09-28)

**311 kasus, seluruhnya hijau** setelah `db.sh reset` dari database kosong: SQL 112 (11 berkas),
API 139 (34,9 detik), browser 60 (2,1 menit). `lint:guc` bersih.

Dua catatan yang tidak boleh disembunyikan:

1. **Satu kegagalan yang tidak dapat saya jelaskan.** Pada jalur penuh PERTAMA setelah reset,
   `slice12.spec.ts` #2 gagal satu kali. Ia lulus sendirian, lulus bersama berkas-berkas
   sebelumnya, dan lulus pada dua jalur penuh berikutnya; berkas bukti Playwright sudah
   tertimpa jalur yang lulus sebelum sempat dibaca. Dugaan saya - **tidak terbukti** - adalah
   keadaan server web/API yang baru saja dihidupkan ulang tepat setelah database dibuat ulang,
   bukan jalur kode. Dicatat di sini karena tes yang gagal sekali lalu "sembuh sendiri" adalah
   hal yang paling mudah dilupakan, dan paling mahal kalau ternyata nyata.
2. **Lingkungan container, bukan kode:** Playwright 1.63 meminta Chromium revisi 1243 sementara
   container menyediakan 1194, sehingga jalur browser dijalankan dengan
   `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (variabel yang memang
   sudah didukung `playwright.config.ts`). Mesin target memakai Chromium hasil
   `npx playwright install` seperti biasa.

Verifikasi mesin target untuk Bagian A **belum dijalankan**; angka di atas berlaku untuk
lingkungan pengembangan saja.
