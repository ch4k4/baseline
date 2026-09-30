import { headers } from 'next/headers';

/**
 * Header yang membawa IP klien ke API, untuk pembatasan percobaan login per IP.
 * API hanya mempercayainya dari proxy tepercaya (DEMO_TRUSTED_PROXIES di API).
 */
export const CLIENT_IP_HEADER = 'x-demo-client-ip';

/**
 * IP klien menurut `x-forwarded-for`, dengan jumlah proxy tepercaya di depan web
 * dari WEB_TRUSTED_PROXY_HOPS.
 *
 * Kenapa perlu angka itu: Next mengisi `x-forwarded-for` dengan alamat socket
 * HANYA bila header itu belum ada (`??=`). Header kiriman klien dibiarkan apa
 * adanya, jadi tanpa proxy di depan, nilainya dapat dipalsukan klien.
 *
 * - 0 (bawaan; pengembangan, web diekspos langsung): nilai terakhir. Klien jujur
 *   mendapat alamat socket-nya; klien yang mengirim header sendiri dapat memilih
 *   IP. Batas per IP karena itu HANYA berarti di balik proxy - batas per email
 *   tetap berlaku di kedua keadaan.
 * - n: n proxy tepercaya masing-masing MENAMBAHKAN alamat lawan bicaranya di
 *   ujung. Alamat yang dilihat proxy terdepan ada di posisi (panjang - n); apa
 *   pun di kirinya adalah kiriman klien dan diabaikan.
 */
export async function clientIpHeader(): Promise<Record<string, string>> {
  const xff = (await headers()).get('x-forwarded-for');
  if (!xff) return {};
  const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
  const hops = Math.max(0, Math.floor(Number(process.env.WEB_TRUSTED_PROXY_HOPS ?? 0)) || 0);
  const ip = parts[hops === 0 ? parts.length - 1 : parts.length - hops];
  return ip ? { [CLIENT_IP_HEADER]: ip } : {};
}
