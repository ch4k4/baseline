<#
verify.ps1 - SATU perintah, SATU putusan. Padanan Windows dari verify.sh.

Sampai hari ini verifikasi adalah ritual tiga jendela: jalankan reset di satu
jendela, suite API di jendela lain, suite browser di jendela ketiga, lalu BACA
angkanya dengan mata dan bandingkan dengan ingatan. Dua hal yang salah dengan itu:

  1. angka yang dibaca mata adalah tempat kesalahan. "127 lulus" terlihat hijau
     walau seharusnya 155 - dan berkas tes yang diam-diam tidak ikut berjalan
     (tes SQL dibaca dari FOLDER) tidak akan pernah terlihat;
  2. tiga jendela berarti tiga kesempatan menjalankan yang salah, dengan urutan
     yang salah, atau melewatkan satu.

Berkas ini menjalankan seluruhnya dan membandingkan jumlahnya dengan
verify-expected.json - berkas angka yang SAMA dengan yang dipakai verify.sh,
supaya kedua mesin tidak pernah menjaga angka yang berbeda. Jumlah yang KURANG
dari yang diharapkan adalah kegagalan, sama seperti tes yang merah - dan jumlah
yang LEBIH juga, karena berarti seseorang menambah tes tanpa memperbarui angka
yang dijaga.

Pemakaian:
  $env:DEMO_DB_SUPER_PASSWORD = '...'
  .\verify.ps1                  # reset + SQL + API + browser
  .\verify.ps1 -TanpaReset      # database dipakai apa adanya
  .\verify.ps1 -TanpaBrowser    # tanpa lapisan browser

Server API (3001) dan web (3000) DIHIDUPKAN sendiri bila belum hidup, dan hanya
yang dihidupkan berkas ini yang dimatikan; server yang sudah berjalan sebelumnya
dipakai apa adanya. Logya disimpan dan jalurnya dicetak saat gagal.

CATATAN KEJUJURAN: berkas ini dibangun dan diuji di bawah pwsh/Linux, dan TIGA cacat
pertamanya ditemukan di Windows - ketiganya kelas yang tidak dapat muncul di pwsh/Linux:

  1. panggilan harfiah ke 'pwsh', yang tidak ada di Windows tanpa PowerShell 7;
  2. stderr perintah native diperlakukan Windows PowerShell 5.1 sebagai ErrorRecord,
     sehingga satu baris NOTICE dari psql menjadi kesalahan terminating;
  3. jumlah kasus API dibaca dari keluaran `spec` node, yang diawali simbol Unicode -
     di konsol Windows simbol itu menjadi tiga karakter sampah, sehingga 155 kasus yang
     LULUS SEMUA dilaporkan MERAH;
  4. `-match 'ERROR'` cocok dengan kata `NativeCommandError` di hiasan PowerShell,
     karena -match case-INSENSITIVE - sementara `grep` di verify.sh tidak.

Keempatnya sudah diperbaiki. Dua aturan yang lahir darinya: angka tidak pernah diambil
dari baris yang memuat hiasan non-ASCII (jumlah API kini dari keluaran TAP yang ditulis
node sendiri ke berkas); dan pola yang menyatakan aturan sama di kedua skrip harus diuji
di kedua bahasa, karena operator yang terlihat setara belum tentu bersemantik sama.
#>
[CmdletBinding()]
param(
  [switch]$TanpaReset,
  [switch]$TanpaBrowser
)

# 'Stop', bukan 'Continue'. Versi pertama memakai Continue, dan akibatnya sebuah
# kesalahan di tengah (parameter Start-Process yang tidak didukung pwsh/Linux)
# menghentikan pekerjaan TANPA putusan apa pun - lalu berkas ini keluar dengan
# kode 0. Diam yang terbaca sebagai sukses adalah persis cacat yang verifikator
# ini dibuat untuk mencegah, jadi sekarang setiap kesalahan tak terduga menjadi
# satu alasan MERAH, dan putusan SELALU dicetak (lihat try/catch/finally di bawah).
$ErrorActionPreference = 'Stop'

$Akar    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Harap   = Join-Path (Join-Path $Akar 'scripts') 'verify-expected.json'
$ApiUrl  = if ($env:API_BASE_URL) { $env:API_BASE_URL } else { 'http://127.0.0.1:3001' }
$WebUrl  = if ($env:WEB_BASE_URL) { $env:WEB_BASE_URL } else { 'http://127.0.0.1:3000' }
$WebPort = ([uri]$WebUrl).Port

if (-not $env:DEMO_DB_SUPER_PASSWORD) { throw 'DEMO_DB_SUPER_PASSWORD belum diset' }
if (-not (Test-Path $Harap)) { throw "berkas angka yang dijaga tidak ada: $Harap" }

$h            = Get-Content $Harap -Raw | ConvertFrom-Json
$SqlHarap     = [int]$h.sql
$SqlFileHarap = [int]$h.sqlFiles
$ApiHarap     = [int]$h.api
$BrowserHarap = [int]$h.browser

$Log   = Join-Path ([System.IO.Path]::GetTempPath()) ("verify-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $Log -Force | Out-Null
$Gagal = [System.Collections.Generic.List[string]]::new()
function Lapor($a, $b) { Write-Host ("{0,-28} {1}" -f $a, $b) }

# Nama perintah Node berbeda di Windows: npx tanpa .cmd tidak dapat dieksekusi
# langsung dari PowerShell.
$IsWin = $IsWindows -or ($env:OS -eq 'Windows_NT')
$Npx   = if ($IsWin) { 'npx.cmd' } else { 'npx' }
$Npm   = if ($IsWin) { 'npm.cmd' } else { 'npm' }

# Port yang DIHIDUPKAN berkas ini. Dimatikan lewat PORT, bukan PID: `npx next start`
# adalah pembungkus yang menjalankan server sebagai anak, jadi mematikan PID yang
# terlihat akan meninggalkan server hidup - dan jalankan berikutnya memakai server
# basi itu sambil mengira menghidupkan yang baru.
$PortDihidupkan = [System.Collections.Generic.List[int]]::new()

function Test-Port([int]$port) {
  try {
    $c = [System.Net.Sockets.TcpClient]::new()
    $ok = $c.ConnectAsync('127.0.0.1', $port).Wait(1500)
    $c.Close()
    return $ok
  } catch { return $false }
}

function Matikan-Port([int]$port) {
  try {
    if ($IsWin) {
      Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    } else {
      & fuser -k "$port/tcp" 2>$null | Out-Null
    }
  } catch { Write-Host "  (gagal mematikan port $port : $($_.Exception.Message))" }
}

# Start-Process: -WindowStyle hanya ada di Windows PowerShell. Memberikannya di
# pwsh/Linux BUKAN peringatan - ia kesalahan yang menghentikan skrip.
function Hidupkan-Server($dir, $exe, [string[]]$argumen, $keluar, $salah) {
  $p = @{
    FilePath               = $exe
    ArgumentList           = $argumen
    RedirectStandardOutput = $keluar
    RedirectStandardError  = $salah
    WorkingDirectory       = $dir
  }
  if ($IsWin) { $p['WindowStyle'] = 'Hidden' }
  Start-Process @p | Out-Null
}

function Bersihkan {
  foreach ($p in $PortDihidupkan) { Matikan-Port $p }
}

function Tunggu-Port([int]$port, [int]$detik) {
  for ($i = 0; $i -lt $detik; $i++) {
    if (Test-Port $port) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

# Jalankan perintah, buang keluarannya ke berkas, kembalikan KODE KELUARNYA.
#
# Kode keluar adalah SATU-SATUNYA tanda berhasil/gagal yang dipakai di sini, dan itu
# bukan selera: tulisan di stderr BUKAN kegagalan. psql menulis setiap `NOTICE` ke
# stderr, dan `NOTICE: role "app_owner" has already been granted membership` adalah
# keluaran normal migrasi 0001 yang idempoten.
#
# Windows PowerShell 5.1 memperlakukan stderr perintah native yang dialihkan sebagai
# ErrorRecord. Dengan $ErrorActionPreference = 'Stop' di puncak berkas ini, satu baris
# NOTICE karena itu menjadi kesalahan TERMINATING, dan seluruh verifikasi berhenti di
# langkah pertama - itulah yang terjadi pada jalur Windows kedua (2026-09-29).
# PowerShell 7 tidak berperilaku begitu, sehingga cacat ini tidak dapat muncul di
# lingkungan pengembangan.
#
# Karena itu preference dikembalikan ke 'Continue' DI DALAM fungsi ini saja - lingkupnya
# fungsi, jadi sifat fail-closed untuk kesalahan logika berkas ini sendiri tetap utuh di
# luar sini.
function Jalankan($dir, $berkas, $exe, [string[]]$argumen) {
  $ErrorActionPreference = 'Continue'
  # PowerShell 7.3+: jangan pula ubah kode keluar bukan-nol menjadi exception; yang
  # membaca kode keluar adalah pemanggil. Diset lewat Set-Variable supaya versi yang
  # tidak mengenal variabel ini tidak ikut gagal.
  Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $false -Scope Local -ErrorAction SilentlyContinue
  Push-Location $dir
  try {
    & $exe @argumen *> $berkas
    return $LASTEXITCODE
  } finally { Pop-Location }
}

# Baris terakhir yang berarti dari sebuah log, untuk ditempelkan pada alasan MERAH.
# Tanpa ini, "tes SQL gagal" tidak membedakan tes yang benar-benar merah dari database
# yang tidak dapat dihubungi sama sekali - dan keduanya menuntut tindakan yang berbeda.
function Alasan-Terakhir($berkas) {
  if (-not (Test-Path $berkas)) { return '(tanpa log)' }
  $baris = Get-Content $berkas -ErrorAction SilentlyContinue |
    Where-Object { $_ -and $_.Trim() -ne '' } |
    Select-Object -Last 3
  if (-not $baris) { return '(log kosong)' }
  return ($baris -join ' | ')
}

function Hitung-Cocok($teks, $pola) {
  return ([regex]::Matches($teks, $pola)).Count
}

# Host PowerShell yang SEDANG menjalankan berkas ini, dipakai untuk memanggil db.ps1.
#
# Versi pertama menulis 'pwsh' secara harfiah. Di Windows tanpa PowerShell 7 terpasang -
# yaitu keadaan bawaan - seluruh verifikasi berhenti di langkah PERTAMA dengan
# "The term 'pwsh' is not recognized", pesan yang tidak ada hubungannya dengan kode yang
# diuji. Verifikator tidak boleh menuntut pemasangan tambahan hanya untuk dijalankan.
#
# Memakai host yang sama menjamin satu hal yang lebih kuat daripada mencari 'pwsh':
# kalau verify.ps1 dapat berjalan, db.ps1 juga dapat berjalan - versi yang sama, tanpa
# kemungkinan dua PowerShell berbeda menafsirkan skrip yang sama secara berbeda.
function Cari-HostPowerShell {
  try {
    $p = (Get-Process -Id $PID).Path
    if ($p) { return $p }
  } catch { }
  foreach ($n in @('pwsh', 'powershell')) {
    $c = Get-Command $n -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
  }
  throw 'tidak menemukan host PowerShell untuk menjalankan db.ps1'
}
$HostPowerShell = Cari-HostPowerShell

# Nilai awal supaya putusan di bawah tetap dapat dihitung walau pekerjaan
# terhenti sebelum lapisan yang bersangkutan sempat berjalan.
$sqlN = 0; $apiLulus = 0; $browserLulus = 0; $Selesai = $false

try {
  # ---------------------------------------------------------------- database
  $dbLog = Join-Path $Log 'db.txt'
  $db    = Join-Path (Join-Path $Akar 'db') 'scripts'
  $aksi  = if ($TanpaReset) { 'test' } else { 'reset' }
  $kode  = Jalankan $db $dbLog $HostPowerShell @('-NoProfile', '-File', (Join-Path $db 'db.ps1'), $aksi)
  if ($kode -ne 0) {
    $apa = if ($TanpaReset) { 'tes SQL gagal' } else { 'reset database gagal' }
    $Gagal.Add("$apa (kode $kode): $(Alasan-Terakhir $dbLog)")
  }

  $dbTeks = if (Test-Path $dbLog) { Get-Content $dbLog -Raw } else { '' }
  # Jumlah kasus SQL = jumlah "SEMUA n KASUS" + kasus tunggal yang dilaporkan sendiri.
  $sqlN = 0
  foreach ($m in [regex]::Matches($dbTeks, 'SEMUA (\d+) KASUS')) { $sqlN += [int]$m.Groups[1].Value }
  $sqlN += Hitung-Cocok $dbTeks 'KASUS \d+ SLICE \d+ LULUS'
  $sqlBerkas = (Get-ChildItem (Join-Path (Join-Path $Akar 'db') 'tests') -Filter '*_test.sql' -ErrorAction SilentlyContinue).Count

  # -cmatch, BUKAN -match, dan 'ERROR:' berikut titik duanya.
  #
  # `-match` di PowerShell case-INSENSITIVE (berbeda dari `grep` di verify.sh, yang
  # case-sensitive). Akibatnya pola lama `ERROR` cocok dengan kata `NativeCommandError`
  # di blok hiasan yang ditulis PowerShell saat perintah native menulis ke stderr - dan
  # psql menulis setiap NOTICE ke stderr. Jalur Windows keempat (2026-09-29) karena itu
  # MERAH dengan "tes SQL memuat ERROR" padahal 332 kasusnya lulus dan satu-satunya
  # "error" di log adalah nama kategori kesalahan PowerShell.
  #
  # `ERROR:` dengan titik dua adalah bentuk yang benar-benar dipakai psql
  # (`psql:berkas.sql:12: ERROR:  ...`), jadi polanya menyempit ke hal yang dimaksud.
  if ($dbTeks -cmatch 'ERROR:') { $Gagal.Add('tes SQL memuat ERROR') }
  if ($sqlN -ne $SqlHarap) { $Gagal.Add("kasus SQL $sqlN, diharapkan $SqlHarap") }
  if ($sqlBerkas -ne $SqlFileHarap) { $Gagal.Add("berkas tes SQL $sqlBerkas, diharapkan $SqlFileHarap") }
  Lapor 'SQL' "$sqlN kasus / $sqlBerkas berkas (diharapkan $SqlHarap / $SqlFileHarap)"

  # ----------------------------------------------------------------------- API
  $api = Join-Path $Akar 'api'
  $tsc = Join-Path (Join-Path (Join-Path $api 'node_modules') 'typescript') (Join-Path 'bin' 'tsc')
  $kode = Jalankan $api (Join-Path $Log 'build.txt') 'node' @($tsc, '-p', 'tsconfig.json')
  if ($kode -ne 0) { $Gagal.Add('build API gagal') }

  # DUA reporter sekaligus: `spec` ke log (untuk dibaca orang) dan `tap` ke berkas
  # tersendiri (untuk dibaca skrip ini). Angka TIDAK PERNAH diambil dari log.
  #
  # Sebabnya jalur Windows ketiga (2026-09-29). Reporter `spec` menulis baris ringkasan
  # dengan awalan simbol info Unicode: `<U+2139> pass 155`. Di Windows, konsol membaca
  # keluaran UTF-8 node sebagai codepage OEM, sehingga satu simbol itu menjadi TIGA
  # karakter sampah, lalu PowerShell menyimpannya sebagai UTF-16. Pola lama
  # `^#? ?pass (\d+)` karena itu tidak cocok, `pass` terbaca 0 dan `fail` jatuh ke nilai
  # bawaan 1 - dan verifikasi dilaporkan MERAH padahal 155 kasusnya LULUS SEMUA.
  #
  # Melebarkan polanya hanya akan menebak bentuk sampah berikutnya. Keluaran TAP node
  # ditulis node SENDIRI ke berkas (tidak lewat konsol maupun pengalihan PowerShell),
  # murni ASCII, dan bentuknya tetap `# pass N` di sistem operasi mana pun.
  $apiLog = Join-Path $Log 'api.txt'
  $apiTap = Join-Path $Log 'api-tap.txt'
  Jalankan $api $apiLog 'node' @(
    '--test', '--test-concurrency=1',
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=tap', "--test-reporter-destination=$apiTap",
    'dist/test/*.test.js') | Out-Null

  if (-not (Test-Path $apiTap)) {
    # Tidak ada angka berarti tidak ada bukti. Itu MERAH, bukan nol yang didiamkan.
    $Gagal.Add('keluaran TAP suite API tidak ada - jumlah kasus tidak dapat dibaca')
    $apiLulus = 0; $apiGagal = 1
  } else {
    $tap      = Get-Content $apiTap -Raw
    $mLulus   = [regex]::Match($tap, '(?m)^# pass (\d+)')
    $mGagal   = [regex]::Match($tap, '(?m)^# fail (\d+)')
    $apiLulus = if ($mLulus.Success) { [int]$mLulus.Groups[1].Value } else { 0 }
    $apiGagal = if ($mGagal.Success) { [int]$mGagal.Groups[1].Value } else { 1 }
    if ($apiGagal -ne 0) { $Gagal.Add("$apiGagal kasus API gagal") }
    if ($apiLulus -ne $ApiHarap) { $Gagal.Add("kasus API $apiLulus, diharapkan $ApiHarap") }
  }
  Lapor 'API' "$apiLulus lulus / $apiGagal gagal (diharapkan $ApiHarap)"

  $lintLog = Join-Path $Log 'lint.txt'
  $kode = Jalankan $api $lintLog $Npm @('run', 'lint:guc', '--silent')
  if ($kode -ne 0) { $Gagal.Add('lint:guc gagal') }
  $lintAkhir = if (Test-Path $lintLog) { (Get-Content $lintLog | Select-Object -Last 1) } else { '(tanpa keluaran)' }
  Lapor 'lint:guc' $lintAkhir

  # ------------------------------------------------------------------- browser
  $browserLulus = 0
  if (-not $TanpaBrowser) {
    $siap = $true
    $web  = Join-Path $Akar 'web'

    if (Test-Port ([uri]$ApiUrl).Port) {
      Lapor 'server API' 'sudah hidup - dipakai apa adanya, tidak akan dimatikan'
    } else {
      Hidupkan-Server $api 'node' @('dist/src/main.js') `
        (Join-Path $Log 'api-server.txt') (Join-Path $Log 'api-server.err.txt')
      $PortDihidupkan.Add(([uri]$ApiUrl).Port)
      if (Tunggu-Port ([uri]$ApiUrl).Port 25) {
        Lapor 'server API' 'dihidupkan oleh verify.ps1'
      } else {
        Lapor 'server API' ("GAGAL hidup - lihat " + (Join-Path $Log 'api-server.txt'))
        $Gagal.Add('server API tidak mau hidup'); $siap = $false
      }
    }

    # `next start` menolak berjalan tanpa build. Kalau server web sudah hidup,
    # build DILEWATI - membangun ulang di bawah server yang sedang melayani hanya
    # membuat hasil tes tidak dapat dipertanggungjawabkan.
    if (Test-Port $WebPort) {
      Lapor 'server web' 'sudah hidup - dipakai apa adanya, tidak akan dimatikan'
    } elseif ($siap) {
      $kode = Jalankan $web (Join-Path $Log 'web-build.txt') $Npx @('next', 'build')
      if ($kode -ne 0) { $Gagal.Add('build web gagal'); $siap = $false }
      if ($siap) {
        Hidupkan-Server $web $Npx @('next', 'start', '-p', "$WebPort") `
          (Join-Path $Log 'web-server.txt') (Join-Path $Log 'web-server.err.txt')
        $PortDihidupkan.Add($WebPort)
        if (Tunggu-Port $WebPort 30) {
          Lapor 'server web' 'dihidupkan oleh verify.ps1'
        } else {
          Lapor 'server web' ("GAGAL hidup - lihat " + (Join-Path $Log 'web-server.txt'))
          $Gagal.Add('server web tidak mau hidup'); $siap = $false
        }
      }
    }

    if ($siap) {
      $webLog = Join-Path $Log 'web.txt'
      Jalankan $web $webLog $Npx @('playwright', 'test') | Out-Null
      $webTeks = if (Test-Path $webLog) { Get-Content $webLog -Raw } else { '' }
      $mb = [regex]::Matches($webTeks, '(\d+) passed')
      $mg = [regex]::Matches($webTeks, '(\d+) failed')
      $browserLulus = if ($mb.Count) { [int]$mb[$mb.Count - 1].Groups[1].Value } else { 0 }
      $browserGagal = if ($mg.Count) { [int]$mg[$mg.Count - 1].Groups[1].Value } else { 0 }
      if ($browserGagal -ne 0) { $Gagal.Add("$browserGagal kasus browser gagal") }
      if ($browserLulus -ne $BrowserHarap) { $Gagal.Add("kasus browser $browserLulus, diharapkan $BrowserHarap") }
      Lapor 'browser' "$browserLulus lulus / $browserGagal gagal (diharapkan $BrowserHarap)"
    } else {
      # BUKAN "lulus dengan catatan": lapisan yang tidak dijalankan tidak boleh
      # terbaca seperti lapisan yang hijau.
      Lapor 'browser' 'TIDAK DIJALANKAN - server tidak siap'
    }
  } else {
    # Satu-satunya jalan menuju hijau tanpa lapisan browser, dan ia harus diminta
    # dengan sengaja. Karena itu ia dicetak, bukan didiamkan.
    Lapor 'browser' 'dilewati atas permintaan (-TanpaBrowser)'
  }

  $Selesai = $true
}
catch {
  # Kesalahan tak terduga BUKAN alasan untuk diam. Ia satu alasan MERAH seperti
  # yang lain, dan jejaknya disimpan di log supaya dapat dibaca.
  $Gagal.Add("verify.ps1 berhenti karena kesalahan: $($_.Exception.Message)")
  $_ | Out-String | Set-Content (Join-Path $Log 'kesalahan.txt')
}
finally { Bersihkan }

# -------------------------------------------------------------------- putusan
# Di LUAR try/catch: putusan harus tercetak pada setiap jalan keluar, termasuk
# jalan keluar yang tidak direncanakan.
if (-not $Selesai) { $Gagal.Add('verify.ps1 tidak selesai menjalankan seluruh lapisan') }

Write-Host ''
if ($Gagal.Count -eq 0) {
  Write-Host ("HIJAU: " + ($sqlN + $apiLulus + $browserLulus) + " kasus") -ForegroundColor Green
  Remove-Item $Log -Recurse -Force -ErrorAction SilentlyContinue
  exit 0
}
Write-Host 'MERAH:' -ForegroundColor Red
foreach ($g in $Gagal) { Write-Host "  - $g" }
Write-Host ''
Write-Host "keluaran lengkap: $Log"
exit 1
