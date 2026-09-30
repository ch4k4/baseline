import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { apiFetch, isTimeout, PESAN_LAMBAT } from '@/lib/api-fetch';
import {
  TICKET_COOKIE,
  ticketCookieOptions,
  IS_PRODUCTION,
  getSessionToken,
  setTokenCookies,
} from '@/lib/session';

/**
 * Form login memakai server action, bukan fetch dari browser.
 * Akibatnya password tidak pernah melewati JavaScript klien, dan halaman ini
 * tetap berfungsi tanpa JavaScript sama sekali.
 */

interface LoginContext {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
}

async function login(formData: FormData) {
  'use server';

  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) redirect('/login?error=kosong');

  let res: Response;
  try {
    res = await apiFetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    // API macet dibedakan dari API mati: yang pertama perlu ditunggu, yang kedua
    // perlu dijalankan. Pesan yang sama untuk keduanya menyuruh orang menyalakan
    // server yang sudah menyala.
    redirect(isTimeout(error) ? '/login?error=lambat' : '/login?error=api');
  }

  // 429 dibedakan dari 401. Sebelumnya semua jawaban tidak-ok menjadi "Email atau
  // password salah", sehingga orang yang akunnya sedang dikunci rate limit
  // mengetik ulang password yang BENAR berkali-kali dan terus diberi tahu salah -
  // tiap percobaan memperpanjang kebingungannya (ditemukan audit tes 2026-09-21).
  //
  // Membedakannya tidak membocorkan keberadaan akun: API menjawab 429 yang sama
  // untuk email terdaftar maupun tidak (dijaga tes API slice 6 kasus 8).
  if (res.status === 429) redirect('/login?error=terkunci');
  if (!res.ok) redirect('/login?error=kredensial');

  const body = (await res.json()) as
    | { status: 'SESSION'; accessToken: string; refreshToken: string }
    | { status: 'CONTEXT_REQUIRED'; ticket: string; contexts: LoginContext[] };

  const store = await cookies();

  if (body.status === 'CONTEXT_REQUIRED') {
    // Tiket disimpan httpOnly; daftar tenant disimpan terpisah karena itu hanya
    // bahan tampilan, bukan kredensial. Memisahkan keduanya membuat jelas mana
    // yang rahasia dan mana yang tidak.
    store.set(TICKET_COOKIE, body.ticket, ticketCookieOptions(IS_PRODUCTION));
    store.set(
      'demo_ticket_contexts',
      JSON.stringify(body.contexts),
      { ...ticketCookieOptions(IS_PRODUCTION), httpOnly: false },
    );
    redirect('/select-context');
  }

  setTokenCookies(store, body);
  redirect('/dashboard');
}

const MESSAGES: Record<string, string> = {
  kosong: 'Email dan password wajib diisi.',
  kredensial: 'Email atau password salah.',
  api: 'API tidak dapat dihubungi. Pastikan sudah dijalankan di port 3001.',
  tiket: 'Pemilihan tenant kedaluwarsa atau sudah dipakai. Silakan masuk lagi.',
  terkunci: 'Terlalu banyak percobaan masuk. Tunggu beberapa menit, lalu coba lagi.',
  lambat: PESAN_LAMBAT,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tenants?: string }>;
}) {
  if (await getSessionToken()) redirect('/dashboard');

  const { error, tenants } = await searchParams;
  const message =
    error === 'context'
      ? `Identitas ini punya akses ke lebih dari satu tenant (${tenants ?? ''}). Pemilihan tenant belum tersedia - itu slice berikutnya.`
      : error
        ? (MESSAGES[error] ?? 'Terjadi kesalahan.')
        : null;

  return (
    <main>
      <h1>Masuk</h1>
      <p className="sub">Demo isolasi tenant</p>

      <div className="card">
        {message && (
          <p className="error" role="alert" data-testid="form-error">
            {message}
          </p>
        )}

        <form action={login}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required autoFocus />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />

          <button type="submit">Masuk</button>
        </form>
      </div>

      <p className="hint">
        Identitas demo: <code>owner@alpha.demo</code>, <code>admin@beta.demo</code>,{' '}
        <code>multi@demo.local</code> - password <code>Demo#12345</code>.
        <br />
        Masuk sebagai Alpha lalu Beta, dan bandingkan daftar anggotanya.
      </p>
    </main>
  );
}
