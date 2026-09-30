# app — implementasi demo baseline

Folder ini berisi **kode** demo e2e lokal. Folder ini bukan dokumen normatif.

- Dokumen normatif ada di folder induk (`..`): `README.md`, `ARCHITECTURE_DECISIONS.md`, dan lima SSOT lainnya.
- Kalau kode dan dokumen berbeda, dokumen yang benar dan kodenya diperbaiki. Pengecualiannya: bila implementasi membuktikan dokumennya salah, dokumen dinaikkan edisinya lewat aturan README induk §4.
- Folder ini **tidak boleh** memuat salinan dokumen normatif (README induk §7 kriteria 1). Rujuk dokumen induk dengan nama dan bagian, misalnya "ADR-002 §2.2" atau "Lampiran A F-16".

## Mulai dari mana

| Kebutuhan | Berkas |
|---|---|
| Memasang dan menjalankan di Windows (PostgreSQL 18, Node, tiga jendela PowerShell) | [SETUP.md](SETUP.md) |
| Apa yang sengaja belum dikerjakan, dan kapan ditagih | [DEFERRED.md](DEFERRED.md) |
| Bukti bahwa tes benar-benar menguji (mutation test per slice) | [AUDIT.md](AUDIT.md) |
| API: endpoint, unit of work, enkripsi, undangan | [api/README.md](api/README.md) |
| Web: Next.js sebagai BFF, peta halaman, cookie | [web/README.md](web/README.md) |
| Hasil spike Prisma (DEMO-0100) | [spike-prisma/SPIKE_RESULT.md](spike-prisma/SPIKE_RESULT.md) |

## Struktur

```text
app/
  db/
    migrations/   skema, RLS, policy, fungsi SECURITY DEFINER (satu-satunya sumber skema)
    tests/        tes SQL, dijalankan sebagai app_user, selalu ROLLBACK
    scripts/      db.ps1 (Windows) / db.sh: reset, migrate, seed, test
    data-field-register.json   Data Field Register (Data Protection SSOT §13)
    register.json              Register Lampiran A sebagai data (dibandingkan tes dengan database)
  mutations/      harness uji mutasi per slice (bukti bahwa tes benar-benar menguji)
  api/            NestJS + Prisma 7.10.0 (klien saja), ESM
  web/            Next.js sebagai BFF; tes browser Playwright
  spike-prisma/   paket spike terpisah, bukan bagian aplikasi
```

## Status (2026-09-28)

**332 kasus**: 117 SQL, 155 API, 60 browser. Hijau di lingkungan pengembangan pada 2026-09-28, setelah `reset` penuh dari database kosong.

Sampai slice 14 (DEMO-0312) hasil ini juga hijau di mesin target (Windows, PostgreSQL 18.6, Chromium Playwright) pada 2026-09-27: 290 kasus, lewat dua jalur - jalur pertama gagal 11 kasus API karena cacat zona waktu yang hanya muncul di sana (D-40, lihat AUDIT.md), jalur kedua hijau penuh. **Bagian A DEMO-0409 (menu dinamis, 21 kasus baru) belum diverifikasi di mesin target.**

Sejak D-40, `reset` mematok zona waktu database ke `Asia/Jakarta` - BUKAN UTC, dan itu disengaja: cacat pembacaan `timestamptz` lewat query mentah tidak bergejala pada server UTC, sehingga lingkungan pengembangan yang UTC tidak dapat menemukannya.

| Slice | Isi |
|---|---|
| 1 | Isolasi tenant (RLS `FORCE`) + jalur pre-context (Opsi A) |
| 2 | Login, session, endpoint tenant-scoped |
| 3 | Halaman login + daftar anggota |
| 5 | Pilih tenant (tiket sekali pakai) + pindah tenant |
| 6 | Audit event tanpa data pribadi + rate limiting |
| 7 | JWT bertanda tangan + rotasi refresh token dengan reuse detection |
| 8 | Enkripsi field (AES-256-GCM, DEK per scope) + blind index + Data Field Register |
| 9 | Undangan anggota: respons seragam, token sekali pakai lewat outbox, F-11/F-16/F-12 |
| 10 | RBAC di endpoint: katalog permission, role, resolver permission efektif, guard deny-by-default |
| 11 | Administrasi anggota dan role (API), role saat undangan, anti-eskalasi |
| 11b | Mengaktifkan kembali anggota (D-27); penanda owner `owners.manage` (D-28) |
| D-29 | Nama event audit: Demo Foundation §15 mengikuti konvensi kode; `auth.refresh.reuse_detected` |
| D-30 | Katalog nama event audit di database; nama di luar katalog ditolak foreign key |
| 12 | Layar administrasi (DEMO-0307): dasbor, anggota, undangan, role, `/403`; skenario demo 1-2 |
| D-26 | Nama role = label, bukan data pribadi: ditolak CHECK di tabel; hasil aksi dirender di formulir |
| 13 | Guard platform + admin platform (DEMO-0311); notifikasi keamanan tenant (DEMO-0313). Context platform dijaga GUC `app.context_kind` yang fail-closed, bukan `tenant_id` |
| 14 | Sesi dukungan break-glass (DEMO-0312): token `ctx=SUPPORT`, batas 60 menit di CHECK, READ_ONLY dua lapis, alasan terenkripsi DEK platform, audit dan notifikasi ke tenant |
| D-40 | Prisma salah membaca `timestamptz` bila TimeZone server bukan UTC; dipatok di unit of work, durasi dihitung database |
| 15 | Menu sebagai data (DEMO-0401/0402/0403/0405): `GET /me/menu`, deny-by-default, pemangkasan grup, navigasi web tanpa daftar tetap |
| Fondasi 1 | Lampiran A dapat ditegakkan: `api/test/register.test.ts` + `db/register.json` + nomor F-xx sebagai COMMENT (migrasi 0022). Menemukan 9 penyimpangan pada pemanggilan pertama |
| Fondasi 2 | Ledger migrasi `schema_migrations` (migrasi 0001b) + pemasang tunggal `api/scripts/migrate.ts`: baseline dapat dipasang MAJU, bukan hanya lewat reset |
| Fondasi 3 | Provisioning tenant (migrasi 0023): tenant baru mendapat kunci enkripsi (D-17) dan role sistem dari template (D-25) dalam satu transaksi; owner pertama lewat pengecualian terkontrol ADR-002 §2.3a |
| D-20, ESM, D-12 | Batas waktu web ke API; `api/` sebagai ES module; `api/` di atas Prisma |

Setiap slice dinyatakan hijau hanya setelah kodenya **dirusak dengan sengaja** dan tesnya terbukti menangkap. Rincian dan mutasi yang lolos ada di [AUDIT.md](AUDIT.md).

## Aturan yang ditegakkan alat

- Aplikasi konek sebagai `app_user`, tanpa `BYPASSRLS`. Akses sebelum tenant context hanya lewat fungsi `auth.*` yang terdaftar di Lampiran A.
- Context tenant dipasang sebagai statement pertama setiap transaksi, transaction-local, bersama `statement_timeout`. `npm run lint:guc` menolak pemasangan di tempat lain.
- Skema hanya dari `db/migrations/*.sql`. `prisma migrate` tidak dipakai.
- Semua panggilan web ke API lewat `apiFetch` (dengan batas waktu). Tes D-20 menolak `fetch()` langsung.
- Database tidak pernah memegang kunci maupun plaintext data pribadi. Tes slice 8 memeriksa dump seluruh tabel.
- Nama event audit hanya dari katalog `audit_event_types`; nama lain ditolak foreign key, dan daftar yang sama dijaga tipe di `api/src/auth/audit-events.ts`.
- Nama role tidak boleh memuat alamat email atau deretan 8+ digit: ditolak CHECK `roles_name_label_ck`, bukan hanya validasi aplikasi.
- Setiap route API wajib mendeklarasikan aksesnya (publik, session, atau permission). Tanpa deklarasi = ditolak; tes slice 10 memindai semua controller. Keputusan akses hanya atas kode permission, tidak pernah nama role.

## Batas penting

Demo ini hanya untuk **data synthetic**:

- KEK berupa berkas lokal (opsi C2, Data Protection SSOT §9.2).
- Undangan dikirim ke folder outbox, bukan email.
- Menu masih daftar tetap yang disaring permission; menu dinamis dari `GET /me/menu` adalah Sprint 4.
- Halaman profil sendiri dan layar audit belum ada.

Daftar lengkap syarat sebelum data nyata ada di [DEFERRED.md](DEFERRED.md).
