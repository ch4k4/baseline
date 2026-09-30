#!/usr/bin/env node
/**
 * DEMO-0100 butir "prisma migrate drift behavior terhadap objek SQL manual".
 *
 * Tidak mengubah database. Dua pertanyaan yang dijawab:
 *
 *   A. Apa yang DILIHAT Prisma dari database demo? (`prisma db pull --print`)
 *      -> drift/pulled.prisma, plus peringatan yang dicetak CLI.
 *
 *   B. Kalau skema itu dijadikan sumber migrasi Prisma, apa yang HILANG?
 *      (`prisma migrate diff --from-empty --to-schema drift/pulled.prisma --script`)
 *      -> drift/from-empty.sql, lalu dihitung berapa kali muncul ROW LEVEL
 *         SECURITY, POLICY, FUNCTION, GRANT, dan CHECK di dalamnya.
 *
 * Butuh schema-engine Prisma (diunduh CLI dari binaries.prisma.sh saat pertama
 * kali dipakai). Terhubung sebagai app_owner - lihat prisma.config.ts.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
const out = path.join(root, 'drift');
mkdirSync(out, { recursive: true });

function prisma(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function fail(step, r) {
  console.log(`GAGAL di langkah ${step} (exit ${r.code})`);
  console.log(r.stderr.trim() || r.stdout.trim());
  process.exit(1);
}

// ---------------------------------------------------------------- A
const pull = prisma(['db', 'pull', '--print']);
if (pull.code !== 0) fail('A (db pull)', pull);
writeFileSync(path.join(out, 'pulled.prisma'), pull.stdout);

const models = [...pull.stdout.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
// Prisma menandai fitur yang tidak ia kelola dengan komentar di skema hasil pull.
const catatan = pull.stdout
  .split(/\r?\n/)
  .filter((l) => /row level security|check constraint|not supported|comment/i.test(l))
  .map((l) => l.trim());

// ---------------------------------------------------------------- B
const diff = prisma([
  'migrate', 'diff',
  '--from-empty',
  '--to-schema', path.join('drift', 'pulled.prisma'),
  '--script',
]);
if (diff.code !== 0) fail('B (migrate diff)', diff);
writeFileSync(path.join(out, 'from-empty.sql'), diff.stdout);

const sql = diff.stdout;
const hitung = (re) => (sql.match(re) ?? []).length;
const hasil = {
  'CREATE TABLE': hitung(/CREATE TABLE/gi),
  'ROW LEVEL SECURITY': hitung(/ROW LEVEL SECURITY/gi),
  'CREATE POLICY': hitung(/CREATE POLICY/gi),
  'CREATE FUNCTION': hitung(/CREATE (OR REPLACE )?FUNCTION/gi),
  GRANT: hitung(/\bGRANT\b/gi),
  CHECK: hitung(/\bCHECK\s*\(/gi),
};

// Pembanding: berapa objek itu yang sebenarnya ada di migrasi SQL demo.
const migDir = path.resolve(root, '..', 'db', 'migrations');
let sumber = '';
try {
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(migDir).filter((n) => n.endsWith('.sql')).sort()) {
    sumber += readFileSync(path.join(migDir, f), 'utf8') + '\n';
  }
} catch {
  /* folder migrasi tidak ada: pembanding dilewati */
}
const hitungSumber = (re) => (sumber.match(re) ?? []).length;

console.log(`A. db pull: ${models.length} model -> drift/pulled.prisma`);
console.log(`   ${models.join(', ')}`);
if (catatan.length) {
  console.log('   catatan Prisma di skema hasil pull:');
  for (const c of [...new Set(catatan)].slice(0, 12)) console.log(`     ${c}`);
} else {
  console.log('   (tidak ada catatan RLS/CHECK di skema hasil pull)');
}
console.log('');
console.log('B. migrasi yang akan dibuat Prisma dari skema itu -> drift/from-empty.sql');
console.log('   objek                 dari Prisma   di db/migrations');
for (const [k, v] of Object.entries(hasil)) {
  const re = {
    'CREATE TABLE': /CREATE TABLE/gi,
    'ROW LEVEL SECURITY': /ROW LEVEL SECURITY/gi,
    'CREATE POLICY': /CREATE POLICY/gi,
    'CREATE FUNCTION': /CREATE (OR REPLACE )?FUNCTION/gi,
    GRANT: /\bGRANT\b/gi,
    CHECK: /\bCHECK\s*\(/gi,
  }[k];
  console.log(`   ${k.padEnd(22)}${String(v).padStart(8)}${sumber ? String(hitungSumber(re)).padStart(18) : ''}`);
}
console.log('');
console.log('Salin seluruh keluaran ini ke percakapan; SPIKE_RESULT.md bagian "drift" diisi darinya.');
