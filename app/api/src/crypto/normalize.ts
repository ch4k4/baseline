/**
 * Normalisasi per field (SSOT sec.8.2: "input normalization ditetapkan per field").
 *
 * Blind index hanya berguna kalau penulis dan pencari menormalkan dengan cara
 * yang SAMA PERSIS. Karena itu fungsinya satu, di satu tempat, dan dipakai oleh
 * seed maupun jalur login - bukan ditulis ulang di masing-masing.
 */

/**
 * Email: NFC, trim, huruf kecil.
 *
 * NFC dan bukan NFKC: NFKC menyatukan karakter yang memang berbeda (misalnya
 * huruf bergaya matematis menjadi huruf biasa), sehingga dua alamat berbeda
 * dapat berbagi satu blind index. Menurunkan huruf besar seluruh alamat,
 * termasuk bagian lokal, adalah penyederhanaan yang disengaja: RFC 5321
 * membolehkan bagian lokal peka huruf, tapi praktis tidak ada penyedia yang
 * memakainya, dan dua akun yang hanya berbeda huruf besar lebih berbahaya
 * daripada bermanfaat.
 */
export function normalizeEmail(raw: string): string {
  return raw.normalize('NFC').trim().toLowerCase();
}

/**
 * Tampilan ber-masker untuk daftar (SSOT sec.11: list endpoint memakai masked
 * field). Domain tetap terlihat karena itu yang membedakan anggota secara
 * operasional; bagian lokal hanya huruf pertamanya.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Masker nama orang, dipakai di dalam support session (DEMO-0312, ADR-003 sec.2.2
 * butir 3: field DP-1 ditampilkan MASKED secara bawaan).
 *
 * Huruf pertama setiap kata dipertahankan supaya baris masih dapat dibedakan satu
 * dari yang lain - support yang tidak dapat membedakan dua anggota tidak dapat
 * menolong siapa pun. Yang sengaja tidak dilakukan: menyisakan panjang nama asli,
 * karena panjang adalah petunjuk yang tidak perlu diberikan.
 */
export function maskName(name: string): string {
  const kata = name.trim().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return '***';
  return kata.map((k) => `${[...k][0]}***`).join(' ');
}
