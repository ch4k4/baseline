# DEMO-0100 - Spike Prisma 7 + RLS + Opsi A + pool reuse

Status: **GO**, dengan empat syarat di bagian "Syarat GO".

Terverifikasi di mesin target (Windows, PostgreSQL 18.6) pada 2026-09-21:
- `npm.cmd test`: 13/13 lulus.
- `npm.cmd run drift`: berjalan (hasil di bawah).
- `npm.cmd run lint:guc`: OK.

Sebelumnya juga hijau di lingkungan pengembangan (Linux, PostgreSQL 16).

Tanggal: 2026-09-21. Versi yang diuji: `prisma` / `@prisma/client` /
`@prisma/adapter-pg` **7.10.0**, `pg` 8.23.0, Node 22.

## Cakupan

Spike berjalan di atas **skema demo yang asli** sebagai `app_user`, tidak memakai
tabel contoh. Yang dipakai: `tenant_memberships`, `tenant_member_profiles`,
`tenants`, `users`, serta fungsi `auth.*`. Semua penulisan di-rollback.

| # | Acceptance criteria DEMO-0100 | Bukti |
|---|---|---|
| 1 | Tabel RLS ENABLE/FORCE terdeteksi schema inspection | tes 1 |
| 2 | Transaksi interaktif, `set_config(..., true)` statement pertama, hanya baris tenant yang benar | tes 2 (txid sama untuk set_config, model query, dan raw query) |
| 3 | Tanpa context: 0 baris dan insert ditolak | tes 3 |
| 4 | Beban konkuren >= 200 request dua tenant pada pool kecil, tanpa kebocoran | tes 5: 240 transaksi (Alpha/Beta/tanpa context), pool 3 |
| 5 | Transaksi multi-langkah (rotasi refresh), perilaku timeout dicatat | tes 6, 6b, 6c |
| 6 | Drift `prisma migrate` terhadap objek SQL manual dicatat beserta mitigasinya | `npm run drift` (bagian "Drift") |
| 7 | Fungsi SECURITY DEFINER membaca dua tenant tanpa context, `app_user` tetap 0 baris | tes 7 (`auth.list_login_contexts`) |
| 8 | Kolom di luar grant tidak terbaca fungsi; `app_user` tidak dapat `SET ROLE app_auth_definer` | tes 8 (SET ROLE). Grant kolom fungsi sudah dijaga tes SQL slice 1 #14; tidak diulang di sini |
| 9 | Lint mendeteksi `set_config('app.` di luar modul unit-of-work | tes 9 + `scripts/lint-guc.mjs` (juga `$transaction` dan `new PrismaClient`) |

Uji mutasi: 10 mutasi (7 kode, 3 database), **10 tertangkap**. Kontrol hijau
sebelum dan sesudah, juga saat diulang tanpa reset.

| Mutasi | Tertangkap oleh |
|---|---|
| P1 `set_config` tenant session-level (`false`) | tes 5 (GUC tertinggal di koneksi pool), 6b |
| P2 `fn` menerima client global, bukan transaksi | tes 2, 4, 5, 6b, 6c, 10 |
| P3 `set_config` dihapus | tes 2, 4, 5, 6b, 6c, 10 |
| P4 `statement_timeout` dihapus | tes 6c |
| P5 validasi UUID tenant dihapus | tes 2b |
| P6, P7 aturan lint `$transaction` / `set_config` dihapus | tes 9 |
| D1 `NO FORCE ROW LEVEL SECURITY` pada `tenant_memberships` | tes 1 |
| D2 `app_user` dijadikan anggota `app_auth_definer` | tes 2, 3, 5, 6b, 7, 8 |
| D3 `app_user` diberi `BYPASSRLS` | tes 1, 2, 3, 4, 5, 6b, 7 |

## Temuan

Diurutkan dari yang paling berpengaruh ke keputusan.

1. **Timeout transaksi Prisma TIDAK menghentikan query yang sedang berjalan.**
   [High confidence, diukur]
   - Transaksi dengan timeout 300 ms dan query 1 detik baru ditolak setelah
     sekitar 1000 ms (P2028), dan selama itu koneksi tetap terpakai.
   - Query yang menunggu lock akan memegang koneksi tanpa batas.
   - Angka di mesin target: timeout 300 ms, ditolak setelah **1013 ms**.
   - Mitigasi: unit of work kini juga menyetel `statement_timeout`
     transaction-local di statement pertama. Dengan itu query dipotong di
     **320 ms** di mesin target (57014), dan nilainya tidak tertinggal di pool
     (tes 6c).
   - Mitigasi ini sekaligus menutup sebagian utang D-20 (tidak ada
     `statement_timeout` di API) begitu API pindah ke Prisma.
2. **SQL tetap sumber skema. Prisma hanya klien.**
   - Prisma tidak merepresentasikan RLS, FORCE, policy, fungsi, maupun grant.
     Ini sudah dinyatakan ADR-001 §3.9, dan kini terukur (bagian "Drift").
   - `prisma migrate dev` juga butuh shadow database, dan `app_owner` sengaja
     `NOCREATEDB`.
   - Usulan: `db/migrations/*.sql` tetap satu-satunya sumber skema.
     `schema.prisma` hanya model klien, dicocokkan ke database oleh
     `npm run drift`. Keamanan skema tetap dijaga tes SQL yang sudah ada dan
     tes 1 di sini.
3. **Harus pin versi persis.** [High confidence, dari registry npm 2026-09-21]
   - Tag `latest` npm untuk `prisma` saat ini adalah **8.0.0-rc.15**.
   - `npm install prisma` tanpa versi akan memasang release candidate Prisma 8,
     padahal baseline SSOT adalah Prisma 7 GA.
   - Pin: `7.10.0`, versi `prev` = Prisma 7 terakhir.
4. **Format modul.**
   - Generator Prisma 7 secara default menghasilkan ESM (`import.meta.url`,
     impor berakhiran `.ts`).
   - `moduleFormat = "cjs"` bekerja dengan `tsconfig` CommonJS milik `api/`.
   - Catatan sampingan: Infrastructure SSOT §4 mewajibkan backend
     `"type": "module"`, sedangkan `api/` sejak slice 2 memakai CommonJS.
     Penyimpangan ini sudah ada sebelum spike, belum tercatat, dan perlu
     keputusan tersendiri.
5. **Pool bersama.**
   - `PrismaPg` menerima `pg.Pool` yang sudah ada, sehingga kode `pg` lama dan
     Prisma dapat berbagi pool selama migrasi bertahap.
   - Syaratnya versi `@types/pg` selaras dengan yang dipakai adapter (>= 8.16).
     Spike memakai `pg` 8.23.0 / `@types/pg` 8.23.1; `api/` masih 8.16.3 /
     8.15.5.
6. **`Bytes` dikembalikan sebagai `Uint8Array`, bukan `Buffer`** (tes 10).
   Crypto adapter `api/` memakai API `Buffer`, jadi perlu `Buffer.from(...)`
   di batas repository.
7. **`$queryRaw` gagal pada fungsi bertipe `void`** (misalnya `pg_sleep`), jadi
   fungsi seperti itu harus dipanggil dengan `$executeRaw`.
   - Versi pertama tes timeout lulus karena kegagalan ini, bukan karena
     timeout: penolakan yang benar dengan alasan yang salah.
   - Tes kini memeriksa kode error (P2028 / 57014) dan durasinya.
8. **Penolakan hak akses terlihat sebagai error, bukan daftar kosong** (tes 8,
   model `User` tanpa grant). [Medium confidence] Prisma memilih semua kolom
   model secara default, sehingga tabel dengan grant kolom parsial butuh
   `select` eksplisit atau model tanpa kolom itu. Perilaku ini belum diuji
   langsung.
9. **Audit npm: 4 temuan high**, pada `deepmerge-ts` dan `mysql2`, yang hanya
   dibawa CLI `prisma` (devDependency).
   - `@prisma/client` mendeklarasikan `prisma` sebagai peer dependency, sehingga
     `npm audit --omit=dev` tetap melaporkannya.
   - [Medium confidence] Kode runtime tidak memuat CLI.
   - Perbaikan dari npm (`--force`) adalah turun ke Prisma 6, jadi **jangan**
     dijalankan.
   - Perlu ditinjau ulang saat Prisma 7.x berikutnya atau Prisma 8 GA.
10. **CLI mengunduh schema-engine dari `binaries.prisma.sh`** saat dijalankan
    pertama kali. Jaringan yang memblokir host itu membutuhkan
    `PRISMA_ENGINES_MIRROR`. Klien runtime tidak butuh binari: Prisma 7 tanpa
    query engine Rust.

## Drift (mesin target, 2026-09-21)

`prisma db pull` melihat 10 tabel dan menandai sebagian dengan komentar
"contains check constraints / row level security and requires additional setup
for migrations". Artinya Prisma tahu objek itu ada, tetapi tidak mengelolanya.

**Peringatan itu tidak lengkap.** Hanya 6 tabel yang ditandai, yaitu tabel yang
belum punya model di `schema.prisma`. Empat tabel yang sudah dimodelkan
(`tenants`, `tenant_memberships`, `tenant_member_profiles`, `users`) juga
memakai RLS FORCE dan CHECK, tetapi tidak diberi peringatan sama sekali: Prisma
mempertahankan model yang sudah ada tanpa menambah komentar. Jadi setelah
sebuah tabel dimodelkan, Prisma tidak lagi mengingatkan bahwa tabel itu punya
RLS. Karena itu keamanan skema harus dijaga tes (tes 1 dan tes SQL), bukan oleh
peringatan Prisma. [High confidence, dari `drift/pulled.prisma` di mesin target]

Kalau skema hasil pull dijadikan sumber migrasi (`migrate diff --from-empty`):

| Objek | Dibuat Prisma | Ada di `db/migrations` |
|---|---:|---:|
| CREATE TABLE | 10 | 10 |
| ROW LEVEL SECURITY | 0 | 21 |
| CREATE POLICY | 0 | 23 |
| CREATE FUNCTION | 0 | 18 |
| GRANT | 0 | 56 |
| CHECK | 0 | 33 |

**Kesimpulan:** database yang dibangun dari migrasi Prisma akan punya tabel yang
sama tetapi **tanpa satu pun** lapisan keamanan: tanpa RLS, tanpa policy, tanpa
fungsi Opsi A, tanpa grant kolom, dan tanpa CHECK (termasuk CHECK yang menolak
plaintext di kolom ciphertext). Karena itu `prisma migrate` tidak boleh dipakai
untuk skema ini sama sekali. Ini bukan sekadar "perlu setup tambahan".

**Mitigasi yang dipilih:** `db/migrations/*.sql` dan `db.ps1` tetap satu-satunya
jalur perubahan skema. `schema.prisma` hanya model klien.

## Syarat GO

1. **`prisma migrate` tidak dipakai.** Perubahan skema tetap lewat
   `db/migrations/*.sql`. Kecocokan `schema.prisma` dengan database diperiksa
   `prisma db pull` (atau `migrate diff --exit-code`) di tes, bukan dengan
   menjalankan migrasi Prisma.
2. **Unit of work wajib menyetel `statement_timeout`** di samping
   `app.current_tenant_id` (temuan 1).
3. **Versi dipatok persis** (`prisma`, `@prisma/client`, `@prisma/adapter-pg`
   = 7.10.0). Tidak ada `^`, apalagi `latest`.
4. **Keamanan skema tetap dibuktikan tes SQL yang ada** (51 kasus) ditambah
   pemeriksaan RLS/FORCE (tes 1). Prisma tidak menggantikan satu pun dari tes
   itu.

## Catatan instalasi di mesin target

- `npm install` memperingatkan `allow-scripts`: skrip install `prisma` dan
  `@prisma/engines` belum disetujui. `generate`, tes, dan `drift` tetap
  berjalan. Schema-engine diunduh saat perintah CLI pertama kali dipakai, bukan
  saat install. [Medium confidence] Karena itu skrip-skrip tersebut tidak perlu
  disetujui untuk spike ini. Sebelum dipakai di CI, perlu keputusan eksplisit:
  setujui (`npm approve-scripts`) atau biarkan terblokir.
- `npm audit`: 4 temuan high (lihat temuan 9). Jangan jalankan
  `npm audit fix --force`.

## Bila GO: dampak ke kode

- `api/src/database/unit-of-work.ts` diganti `PrismaUnitOfWork`. Kontrak
  `withTenant` / `withoutTenant` tetap, dan `statement_timeout` ikut masuk.
- Repository menerima `Prisma.TransactionClient`.
- Fungsi `auth.*` tetap dipanggil lewat `$queryRaw` / `$executeRaw`
  (Opsi A tidak berubah).
- `db/migrations/*.sql`, `db.ps1`, dan tes SQL tidak berubah.
- `lint:guc` di `api/` diperluas dengan aturan `$transaction` dan
  `new PrismaClient`.
- Seluruh tes API dan browser yang ada menjadi jaring pengaman migrasi.
