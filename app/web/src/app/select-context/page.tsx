import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { apiFetch, isTimeout } from '@/lib/api-fetch';
import {
  TICKET_COOKIE,
  getSessionToken,
  getTicket,
  setTokenCookies,
} from '@/lib/session';

/**
 * Halaman pemilihan tenant untuk identitas yang punya akses ke lebih dari satu.
 *
 * Tiket disimpan di cookie httpOnly terpisah, bukan di field tersembunyi pada
 * form. Field tersembunyi akan terbaca JavaScript mana pun yang berjalan di
 * halaman ini, dan tiket - walau berumur pendek - tetap kredensial.
 */

interface ContextItem {
  kind?: 'TENANT' | 'PLATFORM';
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
}

async function pilih(formData: FormData) {
  'use server';

  const kind = String(formData.get('kind') ?? 'TENANT');
  const tenantId = String(formData.get('tenantId') ?? '');
  const store = await cookies();
  const ticket = store.get(TICKET_COOKIE)?.value;

  // Context platform sengaja TIDAK membawa tenantId: permintaan yang isinya
  // bertentangan ditolak API, dan halaman ini tidak mengarangnya sendiri.
  if (!ticket || (kind === 'TENANT' && !tenantId)) redirect('/login?error=tiket');

  let res: Response;
  try {
    res = await apiFetch('/api/v1/auth/select-context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(kind === 'PLATFORM' ? { ticket, kind } : { ticket, tenantId }),
    });
  } catch (error) {
    // Permintaan yang habis waktu mungkin sudah membakar tiket di server; masuk
    // ulang adalah satu-satunya jalan yang pasti benar.
    redirect(isTimeout(error) ? '/login?error=lambat' : '/login?error=api');
  }

  // Tiket sekali pakai: apa pun hasilnya, tiket di sisi kita sudah tidak berguna.
  // Membiarkannya hanya menunda kebingungan ke percobaan berikutnya.
  store.delete(TICKET_COOKIE);
  store.delete('demo_ticket_contexts');

  if (!res.ok) redirect('/login?error=tiket');

  const body = (await res.json()) as { accessToken: string; refreshToken: string };
  setTokenCookies(store, body);
  // Session platform tidak punya tenant, jadi dasbor tenant bukan tempatnya
  // mendarat - halaman itu akan langsung menolaknya.
  redirect(kind === 'PLATFORM' ? '/platform/admins' : '/dashboard');
}

export default async function SelectContextPage() {
  if (await getSessionToken()) redirect('/dashboard');

  const ticket = await getTicket();
  if (!ticket) redirect('/login');

  const contexts: ContextItem[] = JSON.parse(ticket.contexts) as ContextItem[];

  return (
    <main>
      <h1>Pilih tempat masuk</h1>
      <p className="sub">
        Identitas Anda memiliki akses ke lebih dari satu tempat. Satu pilihan berlaku untuk sesi
        ini; hak di satu tempat tidak dibawa ke tempat lain.
      </p>

      <div className="card">
        {contexts.map((c) =>
          c.kind === 'PLATFORM' ? (
            // Context platform dipisahkan secara visual karena isinya berbeda
            // jenis: ia tidak membuka data tenant mana pun (ADR-003 sec.2.1).
            <form action={pilih} key="platform" style={{ marginBottom: 10 }}>
              <input type="hidden" name="kind" value="PLATFORM" />
              <button type="submit" data-testid="pilih-platform" style={{ width: '100%' }}>
                Platform (administrasi platform)
              </button>
            </form>
          ) : (
            <form action={pilih} key={c.tenantId} style={{ marginBottom: 10 }}>
              <input type="hidden" name="kind" value="TENANT" />
              <input type="hidden" name="tenantId" value={c.tenantId ?? ''} />
              <button type="submit" data-testid={`pilih-${c.tenantSlug}`} style={{ width: '100%' }}>
                {c.tenantName}
              </button>
            </form>
          ),
        )}
      </div>

      <p className="hint">
        Pilihan ini berlaku sekali. Tautan halaman ini tidak dapat dipakai ulang atau dibagikan:
        yang membawa bukti masuk Anda adalah tiket berumur pendek di cookie, bukan alamatnya.
      </p>
    </main>
  );
}

export const dynamic = 'force-dynamic';
