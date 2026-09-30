"""Mutasi kode API slice 16 (provisioning tenant).

Jalankan dari folder ini:  DEMO_DB_SUPER_PASSWORD=... python3 slice16-api.py
"""

import os
import pathlib
import subprocess

API = pathlib.Path(os.environ.get('AKAR_API', '../api')).resolve()
TES = 'dist/test/slice16.test.js'
SVC = 'src/platform/tenant-provisioning.service.ts'

MUT = [
    ('Q1 status tenant tidak dinaikkan menjadi ACTIVE', [
        (SVC,
         """      await tx.query(`UPDATE tenants SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [
        tenantId,
      ]);""",
         "      // mutasi: pintu provisioning dibiarkan terbuka"),
    ]),
    ('Q2 hasil NULL dari F-28 tidak diperiksa', [
        (SVC, '      if (!membership) {', '      if (false) {'),
    ]),
    ('Q3 audit hanya sisi platform', [
        (SVC, '    for (const tenantIdAudit of [null, tenantId]) {', '    for (const tenantIdAudit of [null]) {'),
    ]),
    ('Q4 nama owner masuk ke detail audit', [
        (SVC,
         "        detail: { ownerUserId: permintaan.ownerUserId, via: 'platform-provisioning' },",
         "        detail: { ownerUserId: permintaan.ownerUserId, via: 'platform-provisioning', nama: displayName },"),
    ]),
    ('Q5 kunci dibaca dari database, bukan yang baru dicetak', [
        (SVC,
         '      const nama = kunci.seal(FIELDS.profileDisplayName, profileId, displayName);',
         '      const nama = await this.crypto.encrypt(FIELDS.profileDisplayName, tenantId, profileId, displayName);'),
    ]),
    ('Q6 hanya satu purpose kunci yang disimpan', [
        (SVC, '      for (const k of kunci.wrapped) {', '      for (const k of kunci.wrapped.slice(0, 1)) {'),
    ]),
    ('Q7 bentrokan slug menjadi kesalahan server', [
        (SVC,
         "        if (sqlState(error) === '23505') throw new ConflictException(`slug \"${slug}\" sudah dipakai`);",
         '        // mutasi: bentrokan slug tidak lagi dibedakan'),
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
             if l.strip().startswith('not ok') and 'slice 16 -' not in l]
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
            print(f'{nama}: tertangkap KOMPILATOR -> {[l for l in log.splitlines() if "error" in l.lower()][:1]}')
        else:
            hijau, gagal = jalankan()
            print(f'{nama}: ' + ('LOLOS (tes tetap hijau!)' if hijau else f'tertangkap -> {gagal[:2]}'))
    for rel, teks in asli.items():
        (API / rel).write_text(teks)

bangun()
hijau, _ = jalankan()
print('baseline setelah pemulihan:', 'HIJAU' if hijau else 'MERAH <-- PERIKSA')
