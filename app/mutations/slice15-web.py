import subprocess, pathlib, os
WEB = pathlib.Path(os.environ.get('AKAR_WEB', '../web'))
MUT = [
 ("W1 kerangka mengabaikan menu dari API", "src/components/Kerangka.tsx",
  "  const tautan = daftarRata(menu);", "  const tautan = daftarRata(menu).slice(0, 0);"),
 ("W2 kartu dasbor menawarkan dirinya sendiri", "src/app/dashboard/page.tsx",
  "n.path !== null && n.path !== '/dashboard'", "n.path !== null"),
 ("W3 grup dirender seperti tautan biasa", "src/components/Kerangka.tsx",
  "    return (\n      <span className=\"nav-grup\" data-testid={`nav-grup-${butir.code}`}>\n        {butir.label}\n      </span>\n    );",
  "    return (\n      <a className=\"nav-item\" data-testid={`nav-grup-${butir.code}`}>\n        {butir.label}\n      </a>\n    );"),
]
env = {**os.environ, **({'PW_CHROMIUM_PATH': os.environ['PW_CHROMIUM_PATH']} if 'PW_CHROMIUM_PATH' in os.environ else {}), 'DEMO_DB_SUPER_PASSWORD': os.environ['DEMO_DB_SUPER_PASSWORD']}
def restart():
    r = subprocess.run(['bash', str(pathlib.Path(__file__).parent / 'restart-web.sh')], capture_output=True, text=True, env=env)
    return r.stdout.strip()
def run():
    r = subprocess.run(['npx','playwright','test','test/slice15.spec.ts'], cwd=WEB, capture_output=True, text=True, env=env)
    out = r.stdout + r.stderr
    return ('failed' not in out), out
for nama, rel, old, new in MUT:
    p = WEB/rel; asli = p.read_text()
    if asli.count(old)!=1:
        print(f"{nama}: POLA TIDAK UNIK ({asli.count(old)})"); continue
    p.write_text(asli.replace(old,new))
    st = restart()
    if not st.endswith('SIAP'):
        print(f"{nama}: tertangkap BUILD/START -> {st}")
    else:
        ok,out = run()
        gagal=[l.strip()[:95] for l in out.splitlines() if '✘' in l]
        print(f"{nama}: {'LOLOS (tes tetap hijau!)' if ok else 'tertangkap -> '+str(gagal[:2])}")
    p.write_text(asli)
print("pulih:", restart())
ok,_=run(); print("baseline:", "HIJAU" if ok else "MERAH <-- PERIKSA")
