"""Mutasi kode API slice 15 (menu sebagai data).

Satu mutasi boleh terdiri dari BEBERAPA suntingan: R7 memerlukan dekorator DAN
impornya, karena mutasi yang tidak terkompilasi hanya membuktikan penjaganya tipe -
bukan bahwa ada tes yang menolak perilakunya.

Jalankan dari folder ini:  DEMO_DB_SUPER_PASSWORD=... python3 slice15-api.py
"""

import os
import pathlib
import subprocess

API = pathlib.Path(os.environ.get('AKAR_API', '../api')).resolve()
TES = 'dist/test/slice15.test.js'

SERVICE = 'src/menus/menu.service.ts'
CONTROLLER = 'src/menus/menus.controller.ts'

MUT = [
    ('R1 deny-by-default menjadi allow-by-default', [
        (SERVICE,
         '      if (daftar.length === 0) return m.is_public_authenticated;',
         '      if (daftar.length === 0) return true;'),
    ]),
    ('R2 match_mode ALL diperlakukan sebagai ANY', [
        (SERVICE,
         "      return mode === 'ALL'\n"
         '        ? daftar.every((p) => hak.has(p.permission_code))\n'
         '        : daftar.some((p) => hak.has(p.permission_code));',
         '      return daftar.some((p) => hak.has(p.permission_code));'),
    ]),
    ('R3 pemangkasan grup tanpa anak dihapus', [
        (SERVICE,
         '        if (m.path === null && cucu.length === 0) continue;',
         '        if (false && m.path === null && cucu.length === 0) continue;'),
    ]),
    ('R4 urutan menu tidak ditentukan query', [
        (SERVICE, '       ORDER BY sort_order, code`,', '       `,'),
    ]),
    ('R5 saringan is_active dihapus', [
        (SERVICE, '       WHERE is_active = true\n', '       WHERE true\n'),
    ]),
    ('R6 DTO membocorkan kode permission', [
        (SERVICE,
         '        hasil.push({ code: m.code, label: m.label, path: m.path, icon: m.icon, children: cucu });',
         '        hasil.push({ code: m.code, label: m.label, path: m.path, icon: m.icon, children: cucu,'
         ' permissions: (peta.get(m.id) ?? []).map((p) => p.permission_code) } as any);'),
    ]),
    ('R7 /me/menu dijaga permission menus.read', [
        (CONTROLLER,
         "import { AuthenticatedWithSupport } from '../authz/access.decorator.js';",
         "import { AuthenticatedWithSupport, RequirePermission } from '../authz/access.decorator.js';"),
        (CONTROLLER, '  @AuthenticatedWithSupport()', "  @RequirePermission('menus.read')"),
    ]),
    ('R8 sesi support memakai permission membership', [
        (SERVICE,
         "      session.context_kind === 'SUPPORT'\n        ? supportPermissions(support!.scope)",
         "      false && session.context_kind === 'SUPPORT'\n        ? supportPermissions(support!.scope)"),
    ]),
]


def bangun():
    r = subprocess.run(['node', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
                       cwd=API, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr)[-400:]


def jalankan():
    r = subprocess.run(['node', '--test', '--test-concurrency=1', TES],
                       cwd=API, capture_output=True, text=True, env={**os.environ})
    keluaran = r.stdout + r.stderr
    gagal = [l.strip() for l in keluaran.splitlines()
             if l.strip().startswith('not ok') and 'slice 15 -' not in l]
    return ('# fail 0' in keluaran), gagal


for nama, suntingan in MUT:
    asli = {}
    lewati = False
    for rel, lama, baru in suntingan:
        p = API / rel
        teks = p.read_text()
        if teks.count(lama) != 1:
            print(f'{nama}: POLA TIDAK UNIK ({teks.count(lama)}x) pada {rel} - dilewati')
            lewati = True
            break
        asli.setdefault(rel, teks)
        p.write_text(teks.replace(lama, baru))
    if not lewati:
        rc, log = bangun()
        if rc != 0:
            baris = [l for l in log.splitlines() if 'error' in l.lower()][:1]
            print(f'{nama}: tertangkap KOMPILATOR -> {baris}')
        else:
            hijau, gagal = jalankan()
            print(f'{nama}: ' + ('LOLOS (tes tetap hijau!)' if hijau else f'tertangkap -> {gagal[:2]}'))
    for rel, teks in asli.items():
        (API / rel).write_text(teks)

bangun()
hijau, _ = jalankan()
print('baseline setelah pemulihan:', 'HIJAU' if hijau else 'MERAH <-- PERIKSA')
