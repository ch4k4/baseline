/**
 * Pembantu tes: membaca isi access token.
 *
 * Membaca payload JWT TANPA memverifikasi tanda tangan boleh dilakukan di tes,
 * dan tidak boleh dilakukan di kode produksi. Di sini yang dibutuhkan hanya
 * session id untuk mencocokkan baris database; di sana, payload tanpa verifikasi
 * adalah data dari penyerang.
 */
export function claims(accessToken: string): Record<string, any> {
  const part = accessToken.split('.')[1];
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export function sid(accessToken: string): string {
  return claims(accessToken).sid;
}

/** Mengubah satu karakter tanda tangan; bentuknya tetap JWT, tanda tangannya tidak lagi sah. */
export function tamper(accessToken: string): string {
  const [h, b, s] = accessToken.split('.');
  const flipped = (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
  return `${h}.${b}.${flipped}`;
}
