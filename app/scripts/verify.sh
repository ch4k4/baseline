#!/usr/bin/env bash
# verify.sh - SATU perintah, SATU putusan.
#
# Sampai hari ini verifikasi adalah ritual tiga jendela: jalankan reset di satu
# jendela, suite API di jendela lain, suite browser di jendela ketiga, lalu BACA
# angkanya dengan mata dan bandingkan dengan ingatan. Dua hal yang salah dengan itu:
#
#   1. angka yang dibaca mata adalah tempat kesalahan. "127 lulus" terlihat hijau
#      walau seharusnya 155 - dan berkas tes yang diam-diam tidak ikut berjalan
#      (tes SQL dibaca dari FOLDER) tidak akan pernah terlihat;
#   2. tiga jendela berarti tiga kesempatan menjalankan yang salah, dengan urutan
#      yang salah, atau melewatkan satu.
#
# Berkas ini menjalankan seluruhnya dan membandingkan jumlahnya dengan
# `verify-expected.json`. Jumlah yang KURANG dari yang diharapkan adalah kegagalan,
# sama seperti tes yang merah - dan jumlah yang LEBIH juga, karena berarti
# seseorang menambah tes tanpa memperbarui angka yang dijaga.
#
# Pemakaian:
#   DEMO_DB_SUPER_PASSWORD=... ./verify.sh              # reset + SQL + API + browser
#   DEMO_DB_SUPER_PASSWORD=... ./verify.sh --tanpa-reset    # database dipakai apa adanya
#   DEMO_DB_SUPER_PASSWORD=... ./verify.sh --tanpa-browser  # tanpa lapisan browser
#
# Lapisan browser butuh server API (3001) dan web (3000). Berkas ini MENGHIDUPKANNYA
# sendiri bila belum hidup, dan hanya mematikan yang ia hidupkan - server yang sudah
# berjalan sebelumnya dibiarkan apa adanya (dipakai, tidak dimatikan).
#
# Versi pertama menolak berjalan dan menyuruh orang menghidupkan server sendiri,
# dengan alasan "server yang dimatikan skrip tidak terlihat saat gagal". Alasan itu
# salah arah: akibatnya perintah default MERAH di setiap mesin yang bersih, sehingga
# orang belajar selalu mengetik --tanpa-browser - yaitu tepat keadaan "hijau dengan
# satu lapisan tidak berjalan" yang hendak dicegah. Logya tetap disimpan dan
# dicetak saat gagal, jadi kekhawatiran "tidak terlihat" terjawab tanpa membayar itu.
set -uo pipefail

AKAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARAP="$AKAR/scripts/verify-expected.json"
API_URL="${API_BASE_URL:-http://127.0.0.1:3001}"
WEB_URL="${WEB_BASE_URL:-http://127.0.0.1:3000}"

RESET=1
BROWSER=1
for arg in "$@"; do
  case "$arg" in
    --tanpa-reset)   RESET=0 ;;
    --tanpa-browser) BROWSER=0 ;;
    *) echo "argumen tidak dikenal: $arg" >&2; exit 2 ;;
  esac
done

: "${DEMO_DB_SUPER_PASSWORD:?DEMO_DB_SUPER_PASSWORD belum diset}"

harap() { python3 -c "import json,sys; print(json.load(open('$HARAP'))['$1'])"; }
SQL_HARAP=$(harap sql)
SQL_BERKAS_HARAP=$(harap sqlFiles)
API_HARAP=$(harap api)
BROWSER_HARAP=$(harap browser)

LOG="$(mktemp -d)"
GAGAL=()
lapor() { printf '%-28s %s\n' "$1" "$2"; }

# Hanya PID yang DIHIDUPKAN berkas ini yang masuk daftar; server yang sudah hidup
# sebelumnya tidak, dan karena itu tidak pernah dimatikan. Trap dipasang sekarang
# supaya server tetap dimatikan bila skrip dihentikan di tengah (Ctrl-C, timeout).
DIHIDUPKAN=()
bersihkan() {
  # Dimatikan per GRUP PROSES, bukan per PID: `npx next start` adalah pembungkus
  # yang menjalankan server sebagai anak, jadi membunuh PID yang terlihat akan
  # meninggalkan server hidup di port 3000 - dan jalankan berikutnya akan memakai
  # server basi itu sambil mengira menghidupkan yang baru.
  for pgid in ${DIHIDUPKAN+"${DIHIDUPKAN[@]}"}; do kill -- -"$pgid" 2>/dev/null || true; done
}
trap bersihkan EXIT INT TERM

# jalankan_server <berkas-pid> <berkas-log> <direktori> <perintah...>
# setsid + `echo $$` dari DALAM anak: hanya dengan begitu yang tercatat adalah id
# grup proses yang baru, bukan PID pembungkus yang sudah keluar lebih dulu.
jalankan_server() {
  local pidfile="$1" logfile="$2" dir="$3"; shift 3
  setsid bash -c 'echo $$ > "$1"; cd "$2"; shift 2; exec "$@"' _ "$pidfile" "$dir" "$@" \
    > "$logfile" 2>&1 < /dev/null &
  for _ in 1 2 3 4 5; do [ -s "$pidfile" ] && break; sleep 1; done
  cat "$pidfile" 2>/dev/null
}

hidup_api() { curl -s -o /dev/null -m 3 -X POST "$API_URL/api/v1/auth/login"; }
hidup_web() { curl -s -o /dev/null -m 3 "$WEB_URL/login"; }

# tunggu <fungsi-probe> <detik>
tunggu() {
  local probe="$1" batas="$2" i
  for ((i = 0; i < batas; i++)); do "$probe" && return 0; sleep 1; done
  return 1
}

# ------------------------------------------------------------------ database
# Alasan gagal MENYEBUTKAN baris terakhir lognya. Tanpa itu "tes SQL gagal" tidak
# membedakan tes yang benar-benar merah dari database yang tidak dapat dihubungi sama
# sekali - dan keduanya menuntut tindakan yang berbeda.
alasan_terakhir() {
  [ -f "$1" ] || { echo "(tanpa log)"; return; }
  grep -v '^[[:space:]]*$' "$1" | tail -3 | paste -sd'|' || echo "(log kosong)"
}

if [ "$RESET" = "1" ]; then AKSI_DB=reset; APA_DB="reset database gagal"; else AKSI_DB=test; APA_DB="tes SQL gagal"; fi
"$AKAR/db/scripts/db.sh" "$AKSI_DB" > "$LOG/db.txt" 2>&1
KODE_DB=$?   # diambil SEGERA: $? berikutnya sudah milik perintah lain
[ "$KODE_DB" = "0" ] || GAGAL+=("$APA_DB (kode $KODE_DB): $(alasan_terakhir "$LOG/db.txt")")

# Jumlah kasus SQL = jumlah "SEMUA n KASUS" + kasus tunggal yang dilaporkan sendiri.
SQL_N=$(( $(grep -oE 'SEMUA [0-9]+ KASUS' "$LOG/db.txt" | grep -oE '[0-9]+' | paste -sd+ | bc 2>/dev/null || echo 0) \
        + $(grep -cE 'KASUS [0-9]+ SLICE [0-9]+ LULUS' "$LOG/db.txt" || true) ))
SQL_BERKAS=$(ls "$AKAR"/db/tests/*_test.sql 2>/dev/null | wc -l | tr -d ' ')
# 'ERROR:' berikut titik duanya - bentuk yang benar-benar dipakai psql. Aturannya harus
# SATU dengan verify.ps1, tempat pola longgar `ERROR` pernah cocok dengan kata
# `NativeCommandError` di hiasan PowerShell dan memerahkan jalur yang seluruhnya lulus.
grep -q 'ERROR:' "$LOG/db.txt" && GAGAL+=("tes SQL memuat ERROR")
[ "$SQL_N" = "$SQL_HARAP" ] || GAGAL+=("kasus SQL $SQL_N, diharapkan $SQL_HARAP")
[ "$SQL_BERKAS" = "$SQL_BERKAS_HARAP" ] || GAGAL+=("berkas tes SQL $SQL_BERKAS, diharapkan $SQL_BERKAS_HARAP")
lapor "SQL" "$SQL_N kasus / $SQL_BERKAS berkas (diharapkan $SQL_HARAP / $SQL_BERKAS_HARAP)"

# ----------------------------------------------------------------------- API
( cd "$AKAR/api" && node node_modules/typescript/bin/tsc -p tsconfig.json ) > "$LOG/build.txt" 2>&1 \
  || GAGAL+=("build API gagal")
# DUA reporter sekaligus: `spec` ke log (untuk dibaca orang) dan `tap` ke berkas
# tersendiri (untuk dibaca skrip ini). Angka TIDAK PERNAH diambil dari log.
#
# Di sini pola lama kebetulan bekerja, tetapi di Windows tidak: reporter `spec` menulis
# `<U+2139> pass 155`, konsol Windows mengubah simbol UTF-8 itu menjadi tiga karakter
# sampah, dan `pass` terbaca 0 - 155 kasus yang LULUS dilaporkan MERAH. Aturan
# menghitungnya harus SATU untuk kedua skrip, jadi keduanya membaca TAP: ditulis node
# sendiri ke berkas, murni ASCII, bentuknya sama di sistem operasi mana pun.
( cd "$AKAR/api" && node --test --test-concurrency=1 \
    --test-reporter=spec --test-reporter-destination=stdout \
    --test-reporter=tap --test-reporter-destination="$LOG/api-tap.txt" \
    dist/test/*.test.js ) > "$LOG/api.txt" 2>&1
if [ ! -f "$LOG/api-tap.txt" ]; then
  # Tidak ada angka berarti tidak ada bukti. Itu MERAH, bukan nol yang didiamkan.
  GAGAL+=("keluaran TAP suite API tidak ada - jumlah kasus tidak dapat dibaca")
  API_LULUS=0; API_GAGAL=1
else
  API_LULUS=$(grep -oE '^# pass [0-9]+' "$LOG/api-tap.txt" | grep -oE '[0-9]+' || echo 0)
  API_GAGAL=$(grep -oE '^# fail [0-9]+' "$LOG/api-tap.txt" | grep -oE '[0-9]+' || echo 1)
  [ "$API_GAGAL" = "0" ] || GAGAL+=("$API_GAGAL kasus API gagal")
  [ "$API_LULUS" = "$API_HARAP" ] || GAGAL+=("kasus API $API_LULUS, diharapkan $API_HARAP")
fi
lapor "API" "$API_LULUS lulus / $API_GAGAL gagal (diharapkan $API_HARAP)"

( cd "$AKAR/api" && npm run lint:guc --silent ) > "$LOG/lint.txt" 2>&1 || GAGAL+=("lint:guc gagal")
lapor "lint:guc" "$(tail -1 "$LOG/lint.txt")"

# ------------------------------------------------------------------- browser
if [ "$BROWSER" = "1" ]; then
  SIAP=1

  # API: dist sudah dibangun oleh langkah API di atas, jadi tinggal dijalankan.
  if hidup_api; then
    lapor "server API" "sudah hidup - dipakai apa adanya, tidak akan dimatikan"
  else
    DIHIDUPKAN+=("$(jalankan_server "$LOG/api.pid" "$LOG/api-server.txt" "$AKAR/api" node dist/src/main.js)")
    if tunggu hidup_api 25; then
      lapor "server API" "dihidupkan oleh verify.sh"
    else
      lapor "server API" "GAGAL hidup - lihat $LOG/api-server.txt"
      GAGAL+=("server API tidak mau hidup"); SIAP=0
    fi
  fi

  # Web: `next start` menolak berjalan tanpa build, jadi build dulu. Kalau server
  # web sudah hidup, build DILEWATI - membangun ulang di bawah server yang sedang
  # melayani hanya akan membuat hasil tes tidak dapat dipertanggungjawabkan.
  if hidup_web; then
    lapor "server web" "sudah hidup - dipakai apa adanya, tidak akan dimatikan"
  elif [ "$SIAP" = "1" ]; then
    ( cd "$AKAR/web" && npx next build ) > "$LOG/web-build.txt" 2>&1 || {
      GAGAL+=("build web gagal"); SIAP=0
    }
    if [ "$SIAP" = "1" ]; then
      DIHIDUPKAN+=("$(jalankan_server "$LOG/web.pid" "$LOG/web-server.txt" "$AKAR/web" npx next start -p "${WEB_URL##*:}")")
      if tunggu hidup_web 30; then
        lapor "server web" "dihidupkan oleh verify.sh"
      else
        lapor "server web" "GAGAL hidup - lihat $LOG/web-server.txt"
        GAGAL+=("server web tidak mau hidup"); SIAP=0
      fi
    fi
  fi

  if [ "$SIAP" = "1" ]; then
    ( cd "$AKAR/web" && npx playwright test ) > "$LOG/web.txt" 2>&1
    BROWSER_LULUS=$(grep -oE '[0-9]+ passed' "$LOG/web.txt" | tail -1 | grep -oE '[0-9]+' || echo 0)
    BROWSER_GAGAL=$(grep -oE '[0-9]+ failed' "$LOG/web.txt" | tail -1 | grep -oE '[0-9]+' || echo 0)
    [ "$BROWSER_GAGAL" = "0" ] || GAGAL+=("$BROWSER_GAGAL kasus browser gagal")
    [ "$BROWSER_LULUS" = "$BROWSER_HARAP" ] || GAGAL+=("kasus browser $BROWSER_LULUS, diharapkan $BROWSER_HARAP")
    lapor "browser" "$BROWSER_LULUS lulus / $BROWSER_GAGAL gagal (diharapkan $BROWSER_HARAP)"
  else
    # BUKAN "lulus dengan catatan": lapisan yang tidak dijalankan tidak boleh
    # terbaca seperti lapisan yang hijau.
    lapor "browser" "TIDAK DIJALANKAN - server tidak siap"
  fi
else
  # Satu-satunya jalan menuju hijau tanpa lapisan browser, dan ia harus diminta
  # dengan sengaja. Karena itu ia dicetak, bukan didiamkan.
  lapor "browser" "dilewati atas permintaan (--tanpa-browser)"
fi

# -------------------------------------------------------------------- putusan
echo
if [ ${#GAGAL[@]} -eq 0 ]; then
  echo "HIJAU: $(( SQL_N + API_LULUS + ${BROWSER_LULUS:-0} )) kasus"
  rm -rf "$LOG"
  exit 0
fi
echo "MERAH:"
for g in "${GAGAL[@]}"; do echo "  - $g"; done
echo
echo "keluaran lengkap: $LOG"
exit 1
