import Link from 'next/link';
import { ButirMenu } from '@/lib/admin-api';
import { keluar } from '@/app/administration/actions';

/**
 * Kerangka konsol platform (DEMO-0409).
 *
 * KERANGKANYA BUKAN KERANGKA TENANT, dan itu disengaja: kerangka tenant memuat
 * nama tenant aktif, pemindah tenant, dan lonceng keamanan - tidak satu pun
 * berlaku di sini, karena session platform tidak membuka data tenant mana pun
 * (ADR-003 sec.2.1). Memakai kerangka yang sama akan membuat dua tempat yang
 * berbeda hak terlihat seperti satu tempat.
 *
 * Navigasinya dari `GET /me/menu` sama seperti kerangka tenant, dan isinya berbeda
 * karena policy database yang berbeda - bukan karena kode di sini menyaring
 * apa pun (migrasi 0021: context platform hanya melihat menu ber-context PLATFORM).
 * Halaman platform yang belum ada tidak akan muncul di navigasi, karena menunya
 * baru ditambahkan bersama halamannya.
 */
export default function KerangkaPlatform({
  menu,
  aktif,
  children,
}: {
  menu: ButirMenu[];
  aktif: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div>
            <span className="label-tenant">Context</span>
            <div className="tenant" data-testid="context-platform">
              Platform
            </div>
            <span className="tenant-id">tanpa tenant</span>
          </div>
          <div className="topbar-aksi">
            <form action={keluar}>
              <button className="ghost" type="submit" data-testid="logout">
                Keluar
              </button>
            </form>
          </div>
        </div>
        <nav className="nav" aria-label="Navigasi platform" data-testid="nav-platform">
          {menu.map((m) =>
            m.path === null ? (
              <span className="nav-grup" key={m.code} data-testid={`nav-grup-${m.code}`}>
                {m.label}
              </span>
            ) : (
              <Link
                key={m.code}
                href={m.path}
                data-testid={`nav-${m.code}`}
                aria-current={aktif === m.path ? 'page' : undefined}
                className={aktif === m.path ? 'nav-item aktif' : 'nav-item'}
              >
                {m.label}
              </Link>
            ),
          )}
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
