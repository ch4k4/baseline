/**
 * Menjaga jalur ke database tetap SATU: unit of work (ADR-001 §3.9-3.10).
 *
 *   set_config('app.*') / SET [LOCAL] app.*  -> hanya src/database/unit-of-work.ts
 *   $transaction(...)                          -> hanya src/database/unit-of-work.ts
 *       transaksi di tempat lain = transaksi tanpa set_config = RLS tanpa context
 *   new PrismaClient(...)                      -> hanya src/database/prisma.ts
 *       client kedua = jalan memutar di luar unit of work
 *
 * Tanpa pemeriksa, aturan itu hanya niat baik. Ini pemeriksaan teks: menangkap
 * kelalaian, bukan niat jahat (ADR-001 §3.10).
 *
 * Pemakaian: node scripts/lint-guc.mjs [akar]   (default: folder api/)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, bukan .pathname: di Windows .pathname menghasilkan "/D:/...".
const ROOT = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('..', import.meta.url));

const UOW = 'src/database/unit-of-work.ts';
const RULES = [
  { name: "set_config('app.*')", re: /set_config\s*\(\s*['"`]app\./, allowed: UOW },
  { name: 'SET app.*', re: /\bSET\s+(LOCAL\s+|SESSION\s+)?app\./i, allowed: UOW },
  { name: '$transaction', re: /\$transaction\s*\(/, allowed: UOW },
  // Sejak DEMO-0312: READ ONLY transaksi adalah lapisan kedua support session
  // (ADR-003 §2.3). Dipasang di unit of work, tepat sebelum query pertama -
  // dipasang di tempat lain, ia diam-diam tidak berlaku.
  { name: 'SET TRANSACTION', re: /\bSET\s+TRANSACTION\b/i, allowed: UOW },
  // TimeZone dipatok UTC di unit of work (lihat komentar di sana: Prisma salah
  // membaca timestamptz bila TimeZone sesi bukan UTC). Dipatok di tempat lain -
  // atau diubah kembali - berarti dua pendapat tentang arti sebuah waktu.
  { name: "set_config('TimeZone')", re: /set_config\s*\(\s*['"`]TimeZone/i, allowed: UOW },
  { name: 'new PrismaClient', re: /new\s+PrismaClient\s*\(/, allowed: 'src/database/prisma.ts' },
];

// generated: kode hasil `prisma generate` memuat definisi $transaction sendiri.
// fixtures: contoh pelanggaran untuk test/prisma.test.ts, diperiksa terpisah.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'generated', 'fixtures']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Baris komentar tidak dihitung: dokumentasi boleh menyebut aturan ini. */
function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

const files = walk(ROOT);
const offenders = [];
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (rel.startsWith('scripts/lint-guc')) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (isComment(line)) return;
      for (const r of RULES) {
        if (r.re.test(line) && rel !== r.allowed) {
          offenders.push(`${rel}:${i + 1}: ${r.name} hanya boleh di ${r.allowed}`);
        }
      }
    });
}

if (files.length === 0) {
  console.error('lint-guc: tidak ada berkas yang diperiksa - akar salah?');
  process.exit(1);
}
if (offenders.length > 0) {
  for (const o of offenders) console.error('  ' + o);
  console.error(`lint-guc: ${offenders.length} pelanggaran`);
  process.exit(1);
}
console.log('lint-guc: bersih');
