import { isIP } from 'node:net';

/**
 * Alamat IP klien untuk pembatasan percobaan login per IP.
 *
 * API berada di belakang BFF (Next.js): dilihat dari socket, SEMUA permintaan
 * datang dari alamat server web. BFF karena itu meneruskan alamat klien lewat
 * header ini - dan header itu hanya dipercaya bila lawan bicara socket-nya
 * sendiri adalah proxy tepercaya (DEMO_TRUSTED_PROXIES, bawaan loopback). Dari
 * lawan bicara lain, header diabaikan dan alamat socket yang dipakai: pemanggil
 * yang menembus BFF tidak dapat memilih IP-nya sendiri, jadi tidak dapat
 * memutari batasnya maupun menghabiskan kuota IP orang lain.
 *
 * Alamat ini TIDAK pernah disimpan dan tidak masuk audit: ia hanya kunci
 * penghitung di memori (rate-limit.service.ts).
 */
export const CLIENT_IP_HEADER = 'x-demo-client-ip';

/** `::ffff:127.0.0.1` dan `127.0.0.1` adalah alamat yang sama. */
function normal(address: string): string {
  const a = address.trim();
  return a.startsWith('::ffff:') && isIP(a.slice(7)) === 4 ? a.slice(7) : a;
}

/** Dibaca per panggilan, bukan saat modul dimuat, supaya tes dapat mengubahnya. */
function trustedProxies(): Set<string> {
  const raw = process.env.DEMO_TRUSTED_PROXIES ?? '127.0.0.1,::1';
  return new Set(raw.split(',').map(normal).filter(Boolean));
}

export function clientIpOf(req: {
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
}): string | null {
  const peer = normal(req.socket?.remoteAddress ?? '');
  const claimed = req.headers?.[CLIENT_IP_HEADER];
  if (peer && trustedProxies().has(peer) && typeof claimed === 'string' && isIP(normal(claimed))) {
    return normal(claimed);
  }
  return peer || null;
}
