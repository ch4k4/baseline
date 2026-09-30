# web - Next.js (BFF)

Halaman demo: masuk, pilih tenant, dasbor, dan layar administrasi anggota,
undangan, serta role.

## Peta halaman (Demo Foundation sec.12)

| Alamat | Isi | Hak yang dibutuhkan |
|---|---|---|
| `/login`, `/select-context` | masuk; pilih tenant bila identitas punya lebih dari satu | - |
| `/dashboard` | tenant aktif, hak yang dipegang, pintu masuk administrasi | session sah |
| `/administration/members` | daftar anggota: filter, paginasi (`?limit=`), role | `members.read` |
| `/administration/members/[id]` | ubah nama, ganti role, tangguhkan/aktifkan | `members.read` + hak aksinya |
| `/administration/invitations` | undang (dengan role), daftar, cabut | `members.read` / `members.invite` |
| `/administration/roles`, `/administration/roles/[id]` | buat, ganti nama, arsipkan, editor permission | `roles.*` |
| `/403` | halaman "tidak punya akses" - pengguna TIDAK dikeluarkan | session sah |
| `/invite`, `/invite/diterima` | penerimaan undangan (publik, lewat token) | - |
| `/members` | alamat lama, dialihkan ke `/administration/members` | - |

Aksi berdampak besar (tangguhkan, aktifkan kembali, arsipkan role, cabut
undangan) lewat **halaman konfirmasi server** yang menyebut tenant aktif dan
akibatnya - bukan dialog `confirm()`: halaman bekerja tanpa JavaScript, dapat
diuji, dan ramah keyboard.

Navigasi disaring permission efektif (`GET /me/permissions`), bukan nama role.
Itu hanya tampilan: membuka URL-nya langsung tetap ditolak API dan berakhir di
`/403`. Sidebar dari `GET /me/menu` adalah kapabilitas Sprint 4.

## Hasil aksi dirender di formulir, bukan dibawa di alamat halaman

Formulir yang mengubah data memakai `components/FormAksi.tsx` (`useActionState`):
aksinya MENGEMBALIKAN hasil, dan pesannya dirender di dalam formulir itu.

Rancangan pertama membawa hasil sebagai query (`?gagal=...`) dan memantulkan
halaman ke dirinya sendiri. Itu bekerja sekali, lalu berhenti: setelah satu
pantulan, pengiriman BERIKUTNYA dari formulir yang sama tidak lagi berpindah
halaman - datanya tersimpan di server, sementara layar tetap menampilkan pesan
lama. Pengguna menyimpulkan "gagal" dan mengirim ulang. Tes browser slice 12 #7
yang menemukannya; mutasi X7 mengembalikan pola lama dan tes itu gagal.

Pengalihan tinggal untuk hal yang memang berpindah tempat: 401 ke `/refresh`,
403 ke `/403`, dan sukses yang membuka halaman lain (misalnya role baru dibuat).
Pesan dari pengalihan lintas halaman dirender di tingkat halaman dengan
`data-testid="pesan-halaman"`, terpisah dari pesan di dalam formulir.

## Pola: Next sebagai BFF, bukan SPA

Browser hanya berbicara dengan Next. Panggilan ke NestJS terjadi di server.

Akibatnya, dan ini disengaja:

- **token tidak pernah sampai ke JavaScript browser** - dua cookie `httpOnly`:
  `demo_session` (access token, JWT) dan `demo_refresh` (refresh token);
- **tidak ada CORS untuk diurus** - hanya satu origin yang dihubungi browser;
- **NestJS tidak perlu terekspos** ke jaringan tempat browser berada;
- **form login bekerja tanpa JavaScript** - server action, bukan fetch dari klien.

Password tidak pernah melewati JavaScript klien.

## Menjalankan

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start            # http://127.0.0.1:3000
```

API di port 3001 harus sudah berjalan lebih dulu.

## Tes browser

```powershell
npx.cmd playwright install chromium    # sekali saja, mengunduh ~150 MB
npm.cmd run test:e2e
```

Kedua server (3000 dan 3001) harus hidup saat tes dijalankan.

## Tiga bug yang ditemukan tes ini, bukan ditemukan pengguna

1. **Lingkaran pengalihan tanpa ujung.** Session kedaluwarsa -> `/members` melempar
   ke `/login` -> `/login` melihat cookie basi masih ada -> melempar balik ke
   `/members`. Pengguna melihat `ERR_TOO_MANY_REDIRECTS`, bukan halaman login.
   Perbaikan: cookie basi dihapus lewat `/logout`, bukan diabaikan.

2. **Pengalihan ke origin yang salah.** `NextResponse.redirect` dengan URL absolut
   dari `request.url` atau `nextUrl.origin` mendaratkan pengguna di `localhost`
   padahal ia berada di `127.0.0.1` - origin tempat cookie-nya tidak berlaku.
   Di belakang proxy, ini mengirim orang ke host yang salah. Perbaikan: `Location`
   relatif, diselesaikan browser.

3. **Tes yang selalu hijau.** Tes "token tidak dapat dibaca JavaScript" membaca
   `document.cookie` sebelum navigasi selesai, sehingga tetap lulus walau
   `httpOnly` dimatikan. Perbaikan: tunggu navigasi, lalu periksa flag cookie
   dari dua arah.

## Hasil mutation test

| Mutasi | Hasil |
|---|---|
| `httpOnly: false` | tes 7 gagal (setelah tes diperkuat) |
| `/logout` tidak menghapus cookie | tes 10 gagal - `ERR_TOO_MANY_REDIRECTS` |
| 401 dari API tidak dikenali | 1 tes gagal |
| Cookie tidak dipasang saat login | 4 tes gagal |
| Penjagaan token di halaman dihapus | **10 lulus - mutasi setara** |

Baris terakhir bukan kelemahan yang perlu ditambal. Penjagaan token di halaman
adalah lapisan tambahan; batas keamanan sebenarnya ada di API, dan API tetap
menolak. Menambahkan tes yang "menangkap" mutasi ini hanya akan menguji struktur
kode, bukan perilaku yang penting.


## Perpanjangan sesi (slice 7)

Access token berumur pendek, jadi 401 yang paling sering terjadi bukan "dicabut"
melainkan "kedaluwarsa". Halaman terlindungi menangani itu dengan mengalihkan ke
`/refresh`, yang selalu mendarat di `/dashboard?diperbarui=1`. Tujuan yang
dipatok itu juga yang memutus lingkaran: halaman mana pun boleh mengirim ke
`/refresh`, tetapi hanya satu halaman yang menerima kembalinya.

Dua hal di jalur ini yang bukan kerapian belaka:

- **Perpanjangan harus lewat route handler.** Server component yang merender
  halaman tidak boleh menulis cookie, jadi token baru tidak dapat dipasang di
  tempat. Itulah kenapa ada pengalihan, bukan `fetch` diam-diam.
- **`/refresh` tidak menerima `?next=`.** Tujuan yang diambil dari parameter
  membuat halaman ini menjadi pengalih terbuka: tautan yang berangkat dari
  domain yang benar dan mendarat di tempat lain. Selama hanya ada satu halaman
  terlindungi, tujuan yang dipatok adalah jawaban yang jujur.

Lingkaran pengalihan sudah pernah terjadi di slice 3, dan itulah sebabnya
tujuan perpanjangan dipatok ke satu halaman: kalau tokennya tetap ditolak
setelah perpanjangan, `/dashboard` mengirim pengguna ke `/logout`, bukan
kembali ke `/refresh`.
