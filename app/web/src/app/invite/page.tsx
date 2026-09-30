import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { apiFetch, isTimeout, PESAN_LAMBAT } from '@/lib/api-fetch';
import { clientIpHeader } from '@/lib/client-ip';

/**
 * Halaman penerimaan undangan (D-09). Publik: penerima belum tentu punya akun.
 *
 * Token ada di URL karena itulah bentuk tautan email. Akibatnya (D-22):
 *   - referrer dimatikan di halaman ini, supaya token tidak ikut terkirim ke
 *     situs lain lewat header Referer;
 *   - token TIDAK disalin ke field tersembunyi. Server action menerimanya
 *     sebagai argumen terikat (bind), yang oleh Next dienkripsi sebelum sampai
 *     ke browser.
 * Token tetap tercatat di riwayat browser. Itu harga tautan email; umur token
 * yang pendek dan sifat sekali pakainya yang membatasi.
 */

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Terima undangan - SaaS Demo', referrer: 'no-referrer' };

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

interface LookupResult {
  tenantName: string;
  expiresAt: string;
  hasAccount: boolean;
}

async function terima(token: string, formData: FormData) {
  'use server';
  const displayName = String(formData.get('displayName') ?? '');
  const password = String(formData.get('password') ?? '');
  const back = (e: string) => `/invite?token=${encodeURIComponent(token)}&error=${e}`;
  if (!displayName.trim() || !password) redirect(back('kosong'));

  let res: Response;
  try {
    res = await apiFetch('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await clientIpHeader()) },
      body: JSON.stringify({ token, password, displayName }),
    });
  } catch (error) {
    redirect(back(isTimeout(error) ? 'lambat' : 'api'));
  }

  if (res.ok) redirect('/invite/diterima');
  if (res.status === 401) redirect(back('password'));
  if (res.status === 429) redirect(back('terkunci'));
  if (res.status === 400) redirect(back('format'));
  // 410: dipakai, dicabut, atau kedaluwarsa di antara lookup dan submit.
  redirect(back('tidak-berlaku'));
}

const MESSAGES: Record<string, string> = {
  kosong: 'Nama tampilan dan password wajib diisi.',
  password: 'Password salah. Gunakan password akun Anda yang sudah ada.',
  format: 'Periksa lagi isian Anda: password baru minimal 10 karakter, nama maksimal 100 karakter.',
  terkunci: 'Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.',
  lambat: PESAN_LAMBAT,
  api: 'API tidak dapat dihubungi.',
  'tidak-berlaku': 'Undangan tidak berlaku atau sudah dipakai.',
};

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  let info: LookupResult | null = null;
  let masalah: string | null = null;

  if (!token || !TOKEN_RE.test(token)) {
    masalah = 'Tautan undangan tidak lengkap atau rusak.';
  } else {
    try {
      const res = await apiFetch('/api/v1/invitations/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) info = (await res.json()) as LookupResult;
      else masalah = MESSAGES['tidak-berlaku'];
    } catch (e) {
      masalah = isTimeout(e) ? PESAN_LAMBAT : MESSAGES.api;
    }
  }

  if (!info || !token) {
    return (
      <main>
        <h1>Undangan</h1>
        <div className="card">
          <p className="error" role="alert" data-testid="invite-error">
            {masalah}
          </p>
          <p style={{ margin: 0 }}>
            Minta pengundang mengirim undangan baru, atau <a href="/login">masuk</a> bila Anda
            sudah menjadi anggota.
          </p>
        </div>
      </main>
    );
  }

  const message = error ? (MESSAGES[error] ?? 'Terjadi kesalahan.') : null;

  return (
    <main>
      <h1>Bergabung dengan {info.tenantName}</h1>
      <p className="sub">
        Undangan berlaku sampai {new Date(info.expiresAt).toLocaleString('id-ID')} dan hanya dapat
        dipakai sekali.
      </p>

      <div className="card">
        {message && (
          <p className="error" role="alert" data-testid="form-error">
            {message}
          </p>
        )}
        <form action={terima.bind(null, token)}>
          <label htmlFor="displayName">Nama tampilan di {info.tenantName}</label>
          <input id="displayName" name="displayName" maxLength={100} required autoFocus />

          <label htmlFor="password">
            {info.hasAccount ? 'Password akun Anda' : 'Buat password (minimal 10 karakter)'}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={info.hasAccount ? 'current-password' : 'new-password'}
            minLength={info.hasAccount ? undefined : 10}
            required
          />

          <button type="submit" data-testid="accept-submit">
            {info.hasAccount ? 'Terima undangan' : 'Buat akun dan bergabung'}
          </button>
        </form>
      </div>

      <p className="hint" data-testid="invite-mode">
        {info.hasAccount
          ? 'Email ini sudah punya akun. Undangan akan ditambahkan ke akun yang sama.'
          : 'Email ini belum punya akun. Akun baru dibuat saat Anda menerima undangan.'}
      </p>
    </main>
  );
}
