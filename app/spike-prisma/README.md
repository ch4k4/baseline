# Spike DEMO-0100 - Prisma 7 + RLS

Paket terpisah: tidak mengubah `api/`, `web/`, atau database. Hasil dan
keputusannya ada di [SPIKE_RESULT.md](SPIKE_RESULT.md).

## Menjalankan (Windows, PowerShell)

Prasyarat: database demo sudah di-`reset` (`app\db\scripts\db.ps1 reset`).
Password default `devuser` / `devowner` dipakai kecuali
`$env:DEMO_DB_USER_PASSWORD` / `$env:DEMO_DB_OWNER_PASSWORD` diisi.

```powershell
cd D:\claude\base\app\spike-prisma
npm.cmd install          # versi dipatok persis: prisma 7.10.0, BUKAN "latest" (8.0 RC)
npm.cmd test             # target: 13 pass
npm.cmd run drift        # butuh unduhan schema-engine dari binaries.prisma.sh
npm.cmd run lint:guc     # target: OK
```

Tes ikut mencetak dua angka waktu (`[spike] timeout ...`). Kirim angka itu
bersama hasilnya.

`npm.cmd test` boleh diulang tanpa `reset`: semua penulisan di-rollback, dan
hash token dibuat acak setiap kali tes dijalankan.
