#!/usr/bin/env node
/**
 * Lint unit of work untuk kode berbasis Prisma (padanan api/scripts/lint-guc.mjs).
 *
 * Aturan (ADR-001 sec.3.9-3.10, Sprint Plan DEMO-0100/0102):
 *   - set_config(...) dan SET [LOCAL] app.*  -> hanya di uow.ts
 *   - $transaction(...)                        -> hanya di uow.ts
 *     (transaksi di tempat lain = transaksi tanpa set_config = RLS tanpa context)
 *   - new PrismaClient(...)                    -> hanya di db.ts
 *     (client kedua = pool kedua = jalan memutar di luar unit of work)
 *
 * Pemakaian: node scripts/lint-guc.mjs <dir> [<dir> ...]   (default: src)
 * Keluar 1 bila ada pelanggaran. Ini pemeriksaan teks, bukan analisis tipe:
 * ia menangkap kelalaian, bukan niat jahat (lihat ADR-001 sec.3.10).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const RULES = [
  { name: 'set_config', re: /set_config\s*\(/i, allowed: 'uow.ts' },
  { name: 'SET app.', re: /\bSET\s+(LOCAL\s+|SESSION\s+)?app\./i, allowed: 'uow.ts' },
  { name: '$transaction', re: /\$transaction\s*\(/, allowed: 'uow.ts' },
  { name: 'new PrismaClient', re: /new\s+PrismaClient\s*\(/, allowed: 'db.ts' },
];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' || n === 'generated' ? [] : walk(p);
    return /\.(ts|mts|cts|js|mjs)$/.test(n) ? [p] : [];
  });
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) dirs.push('src');

const found = [];
let files = 0;
for (const d of dirs) {
  for (const f of walk(d)) {
    files++;
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      for (const r of RULES) {
        if (r.re.test(code) && path.basename(f) !== r.allowed) {
          found.push(`${f}:${i + 1}: ${r.name} hanya boleh di ${r.allowed}`);
        }
      }
    });
  }
}

if (files === 0) {
  console.log('GAGAL: tidak ada berkas yang diperiksa - direktori salah?');
  process.exit(1);
}
if (found.length) {
  console.log(found.join('\n'));
  console.log(`${found.length} pelanggaran`);
  process.exit(1);
}
console.log(`OK (${files} berkas)`);
