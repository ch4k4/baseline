# mutations — harness uji mutasi

Folder ini berisi alat untuk **merusak kode dengan sengaja** lalu memastikan tesnya
menangkap. Slice hanya dinyatakan hijau setelah langkah ini, bukan setelah tesnya lulus
(README induk §7; `../AUDIT.md` memuat hasilnya per slice).

Sampai 2026-09-28 harness ini hidup di folder sementara di luar repo, dan akibatnya
nyata: tabel mutasi Bagian A DEMO-0409 hilang bersama sesi kerjanya dan **seluruh 19
mutasinya harus dijalankan ulang dari nol**. Bukti yang hanya ada di kepala atau di
`/tmp` adalah bukti yang akan dikerjakan dua kali.

## Aturan yang mengikat pembacaan hasilnya

1. **Mutasi dianggap tertangkap hanya bila yang gagal adalah kasus yang memang menjaga
   perilaku itu.** Pernah ada mutasi web dilaporkan "tertangkap" padahal PostgreSQL
   sedang mati dan semua kasus gagal; dan mutasi R1 (deny-by-default) "tertangkap" oleh
   kasus yang tidak memilikinya, hanya karena kasus lain meninggalkan data. Karena itu
   setiap harness di sini mencetak NAMA kasus yang gagal, bukan sekadar merah/hijau.
2. **Mutasi yang LOLOS dicatat apa adanya** di `../AUDIT.md`, beserta alasannya:
   ekuivalen, berlapis, atau tidak terjangkau lewat endpoint yang ada. "Lolos" tanpa
   penjelasan berarti ada tes yang harus ditambah.
3. **Pulihkan, lalu buktikan pulih.** Setiap harness menjalankan ulang tesnya di akhir
   dan harus melaporkan baseline hijau. Mutasi yang gagal dipulihkan mencemari hasil
   mutasi berikutnya.

## Menjalankan

Semua perintah dari folder ini, dengan `DEMO_DB_SUPER_PASSWORD` terisi:

```bash
DEMO_DB_SUPER_PASSWORD=... bash register.sh        # 13 mutasi skema/register (butuh api/dist terbangun)
DEMO_DB_SUPER_PASSWORD=... bash ledger.sh          # 8 mutasi ledger migrasi
DEMO_DB_SUPER_PASSWORD=... bash slice15-db.sh      # 8 mutasi database slice 15
DEMO_DB_SUPER_PASSWORD=... python3 slice15-api.py  # 8 mutasi kode API slice 15
DEMO_DB_SUPER_PASSWORD=... python3 slice15-web.py  # 3 mutasi web slice 15 (perlu server web hidup)
DEMO_DB_SUPER_PASSWORD=... bash slice16-db.sh      # 10 mutasi database slice 16
DEMO_DB_SUPER_PASSWORD=... python3 slice16-api.py  # 7 mutasi kode API slice 16
DEMO_DB_SUPER_PASSWORD=... bash verify.sh          # 9 mutasi untuk PENJAGANYA: ../scripts/verify.sh
MUTASI_VERIFIER=ps1 DEMO_DB_SUPER_PASSWORD=... bash verify.sh   # 10 mutasi yang sama untuk verify.ps1
```

`verify.sh` di folder ini menguji `../scripts/verify.sh` dan `../scripts/verify.ps1`,
bukan produknya. Alasannya: verifikator adalah satu-satunya hal yang berdiri antara
"saya sudah menjalankan tes" dan "tes itu benar-benar berjalan"; verifikator yang tidak
pernah dibuktikan dapat MERAH bukan penjaga, melainkan hiasan yang selalu hijau.
Hampir tiap kasusnya menjalankan seluruh suite (2-5 menit) — mahal, dan memang harus
begitu: mutasi yang dijalankan di atas suite tiruan tidak membuktikan apa pun tentang
suite yang sebenarnya. Kasusnya dapat dipilih: `bash verify.sh V4 V8`.

Pengecualiannya **V11**, yang berjalan dalam hitungan detik karena yang diuji adalah POLA
di dalam kedua verifikator, bukan hasil suite. Itu disengaja: regresi yang dijaganya hanya
dapat muncul di Windows (hiasan `NativeCommandError` dari PowerShell), jadi menjalankan
suite di sini tidak akan pernah menemukannya. V11 membaca polanya langsung dari berkas
sumber, sehingga melonggarkannya kembali akan ketahuan.

Variabel lingkungan yang dipakai (sama dengan `db/scripts/db.sh`): `DEMO_DB_NAME`,
`DEMO_DB_HOST`, `DEMO_DB_SUPER`, `DEMO_DB_SUPER_PASSWORD`, `DEMO_DB_OWNER_PASSWORD`,
`DEMO_DB_USER_PASSWORD`. `PW_CHROMIUM_PATH` hanya diperlukan bila Chromium disediakan
lingkungan (lihat `../web/playwright.config.ts`).

Alat pembantu: `sqltest.sh` menjalankan satu atau semua berkas tes SQL;
`restart-web.sh` membangun ulang web dan memastikan port 3000 benar-benar melayani —
tanpa itu hasil mutasi web menipu, karena tes bisa berjalan terhadap build lama.

## Catatan untuk harness kode (`*-api.py`, `*-web.py`)

Mutasi kode ditulis sebagai pasangan teks **lama → baru** yang harus cocok **tepat satu
kali**; harness menolak pola yang tidak unik daripada menebak. Berkas aslinya dipulihkan
apa adanya, termasuk saat mutasi gagal dikompilasi — kegagalan kompilator juga dihitung
sebagai tertangkap, dan disebut demikian, karena penjaganya tipe, bukan tes.
