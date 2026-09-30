<#
  db.ps1 - pengelola database lokal untuk PostgreSQL 18 native di Windows.

  Pemakaian (PowerShell, dari folder app\db\scripts):
    .\db.ps1 doctor    # cetak diagnosa: versi PowerShell, psql, koneksi  <- jalankan ini dulu kalau ada yang aneh
    .\db.ps1 setup     # buat database + role + skema + seed, lalu jalankan test
    .\db.ps1 reset     # hapus total lalu setup ulang  <- pakai ini saat migrasi kacau
    .\db.ps1 migrate   # jalankan migrasi saja (tanpa drop, tanpa seed)
    .\db.ps1 test      # jalankan test isolasi saja
    .\db.ps1 seed      # isi ulang identitas demo (email/nama terenkripsi + password)
    .\db.ps1 passwords # nama lama untuk 'seed', tetap berfungsi
    .\db.ps1 psql      # buka psql sebagai app_user

  Prasyarat: PostgreSQL 18 terpasang dan service berjalan. Skrip mencari psql.exe
  otomatis di C:\Program Files\PostgreSQL\<versi>\bin bila belum ada di PATH.

  CATATAN IMPLEMENTASI - dibaca sebelum mengubah berkas ini:
  Setiap pemanggilan psql ditulis sebagai satu baris dengan argumen harfiah.
  TIDAK ada array argumen, tidak ada splatting (@Args), tidak ada parameter
  bernama $Args. Aturan ini bukan gaya penulisan: cara PowerShell menyalurkan
  argumen ke program eksternal berbeda antara Windows PowerShell 5.1 dan
  PowerShell 7, dan kalau salah, psql berjalan TANPA -c lalu membuka prompt
  interaktif yang tampak seperti skrip menggantung. Argumen harfiah tidak punya
  ruang untuk salah tafsir di versi mana pun.

  BERKAS INI HARUS TETAP MURNI ASCII DAN DISIMPAN DENGAN BOM UTF-8.
  Windows PowerShell 5.1 membaca .ps1 tanpa BOM sebagai ANSI (CP1252), sehingga
  satu karakter seperti em-dash akan terbaca sebagai tiga byte sampah yang
  memuat tanda kutip - dan tanda kutip itu merusak parsing seluruh sisa berkas.
  Gejalanya: PowerShell mencetak kode sumbernya sendiri, atau perintah berjalan
  setengah lalu berhenti tanpa pesan yang masuk akal.

  Password di bawah hanya untuk pengembangan lokal. Jangan dipakai di mana pun
  selain mesin Anda sendiri, dan jangan di-commit setelah diganti.
#>

param(
  [Parameter(Position = 0)]
  [ValidateSet('doctor', 'setup', 'reset', 'migrate', 'test', 'seed', 'passwords', 'psql')]
  [string]$Action = 'setup'
)

$ErrorActionPreference = 'Stop'

# psql di Windows memakai encoding konsol (biasanya WIN1252) untuk membaca berkas
# .sql. Dipaksa UTF-8 supaya isi berkas terbaca sama di mesin mana pun.
$env:PGCLIENTENCODING = 'UTF8'

# Stempel versi berkas. Dicetak setiap kali dijalankan supaya tidak pernah lagi
# ada pertanyaan "apakah yang dijalankan sudah versi terbaru".
$ScriptVersion = '2026-09-22.9'

# ---------------------------------------------------------------- konfigurasi
$DbName        = if ($env:DEMO_DB_NAME)  { $env:DEMO_DB_NAME }  else { 'saas_demo' }
$SuperUser     = if ($env:DEMO_DB_SUPER) { $env:DEMO_DB_SUPER } else { 'postgres' }
$SuperPassword = $env:DEMO_DB_SUPER_PASSWORD
$OwnerPassword = if ($env:DEMO_DB_OWNER_PASSWORD) { $env:DEMO_DB_OWNER_PASSWORD } else { 'devowner' }
$UserPassword  = if ($env:DEMO_DB_USER_PASSWORD)  { $env:DEMO_DB_USER_PASSWORD }  else { 'devuser' }
$DbHost        = if ($env:DEMO_DB_HOST)  { $env:DEMO_DB_HOST }  else { '127.0.0.1' }
$DbPort        = if ($env:DEMO_DB_PORT)  { $env:DEMO_DB_PORT }  else { '5432' }

$Root       = Split-Path -Parent $PSScriptRoot
$Migrations = Join-Path $Root 'migrations'
$Tests      = Join-Path $Root 'tests'

Write-Host "db.ps1 $ScriptVersion" -ForegroundColor DarkGray

# ---------------------------------------------------------------- cari psql
function Resolve-Psql {
  foreach ($name in @('psql.exe', 'psql')) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  $candidates = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending
  foreach ($c in $candidates) {
    $p = Join-Path $c.FullName 'bin\psql.exe'
    if (Test-Path $p) { return $p }
  }
  throw "psql.exe tidak ditemukan. Tambahkan folder bin PostgreSQL ke PATH, atau pasang PostgreSQL 18."
}
$Psql = Resolve-Psql

function Require-SuperPassword {
  if ($SuperPassword) { return }
  Write-Host ""
  Write-Host "Password superuser PostgreSQL belum diset untuk sesi PowerShell ini." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  `$env:DEMO_DB_SUPER_PASSWORD = 'password-postgres-anda'"
  Write-Host ""
  Write-Host "Variabel ini hanya hidup selama jendela PowerShell terbuka."
  Write-Host ""
  exit 2
}

function Step($text) { Write-Host "  -> $text" -ForegroundColor DarkGray }
function Assert-Ok($what) {
  if ($LASTEXITCODE -ne 0) { throw "$what gagal (psql keluar dengan kode $LASTEXITCODE)" }
}

# ---------------------------------------------------------------- aksi
# Setiap fungsi memanggil psql sekali, dengan argumen harfiah. Lihat catatan di atas.

function Do-Doctor {
  Write-Host ""
  Write-Host "PowerShell   : $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition))"
  Write-Host "psql         : $Psql"
  $env:PGPASSWORD = $SuperPassword
  try {
    & $Psql --version
    Write-Host "Target       : $SuperUser@${DbHost}:$DbPort"
    Write-Host ""
    Write-Host "Uji argumen -c (harus mencetak angka 1, BUKAN membuka prompt):"
    & $Psql -X -w -h $DbHost -p $DbPort -U $SuperUser -d postgres -t -A -c "SELECT 1"
    if ($LASTEXITCODE -eq 0) {
      Write-Host "OK - psql menerima -c dengan benar." -ForegroundColor Green
    } else {
      Write-Host "GAGAL - psql keluar dengan kode $LASTEXITCODE." -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Database yang ada:"
    & $Psql -X -w -h $DbHost -p $DbPort -U $SuperUser -d postgres -t -A -c "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname"
  }
  finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  Write-Host ""
}

function Do-Drop {
  Step "hapus database $DbName"
  $env:PGPASSWORD = $SuperPassword
  try {
    & $Psql -X -w -h $DbHost -p $DbPort -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $DbName WITH (FORCE)"
    Assert-Ok "drop database"
  }
  finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}

function Do-Create {
  $env:PGPASSWORD = $SuperPassword
  try {
    # Cek dulu supaya "already exists" jadi saran, bukan stack trace.
    $exists = & $Psql -X -w -h $DbHost -p $DbPort -U $SuperUser -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname = '$DbName'"
    Assert-Ok "cek database"
    if ($exists -eq '1') {
      Write-Host ""
      Write-Host "Database `"$DbName`" sudah ada." -ForegroundColor Yellow
      Write-Host ""
      Write-Host "  .\db.ps1 reset     # hapus lalu bangun ulang dari nol"
      Write-Host "  .\db.ps1 test      # kalau isinya masih utuh dan hanya ingin menguji"
      Write-Host ""
      exit 2
    }

    Step "buat database $DbName"
    & $Psql -X -w -h $DbHost -p $DbPort -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $DbName"
    Assert-Ok "create database"

    # Zona waktu server SENGAJA bukan UTC (D-40). Prisma membaca timestamptz dari
    # query mentah sebagai jam dinding sesi database lalu melabelinya UTC, jadi cacat
    # kelas ini TIDAK bergejala pada server UTC. Dipatok di sini supaya kedua
    # lingkungan menanggung bahaya yang sama, dan supaya aturan itu tidak hilang pada
    # reset berikutnya seperti yang terjadi setelah slice 14.
    Step 'zona waktu database dipatok Asia/Jakarta (bukan UTC, sengaja - D-40)'
    & $Psql -X -w -h $DbHost -p $DbPort -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -q -c "ALTER DATABASE $DbName SET TimeZone='Asia/Jakarta'"
    Assert-Ok "patok zona waktu"

    Step 'role, schema auth, grant dasar (0001)'
    $f = Join-Path $Migrations '0001_roles.sql'
    & $Psql -X -w -h $DbHost -p $DbPort -U $SuperUser -d $DbName -v ON_ERROR_STOP=1 -q -v "owner_pw=$OwnerPassword" -v "user_pw=$UserPassword" -v "db_name=$DbName" -f $f
    Assert-Ok "migrasi 0001_roles.sql"
  }
  finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}

function Do-Migrate {
  # Daftar berkas dibaca dari folder, bukan ditulis tangan di sini. Migrasi baru
  # yang lupa didaftarkan adalah kesalahan yang gejalanya muncul jauh kemudian,
  # sebagai "tabel tidak ada" di tempat yang tidak berhubungan.
  # 0001 (role) dan 0005 (seed) dijalankan superuser, jadi dikecualikan.
  $files = Get-ChildItem $Migrations -Filter '0*.sql' |
           Where-Object { $_.Name -notmatch '^(0001|0005)_' } |
           Sort-Object Name |
           ForEach-Object { $_.Name }

  $env:PGPASSWORD = $OwnerPassword
  try {
    foreach ($file in $files) {
      Step "migrasi $file"
      $f = Join-Path $Migrations $file
      & $Psql -X -w -h $DbHost -p $DbPort -U app_owner -d $DbName -v ON_ERROR_STOP=1 -q -f $f
      Assert-Ok "migrasi $file"
    }
  }
  finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}

function Do-Seed {
  Step 'seed demo (0005, sebagai superuser)'
  $env:PGPASSWORD = $SuperPassword
  try {
    $f = Join-Path $Migrations '0005_seed_demo.sql'
    & $Psql -X -w -h $DbHost -p $DbPort -U $SuperUser -d $DbName -v ON_ERROR_STOP=1 -q -f $f
    Assert-Ok "seed demo"
  }
  finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}

# Identitas demo (email, nama, password) dibuat oleh seed Node, bukan SQL: sejak
# D-01 email dan nama dienkripsi di aplikasi sebelum menyentuh database, dan SQL
# tidak memegang kunci. Langkah ini WAJIB - tanpanya tidak ada satu user pun dan
# tes berikutnya gagal dengan pesan yang menuding ke tempat yang salah. Karena
# itu kegagalannya menghentikan skrip, bukan sekadar peringatan kuning.
#
# API di-build di sini (tsc lokal lewat node, bukan npm.ps1) karena seed memakai
# kode kripto yang SAMA dengan API. dist yang basi berarti seed menulis format
# yang berbeda dari yang dibaca API.
function Do-Identities {
  # Join-Path bertingkat, bukan string berisi backslash: pemisah jalur berbeda
  # antar sistem, dan jalur yang salah gagal diam-diam.
  $api  = Join-Path (Split-Path -Parent $Root) 'api'
  $tsc  = Join-Path (Join-Path (Join-Path $api 'node_modules') 'typescript') (Join-Path 'bin' 'tsc')
  $prisma = Join-Path (Join-Path (Join-Path $api 'node_modules') 'prisma') (Join-Path 'build' 'index.js')
  $seed = Join-Path (Join-Path $api 'dist') (Join-Path 'scripts' 'seed-demo.js')
  $boot = Join-Path (Join-Path $api 'dist') (Join-Path 'scripts' 'bootstrap-superadmin.js')
  $node = Get-Command node -ErrorAction SilentlyContinue

  if (-not $node) { throw "node tidak ditemukan di PATH. Pasang Node.js 22 atau lebih baru." }
  if (-not (Test-Path $tsc) -or -not (Test-Path $prisma)) {
    Write-Host ""
    Write-Host "Dependensi API belum terpasang. Jalankan sekali:" -ForegroundColor Yellow
    Write-Host "  cd $api"
    Write-Host "  npm.cmd install"
    Write-Host ""
    exit 2
  }

  Push-Location $api
  try {
    # Klien Prisma dibuat dari prisma/schema.prisma sebelum tsc: kode API
    # mengimpornya, dan hasil generate tidak disimpan di repo. Ini HANYA
    # generate - skema database tetap dari db/migrations (prisma migrate dilarang).
    Step 'generate klien Prisma'
    # --no-hints: CLI Prisma pernah menawarkan memasang "agent skills" ke dalam
    # folder proyek dan tawaran itu diterima sendiri setelah 30 detik (2026-09-23).
    & $node.Source $prisma generate --no-hints
    if ($LASTEXITCODE -ne 0) { throw "prisma generate gagal (kode $LASTEXITCODE)" }

    Step 'build API (seed memakai kode kripto yang sama dengan API)'
    & $node.Source $tsc -p tsconfig.json
    if ($LASTEXITCODE -ne 0) { throw "build API gagal (kode $LASTEXITCODE)" }

    Step 'seed identitas demo terenkripsi'
    & $node.Source $seed
    if ($LASTEXITCODE -ne 0) { throw "seed identitas gagal (kode $LASTEXITCODE)" }

    # Superadmin platform TIDAK ikut seed (ADR-003 sec.2.5): perintah
    # tersendiri, idempoten, dan mencatat audit hanya bila hak benar-benar
    # diberikan.
    Step 'bootstrap superadmin platform'
    & $node.Source $boot
    if ($LASTEXITCODE -ne 0) { throw "bootstrap superadmin gagal (kode $LASTEXITCODE)" }
  }
  finally { Pop-Location }
}

function Do-Test {
  # Semua berkas tes dijalankan, dibaca dari folder. Tes baru yang lupa
  # didaftarkan adalah tes yang tidak pernah berjalan - dan tes yang tidak
  # pernah berjalan sama saja dengan tidak ada.
  $tests = Get-ChildItem $Tests -Filter '*_test.sql' | Sort-Object Name
  if ($tests.Count -eq 0) { throw "tidak ada berkas tes di $Tests" }

  # Tes berjalan sebagai app_user, yang (dengan benar) tidak dapat membaca users
  # maupun menghitung blind index: kuncinya tidak pernah ada di database. Blind
  # index satu identitas uji diambil superuser dan diserahkan sebagai variabel.
  $env:PGPASSWORD = $SuperPassword
  try {
    $bi = & $Psql -X -w -h $DbHost -p $DbPort -U $SuperUser -d $DbName -t -A -c "SELECT encode(email_blind_index, 'hex') FROM users WHERE id = 'cccccccc-0000-0000-0000-000000000001'"
    Assert-Ok "ambil blind index identitas uji"
  }
  finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  $bi = "$bi".Trim()
  if (-not $bi) {
    Write-Host ""
    Write-Host "Identitas uji belum ada - seed belum berjalan." -ForegroundColor Yellow
    Write-Host "  .\db.ps1 reset"
    Write-Host ""
    exit 2
  }

  $env:PGPASSWORD = $UserPassword
  try {
    foreach ($t in $tests) {
      Step "tes $($t.Name) sebagai app_user"
      & $Psql -X -w -h $DbHost -p $DbPort -U app_user -d $DbName -v ON_ERROR_STOP=1 -v "multi_email_bi=$bi" -f $t.FullName
      Assert-Ok "tes $($t.Name)"
    }
  }
  finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  Write-Host "`n  SEMUA TEST LULUS ($($tests.Count) berkas)" -ForegroundColor Green
}

switch ($Action) {
  'doctor'  { Require-SuperPassword; Do-Doctor }
  'setup'   { Require-SuperPassword; Do-Create; Do-Migrate; Do-Seed; Do-Identities; Do-Test }
  'reset'   { Require-SuperPassword; Do-Drop; Do-Create; Do-Migrate; Do-Seed; Do-Identities; Do-Test }
  'migrate' { Do-Migrate }
  'test'      { Require-SuperPassword; Do-Test }
  'seed'      { Require-SuperPassword; Do-Identities }
  'passwords' { Require-SuperPassword; Do-Identities }
  'psql'    {
    $env:PGPASSWORD = $UserPassword
    try { & $Psql -X -h $DbHost -p $DbPort -U app_user -d $DbName }
    finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  }
}
