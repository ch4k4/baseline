# api — NestJS, slice 2

Login, session, dan satu endpoint tenant-scoped di atas RLS slice 1.

## Menjalankan

```powershell
$env:DEMO_DB_SUPER_PASSWORD = 'password-postgres-anda'

npm.cmd install             # SEBELUM db.ps1: seed identitas memakai kode di folder ini
..\db\scripts\db.ps1 reset   # build API, seed identitas terenkripsi, tes SQL
npm.cmd run test:e2e        # 104 kasus, berkas dijalankan berurutan (lihat slice 9)
npm.cmd run dev             # http://127.0.0.1:3001
```

### Database: Prisma di atas unit of work (D-12)

- Semua akses database lewat `UnitOfWork` (`withTenant` / `withoutTenant`).
  `lint:guc` menolak `set_config('app.*')` dan `$transaction` di luar
  `src/database/unit-of-work.ts`, serta `new PrismaClient` di luar
  `src/database/prisma.ts`.
- Di dalam transaksi: `tx.db.<model>` untuk query bertipe, dan `tx.query(sql, params)`
  untuk fungsi `auth.*`. Hasil bytea dari `tx.query` berupa Buffer; `Bytes` dari
  model berupa Uint8Array, jadi bungkus dengan `Buffer.from` sebelum masuk ke kripto.
- `prisma/schema.prisma` hanya model **klien**. Skema database tetap
  `db/migrations/*.sql`, dan **`prisma migrate` dilarang**. Kolom baru ditambahkan
  ke SQL dulu, lalu ke `schema.prisma`; tes `prisma.test.ts` #3 gagal bila
  keduanya tidak cocok.
- `src/generated/` adalah hasil `prisma generate` dan tidak disimpan. Skrip npm
  dan `db.ps1` membuatnya ulang.
- Versi Prisma dipatok persis di 7.10.0. Tag `latest` di npm saat ini menunjuk
  ke release candidate Prisma 8.

### Format modul: ESM

Sejak 2026-09-21 `api/` berjalan sebagai ESM (`"type": "module"`, `module:
NodeNext`), sesuai Infrastructure SSOT sec.4. Aturan yang ikut berlaku:

- Impor lokal wajib diakhiri `.js`, walau berkas sumbernya `.ts`
  (`import { x } from './pool.js'`). Tanpa akhiran, `tsc` menolaknya.
- Tidak ada `require`, `module`, `__dirname`, maupun `__filename`. Padanannya
  adalah `import`, `import.meta.dirname`, dan `import.meta.url`.
- Titik masuk `src/main.ts` mendeteksi "dijalankan langsung" lewat perbandingan
  realpath. Tes `test/esm.test.ts` menjaganya, termasuk lewat junction, karena
  kesalahan di sini membuat API tidak start tanpa pesan apa pun.

### Enkripsi field (slice 8)

Semua kriptografi ada di `src/crypto/`, dan kode lain tidak memanggil cipher langsung:

| Berkas | Isi |
|---|---|
| `envelope.ts` | AES-256-GCM + HMAC-SHA-256 dari `node:crypto`; format envelope dan AAD |
| `key-ring.ts` | DEK terbungkus -> DEK di memori; loader disuntikkan (API: fungsi definer, seed: superuser) |
| `kek-source.ts` | KEK demo dari berkas di luar repo; dibuat hanya oleh seed |
| `field-crypto.ts` | Katalog field (`FIELDS`) dan satu-satunya API enkripsi yang dipakai aplikasi |
| `normalize.ts` | Normalisasi email untuk blind index, dan masker tampilan |

Seed (`scripts/seed-demo.ts`) memakai modul yang SAMA dengan API, sehingga keduanya
tidak mungkin berbeda pendapat tentang AAD, domain blind index, atau normalisasi.

Password demo diambil dari `DEMO_PASSWORD` (default `Demo#12345`) dan tidak
pernah ditulis ke berkas.

## Kalau gagal jalan

Skrip menerjemahkan kegagalan koneksi yang paling sering jadi kalimat yang menyebut
obatnya, bukan stack trace pg-protocol:

| Gejala | Artinya |
|---|---|
| `Database "saas_demo" belum ada` | `db.ps1 setup` belum dijalankan |
| `Tidak ada yang menjawab di 127.0.0.1:5432` | service PostgreSQL mati |
| `Password ditolak PostgreSQL` | `$env:DEMO_DB_SUPER_PASSWORD` kosong atau salah — variabel ini hilang tiap jendela PowerShell ditutup |
| `Tabel yang dibutuhkan belum ada` | migrasi tidak lengkap; `db.ps1 reset` |

**`npm` ditolak PowerShell** (`npm.ps1 is not digitally signed`): pakai `npm.cmd` —
melewati wrapper PowerShell, fungsinya identik. Kalau mau `npm` polos tetap jalan,
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` untuk jendela itu saja,
atau `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` plus
`Unblock-File <folder-node>\*.ps1` — `Unblock-File` perlu karena berkas hasil ekstrak
ZIP bertanda "berasal dari internet" dan tetap diblokir tanpa itu.

## Endpoint

| Metode | Path | Keterangan |
|---|---|---|
| POST | `/api/v1/auth/login` | 1 context -> `{status:'SESSION', accessToken, refreshToken, expiresIn}`; >1 -> `{status:'CONTEXT_REQUIRED', ticket, contexts}` |
| POST | `/api/v1/auth/select-context` | menukar tiket dengan pasangan token pada tenant pilihan |
| POST | `/api/v1/auth/refresh` | `{refreshToken}` -> pasangan baru. Semua kegagalan menjawab 401 yang sama |
| POST | `/api/v1/auth/logout` | mencabut session; refresh token ikut mati karena rotasi menolak session tercabut |
| GET | `/api/v1/me/contexts` | daftar tenant milik identitas ini |
| POST | `/api/v1/me/context-switch` | pindah tenant tanpa password; mengembalikan pasangan token baru |
| GET | `/api/v1/members` | `members.read`; filter `status`, `roleId`, `email` (persis), paginasi `limit` ≤ 100 + `offset`. Setiap anggota membawa `roles` dan `version`. `canInvite` = petunjuk tampilan |
| GET | `/api/v1/members/:membershipId` | `members.read` |
| PATCH | `/api/v1/members/:membershipId/profile` | `members.update_profile`; `{displayName, version}` |
| POST | `/api/v1/members/:membershipId/suspend` | `members.suspend`; `{version}`; mencabut session anggota itu |
| POST | `/api/v1/members/:membershipId/reactivate` | `members.suspend`; `{version}`; SUSPENDED -> ACTIVE. Session lama tidak hidup kembali: anggota login ulang |
| PUT | `/api/v1/members/:membershipId/roles` | `members.assign_role`; `{roleIds, version}` (mengganti seluruh role) |
| GET/POST | `/api/v1/roles` | `roles.read` / `roles.create` (`{code, name}`) |
| GET/PATCH | `/api/v1/roles/:id` | `roles.read` / `roles.update` (`{name, version}`) |
| DELETE | `/api/v1/roles/:id?version=n` | `roles.archive`; mengarsipkan, bukan menghapus |
| PUT | `/api/v1/roles/:id/permissions` | `roles.assign_permission`; `{permissions, version}`; setara = tanpa perubahan |
| GET | `/api/v1/me/permissions` | session sah; permission efektif session ini (untuk tampilan) |
| GET | `/api/v1/permissions` | `permissions.read`; katalog permission TENANT (kode + deskripsi) |
| POST | `/api/v1/invitations` | `members.invite`; `roleIds` opsional; `{email}` -> **selalu** `202 {status:'INVITED'}`. Token ditulis ke outbox, tidak pernah ke respons |
| GET | `/api/v1/invitations` | `members.read`; email ber-masker, status `EXPIRED` dihitung dari `expires_at` |
| POST | `/api/v1/invitations/:id/revoke` | `members.invite`; undangan PENDING -> REVOKED. Selain itu 404 yang sama |
| POST | `/api/v1/invitations/lookup` | publik; `{token}` -> `{tenantName, expiresAt, hasAccount}` atau 404 |
| POST | `/api/v1/invitations/accept` | publik; `{token, password, displayName}` -> `{status:'JOINED'}`. 401 password salah, 410 tidak berlaku, 429 terkunci |

### Bentuk token (sejak slice 7)

`accessToken` adalah JWT HS256 dengan klaim `{sub, sid, tid, ctx, mid, iat, exp, jti}`.
`refreshToken` adalah 32 byte acak base64url - **bukan** JWT, dan tidak membawa isi
apa pun; yang disimpan database hanyalah hash SHA-256-nya.

Guard melakukan DUA pemeriksaan dan keduanya wajib: tanda tangan (tanpa database)
lalu baris session (hanya database). Yang kedua adalah alasan tombol keluar
berarti sesuatu. Lihat komentar di `src/auth/session.guard.ts`.

### Undangan (slice 9, D-09)

- Mengundang tidak pernah menyentuh identitas global, jadi respons tidak dapat
  membedakan email terdaftar - bukan karena disembunyikan, tetapi karena tidak
  pernah ditanyakan.
- Kanal pengiriman demo: folder outbox (`DEMO_OUTBOX_DIR`, bawaan
  `~/.saas-demo/outbox`), satu berkas per undangan. Masa berlaku
  `DEMO_INVITE_TTL_HOURS` (bawaan 72, maksimal 168 ditegakkan CHECK).
- Penerimaan: F-11 mencari undangan, F-16 membuat identitas baru bila perlu,
  F-12 membuat membership + profil dan menandai undangan diterima - F-16 dan
  F-12 dalam SATU transaksi.
- Hak mengundang = permission `members.invite` (sejak slice 10; D-21 lunas).
- `scripts/test-cleanup.ts` menghapus anggota hasil tes undangan (superuser).
  Alat tes, bukan jalur aplikasi.

### Hak akses (slice 10, DEMO-0301 s.d. 0304)

- Guard global `AccessGuard` untuk SEMUA route. Setiap route wajib memakai tepat
  satu dekorator dari `src/authz/access.decorator.ts`: `@Public()`,
  `@Authenticated()`, atau `@RequirePermission('kode')`. Tanpa dekorator = 403, dan
  tes slice 10 #9 memindai semua controller.
- Permission efektif dihitung per permintaan dari view `effective_permissions`
  (membership aktif, assignment aktif, role tidak diarsipkan). Keputusan tidak
  pernah memakai nama role.
- Penolakan dicatat `authz.denied` dengan permission dan POLA route; respons 403
  tidak menyebut permission yang kurang.
- Role baseline per tenant dibuat seed: `tenant_owner`, `tenant_admin`,
  `tenant_user`, `tenant_auditor` (Demo Foundation §6).

### Administrasi (slice 11)

Setiap jalan yang menulis role (`PUT /members/:id/roles`, `PUT /roles/:id/permissions`,
`DELETE /roles/:id`, `POST /members/:id/suspend`, `POST /members/:id/reactivate`,
`POST /invitations` dengan `roleIds`)
menegakkan tiga aturan di `src/admin/admin-rules.ts`: anti-eskalasi (hanya yang
seluruh permission-nya dipegang pelaku), tidak mengubah diri sendiri, dan minimal
satu anggota aktif tetap memegang `members.assign_role` (di bawah kunci advisory per
tenant). Versi basi menghasilkan 409; perubahan dicatat di audit tanpa data pribadi.

Pada penangguhan dan reaktivasi, anti-eskalasi menilai permission yang **dipegang**
anggota lewat role aktifnya, bukan view `effective_permissions`: view itu hanya
menghitung membership ACTIVE, sehingga anggota yang ditangguhkan tampak tanpa hak.

`owners.manage` (D-28) tidak membuka endpoint apa pun. Hanya `tenant_owner` yang
memegangnya, jadi anti-eskalasi yang sama melarang `tenant_admin` memberi, mencabut,
menangguhkan, atau mengaktifkan kembali pemegang role owner.

## Aturan yang ditegakkan alat, bukan ingatan

- `npm run lint:guc` menolak `set_config('app.*')` di luar `src/database/unit-of-work.ts`.
- Endpoint members sengaja TIDAK punya `WHERE tenant_id`. Penyaringnya RLS. Kalau
  baris tenant lain muncul, yang bocor adalah isolasinya — bukan query yang lupa memfilter.
- Aplikasi selalu konek sebagai `app_user`: tanpa BYPASSRLS, tanpa grant ke
  `users`/`credentials`. Semua akses pra-tenant lewat fungsi `auth.*`.

## Hasil mutation test

Kode dirusak dengan sengaja untuk memastikan tesnya menangkap:

| Mutasi | Hasil |
|---|---|
| Context tidak dipasang di `withTenant` | 3 tes gagal |
| Endpoint members pakai `withoutTenant` | 3 tes gagal |
| `verify()` selalu `true` | 2 tes gagal |
| Guard tidak memeriksa bentuk token | 1 tes gagal |
| `set_config` session-local (`false`) | **awalnya LOLOS** -> tes 11 ditambahkan -> sekarang gagal |

Baris terakhir itu yang paling berharga. Kasus 8 (beban bergantian dua tenant)
ternyata tidak membuktikan perlunya transaction-local: selama setiap transaksi
memasang context di awal, nilai basi selalu tertimpa. Yang benar-benar
membedakan adalah query yang berjalan di luar transaksi pada koneksi bekas
pakai — itu isi kasus 11.
