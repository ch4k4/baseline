#!/usr/bin/env bash
# mutations/verify.sh - uji mutasi untuk PENJAGA-nya sendiri: app/scripts/verify.sh
#
# verify.sh adalah satu-satunya hal yang berdiri antara "saya sudah menjalankan tes"
# dan "tes itu benar-benar berjalan". Kalau ia sendiri tidak pernah dibuktikan dapat
# MERAH, ia bukan penjaga - ia hiasan yang selalu mengatakan hijau.
#
# Tiga aturan membaca (sama dengan mutations/README.md):
#   1. mutasi yang SELAMAT adalah temuan, bukan kesalahan skrip ini;
#   2. mutasi yang tertangkap KASUS YANG SALAH juga temuan - penjaga yang benar
#      harus menyebut lapisan yang benar;
#   3. sesudah tiap mutasi keadaan dikembalikan, dan pengembaliannya DIPERIKSA.
#
# Pemakaian:
#   DEMO_DB_SUPER_PASSWORD=... ./verify.sh            # semua kasus
#   DEMO_DB_SUPER_PASSWORD=... ./verify.sh V1 V4      # kasus tertentu
#
# CATATAN BIAYA: tiap kasus menjalankan seluruh suite (2-5 menit). Itu memang
# harganya - mutasi yang dijalankan di atas suite tiruan tidak membuktikan apa pun
# tentang suite yang sebenarnya.
set -uo pipefail

AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFY="$AKAR/scripts/verify.sh"
HARAP="$AKAR/scripts/verify-expected.json"
TMP="${TMPDIR:-/tmp}/mutasi-verify.$$"
mkdir -p "$TMP"

: "${DEMO_DB_SUPER_PASSWORD:?DEMO_DB_SUPER_PASSWORD belum diset}"

LULUS=0; SELAMAT=0
pilih=("$@")
mau() { [ ${#pilih[@]} -eq 0 ] && return 0; for p in "${pilih[@]}"; do [ "$p" = "$1" ] && return 0; done; return 1; }

# jalankan verifikator dan simpan keluarannya; mengembalikan kode keluarnya.
#
# MUTASI_VERIFIER=ps1 menjalankan verify.ps1 (lewat pwsh) alih-alih verify.sh.
# Dua berkas yang menjaga hal yang sama harus DIBUKTIKAN dengan mutasi yang sama;
# port yang hanya di-parse, tidak dijalankan, adalah port yang belum diuji.
VERIFIKATOR="${MUTASI_VERIFIER:-sh}"
jalan() {
  local out="$1"; shift
  if [ "$VERIFIKATOR" = "ps1" ]; then
    local -a a=(-TanpaReset)
    for x in "$@"; do
      case "$x" in
        --tanpa-browser) a+=(-TanpaBrowser) ;;
        --tanpa-reset)   ;;                       # sudah ada
        *) a+=("$x") ;;
      esac
    done
    pwsh -NoProfile -File "$AKAR/scripts/verify.ps1" "${a[@]}" > "$out" 2>&1
  else
    "$VERIFY" --tanpa-reset "$@" > "$out" 2>&1
  fi
  echo $?
}

# nilai <kode> <berkas-keluaran> <pola-alasan-yang-diharapkan> <nama>
nilai() {
  local kode="$1" out="$2" pola="$3" nama="$4"
  if [ "$kode" = "0" ]; then
    echo "  SELAMAT  $nama - verify.sh mengatakan HIJAU padahal dirusak"; SELAMAT=$((SELAMAT + 1)); return
  fi
  if grep -qE "$pola" "$out"; then
    echo "  tertangkap  $nama"; LULUS=$((LULUS + 1))
  else
    # Aturan 2: merah karena sebab lain sama buruknya dengan selamat.
    echo "  SALAH KASUS  $nama - merah, tetapi alasannya bukan '$pola':"
    grep -A20 '^MERAH' "$out" | head -8 | sed 's/^/      /'
    SELAMAT=$((SELAMAT + 1))
  fi
}

# ubah satu angka di verify-expected.json, lalu kembalikan.
with_harap() {
  local kunci="$1" nilai_baru="$2" nama="$3" pola="$4"; shift 4
  cp "$HARAP" "$TMP/harap.bak"
  python3 - "$HARAP" "$kunci" "$nilai_baru" <<'PY'
import json, sys
p, k, v = sys.argv[1], sys.argv[2], int(sys.argv[3])
d = json.load(open(p)); d[k] = v
open(p, 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
PY
  local kode; kode=$(jalan "$TMP/out.txt" "$@")
  cp "$TMP/harap.bak" "$HARAP"
  cmp -s "$TMP/harap.bak" "$HARAP" || { echo "  PENGEMBALIAN GAGAL: $HARAP"; exit 9; }
  nilai "$kode" "$TMP/out.txt" "$pola" "$nama"
}

echo "== uji mutasi verify.sh =="

# ---------------------------------------------------------------- V1..V4
# Empat angka yang dijaga, empat perbandingan terpisah di verify.sh. Diuji
# satu-satu karena kesalahan yang paling mungkin - membandingkan variabel yang
# salah - hanya terlihat bila tiap angka digeser sendirian.
mau V1 && with_harap sql      116 "V1 jumlah kasus SQL"     "kasus SQL 117, diharapkan 116"        --tanpa-browser
mau V2 && with_harap sqlFiles  11 "V2 jumlah berkas tes SQL" "berkas tes SQL 12, diharapkan 11"    --tanpa-browser
mau V3 && with_harap api      154 "V3 jumlah kasus API"     "kasus API 155, diharapkan 154"        --tanpa-browser
mau V4 && with_harap browser   59 "V4 jumlah kasus browser" "kasus browser 60, diharapkan 59"

# ---------------------------------------------------------------- V5
# Satu tes API benar-benar dibuat gagal. Ini membuktikan verify.sh membaca
# `# fail n`, bukan hanya menghitung yang lulus - suite yang 154 lulus 1 gagal
# tidak boleh lolos hanya karena angkanya "hampir" benar.
if mau V5; then
  # Ditambahkan sebagai berkas baru, bukan dengan merusak tes yang ada: dengan cara
  # ini yang LULUS tetap 155, sehingga satu-satunya alasan merah yang mungkin adalah
  # pembacaan `# fail n`. Merusak tes yang ada akan menggeser kedua angka sekaligus
  # dan membuat kasus ini tidak membuktikan apa-apa.
  T="$AKAR/api/test/zz-mutasi-v5.test.ts"
  printf "import { test } from 'node:test';\ntest('MUTASI V5', () => {\n  throw new Error('MUTASI V5');\n});\n" > "$T"
  kode=$(jalan "$TMP/out.txt" --tanpa-browser)
  rm -f "$T" "$AKAR/api/dist/test/zz-mutasi-v5.test.js"
  { [ ! -f "$T" ] && [ ! -f "$AKAR/api/dist/test/zz-mutasi-v5.test.js" ]; } \
    || { echo "  PENGEMBALIAN GAGAL: sisa berkas mutasi V5"; exit 9; }
  nilai "$kode" "$TMP/out.txt" "kasus API gagal" "V5 satu tes API sungguh gagal"
fi

# ---------------------------------------------------------------- V6
# Satu berkas tes SQL disembunyikan. Inilah kegagalan yang TIDAK terlihat mata:
# suite tetap hijau, hanya lebih pendek. Dua alasan harus muncul - jumlah kasus
# dan jumlah berkas - karena masing-masing menangkap bentuk hilang yang berbeda.
if mau V6; then
  F="$AKAR/db/tests/slice16_test.sql"
  mv "$F" "$TMP/v6.sql"
  kode=$(jalan "$TMP/out.txt" --tanpa-browser)
  mv "$TMP/v6.sql" "$F"; [ -f "$F" ] || { echo "  PENGEMBALIAN GAGAL: $F"; exit 9; }
  nilai "$kode" "$TMP/out.txt" "berkas tes SQL 11, diharapkan 12" "V6 satu berkas tes SQL hilang"
  grep -q "kasus SQL 112, diharapkan 117" "$TMP/out.txt" \
    || echo "  CATATAN V6: jumlah kasus tidak ikut menuding - hanya jumlah berkas yang menangkap"
fi

# ---------------------------------------------------------------- V7
# lint:guc dibuat gagal. Lapisan ini bukan "tes" dan karena itu paling mudah
# diam-diam dilewati; verify.sh harus memerahkannya sama kerasnya.
if mau V7; then
  # Pelanggaran yang TETAP dapat dikompilasi: kalau tsc yang gagal lebih dulu,
  # yang terbukti adalah "build API gagal", bukan lint:guc - dan itu kasus lain.
  S="$AKAR/api/src/admin/admin-rules.ts"
  cp "$S" "$TMP/v7.bak"
  printf "\nexport const mutasiV7 = \"SELECT set_config('app.current_tenant_id', \$1, true)\";\n" >> "$S"
  kode=$(jalan "$TMP/out.txt" --tanpa-browser)
  cp "$TMP/v7.bak" "$S"; cmp -s "$TMP/v7.bak" "$S" || { echo "  PENGEMBALIAN GAGAL: $S"; exit 9; }
  nilai "$kode" "$TMP/out.txt" "lint:guc gagal" "V7 lint:guc dilanggar"
fi

# ---------------------------------------------------------------- V8
# Lapisan browser TIDAK DAPAT dijalankan (server web diarahkan ke port mati yang
# tidak dapat dihidupkan verify.sh karena bukan port miliknya). Yang diuji di sini
# bukan tesnya, melainkan bahwa lapisan yang tidak berjalan TIDAK terbaca hijau.
if mau V8; then
  # Web dibuat TIDAK DAPAT dibangun. Versi pertama kasus ini hanya mengarahkan
  # WEB_BASE_URL ke port lain - dan verify.sh dengan patuh menghidupkan server di
  # port itu, sehingga tidak ada yang gagal. Mutasi yang tidak merusak apa pun
  # bukan mutasi.
  W="$(ls "$AKAR/web/src/app/login/page.tsx" 2>/dev/null || find "$AKAR/web/src/app" -name 'page.tsx' 2>/dev/null | head -1)"
  [ -n "$W" ] || { echo "  TIDAK DAPAT DINILAI V8: berkas halaman web tidak ditemukan"; SELAMAT=$((SELAMAT + 1)); W=""; }
  if [ -n "$W" ]; then
    fuser -k 3000/tcp 2>/dev/null; sleep 2
    cp "$W" "$TMP/v8.bak"
    printf '\nconst mutasiV8: number = "bukan angka";\nexport const _v8 = mutasiV8;\n' >> "$W"
    kode=$(jalan "$TMP/out.txt")
    cp "$TMP/v8.bak" "$W"; cmp -s "$TMP/v8.bak" "$W" || { echo "  PENGEMBALIAN GAGAL: $W"; exit 9; }
    nilai "$kode" "$TMP/out.txt" "build web gagal" "V8 lapisan browser tidak dapat berjalan"
    grep -q '^HIJAU' "$TMP/out.txt" && { echo "  SELAMAT V8: tetap mencetak HIJAU"; SELAMAT=$((SELAMAT + 1)); }
  fi
fi

# ---------------------------------------------------------------- V9
# Server yang DIHIDUPKAN verify.sh harus mati sesudahnya; server yang sudah hidup
# sebelumnya harus TETAP hidup. Keduanya diperiksa pada jalur hijau, karena di
# situlah proses yatim paling mungkin lolos tanpa disadari.
if mau V9; then
  fuser -k 3000/tcp 3001/tcp 2>/dev/null; sleep 2
  kode=$(jalan "$TMP/out.txt")
  sleep 2
  sisa=""
  curl -s -o /dev/null -m 2 http://127.0.0.1:3000/login && sisa="$sisa web"
  curl -s -o /dev/null -m 2 -X POST http://127.0.0.1:3001/api/v1/auth/login && sisa="$sisa api"
  if [ "$kode" != "0" ]; then
    echo "  TIDAK DAPAT DINILAI V9: jalur hijau tidak hijau"; sed -n '/^MERAH/,$p' "$TMP/out.txt" | head -6 | sed 's/^/      /'
    SELAMAT=$((SELAMAT + 1))
  elif [ -n "$sisa" ]; then
    echo "  SELAMAT  V9 proses yatim -$sisa masih hidup sesudah verify.sh selesai"; SELAMAT=$((SELAMAT + 1))
  elif grep -qE "dihidupkan oleh verify\.(sh|ps1)" "$TMP/out.txt"; then
    echo "  tertangkap  V9 server dihidupkan lalu dimatikan bersih"; LULUS=$((LULUS + 1))
  else
    echo "  SALAH KASUS  V9 - hijau dan bersih, tetapi verify.sh tidak menghidupkan server apa pun"; SELAMAT=$((SELAMAT + 1))
  fi
fi

# ---------------------------------------------------------------- V10 (ps1)
# Hanya untuk verify.ps1: kesalahan tak terduga di tengah pekerjaan harus menjadi
# MERAH, bukan keluar diam-diam dengan kode 0.
#
# Ini regresi yang PERNAH TERJADI: dengan $ErrorActionPreference = 'Continue',
# satu parameter Start-Process yang tidak didukung pwsh/Linux menghentikan
# pekerjaan tanpa mencetak putusan apa pun, dan berkas itu keluar 0. Kasus ini
# ada supaya cacat itu tidak dapat kembali tanpa ketahuan.
if [ "$VERIFIKATOR" = "ps1" ] && mau V10; then
  P="$AKAR/scripts/verify.ps1"
  cp "$P" "$TMP/v10.bak"
  python3 - "$P" <<'PY'
import sys
p = sys.argv[1]
b = open(p, 'rb').read()
bom, s = (b[:3], b[3:].decode('ascii')) if b[:3] == b'\xef\xbb\xbf' else (b'', b.decode('ascii'))
tanda = "\ntry {\n"
i = s.index(tanda) + len(tanda)
open(p, 'wb').write(bom + (s[:i] + "  throw 'MUTASI V10'\n" + s[i:]).encode('ascii'))
PY
  kode=$(jalan "$TMP/out.txt" --tanpa-browser)
  cp "$TMP/v10.bak" "$P"; cmp -s "$TMP/v10.bak" "$P" || { echo "  PENGEMBALIAN GAGAL: $P"; exit 9; }
  if [ "$kode" = "0" ]; then
    echo "  SELAMAT  V10 kesalahan tak terduga - keluar dengan kode 0"; SELAMAT=$((SELAMAT + 1))
  elif grep -q '^MERAH' "$TMP/out.txt" && grep -q 'berhenti karena kesalahan' "$TMP/out.txt"; then
    echo "  tertangkap  V10 kesalahan tak terduga jadi MERAH, bukan diam"; LULUS=$((LULUS + 1))
  else
    echo "  SALAH KASUS  V10 - keluar bukan-nol tetapi tanpa putusan MERAH yang menyebut sebabnya"
    head -12 "$TMP/out.txt" | sed 's/^/      /'
    SELAMAT=$((SELAMAT + 1))
  fi
fi

# ---------------------------------------------------------------- V11
# Pemeriksaan "log SQL memuat ERROR" TIDAK boleh cocok dengan kata yang kebetulan
# memuat "error". Ini satu-satunya kasus di berkas ini yang TIDAK menjalankan suite:
# regresinya hanya dapat muncul di Windows (hiasan `NativeCommandError` yang ditulis
# PowerShell saat perintah native memakai stderr), jadi yang diuji adalah POLANYA -
# dibaca langsung dari skrip, supaya melonggarkannya kembali akan ketahuan di sini.
#
# Jalur Windows keempat (2026-09-29): `-match 'ERROR'` cocok dengan `NativeCommandError`
# karena -match di PowerShell case-INSENSITIVE, dan 332 kasus yang lulus dilaporkan
# MERAH. Di bash pola yang sama tidak pernah bermasalah - grep case-sensitive.
if mau V11; then
  HIAS='    + FullyQualifiedErrorId : NativeCommandError'
  ASLI='psql:D:/app/db/tests/slice1_test.sql:12: ERROR:  permission denied'
  salah=0

  # verify.sh: pola diambil dari baris grep yang sesungguhnya dipakai.
  pola_sh=$(grep -oE "grep -q '[^']+' \"\\\$LOG/db\.txt\"" "$VERIFY" | head -1 | sed -E "s/.*grep -q '([^']+)'.*/\1/")
  if [ -z "$pola_sh" ]; then
    echo "  TIDAK DAPAT DINILAI V11: pola ERROR tidak ditemukan di verify.sh"; salah=1
  else
    echo "$HIAS" | grep -q "$pola_sh" && { echo "  SELAMAT  V11/sh pola '$pola_sh' cocok dengan hiasan PowerShell"; salah=1; }
    echo "$ASLI" | grep -q "$pola_sh" || { echo "  SELAMAT  V11/sh pola '$pola_sh' TIDAK cocok dengan ERROR psql sungguhan"; salah=1; }
  fi

  # verify.ps1: harus memakai -cmatch (case-sensitive), dan polanya diuji di pwsh.
  baris_ps=$(grep -oE '\$dbTeks -c?match .+\{' "$AKAR/scripts/verify.ps1" | head -1)
  case "$baris_ps" in
    *-cmatch*) : ;;
    *) echo "  SELAMAT  V11/ps1 memakai -match (case-insensitive), bukan -cmatch"; salah=1 ;;
  esac
  pola_ps=$(printf '%s' "$baris_ps" | sed -E "s/.*-c?match '([^']+)'.*/\1/")
  if [ -n "$pola_ps" ] && command -v pwsh >/dev/null; then
    hasil=$(pwsh -NoProfile -Command "
      \$h = '$HIAS'; \$a = '$ASLI'; \$p = '$pola_ps'
      if (\$h -cmatch \$p) { 'HIAS_COCOK' }
      if (-not (\$a -cmatch \$p)) { 'ASLI_TIDAK_COCOK' }
      'SELESAI'")
    case "$hasil" in
      *HIAS_COCOK*)       echo "  SELAMAT  V11/ps1 pola '$pola_ps' cocok dengan hiasan PowerShell"; salah=1 ;;
    esac
    case "$hasil" in
      *ASLI_TIDAK_COCOK*) echo "  SELAMAT  V11/ps1 pola '$pola_ps' TIDAK cocok dengan ERROR psql sungguhan"; salah=1 ;;
    esac
  fi

  if [ "$salah" = "0" ]; then
    echo "  tertangkap  V11 pola ERROR menyempit ke ERROR psql, bukan kata apa pun ber-'error'"
    LULUS=$((LULUS + 1))
  else
    SELAMAT=$((SELAMAT + 1))
  fi
fi

echo
echo "verifikator: $VERIFIKATOR"
echo "tertangkap: $LULUS   perlu ditindak: $SELAMAT"
rm -rf "$TMP"
[ "$SELAMAT" -eq 0 ]
