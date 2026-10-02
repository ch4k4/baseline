/**
 * Pesan yang dipakai halaman DAN komponen klien. Berkas terpisah karena
 * components/FormAksi.tsx berjalan di browser dan tidak boleh ikut menarik
 * modul server (redirect, cookies) ke dalam bundel.
 */

export const PESAN_GAGAL: Record<string, string> = {
  hilang: 'Data yang Anda buka sudah tidak ada. Daftar di halaman ini sudah dimuat ulang.',
  bentrok:
    'Data ini berubah sejak halaman dimuat, jadi perubahan Anda tidak disimpan. Periksa keadaan terbaru di bawah, lalu ulangi bila masih perlu.',
  masukan: 'Masukan tidak diterima.',
  api: 'Permintaan gagal.',
  ditolak: 'Permintaan ditolak: hak Anda tidak mencakup perubahan itu.',
};

export const PESAN_SUKSES: Record<string, string> = {
  'profil-disimpan': 'Nama tampilan disimpan.',
  ditangguhkan: 'Anggota ditangguhkan. Session-nya di tenant ini dicabut.',
  diaktifkan: 'Anggota diaktifkan kembali. Ia perlu masuk lagi.',
  'role-disimpan': 'Role anggota diperbarui.',
  'role-dibuat': 'Role dibuat.',
  'nama-disimpan': 'Nama role disimpan.',
  diarsipkan: 'Role diarsipkan. Penugasan yang berjalan ikut diakhiri.',
  'permission-disimpan': 'Isi permission role disimpan.',
  terkirim: 'Undangan dikirim. Penerima mendapat tautan sekali pakai dengan batas waktu.',
  dicabut: 'Undangan dicabut. Tautannya tidak lagi berlaku.',
  'notifikasi-dibaca': 'Ditandai terbaca. Tandanya tidak dapat dikembalikan.',
  'admin-diberi': 'Hak admin platform diberikan. Berlaku saat orang itu masuk lagi.',
  'admin-dicabut': 'Hak admin platform dicabut.',
  'tenant-disuspend': 'Tenant disuspend. Anggotanya kehilangan akses pada permintaan berikutnya.',
  'tenant-diaktifkan': 'Tenant diaktifkan kembali.',
  'support-mulai':
    'Sesi dukungan dibuka. Selama sesi berjalan, tenant ini melihat kejadiannya di layar Keamanan miliknya.',
  'support-readonly':
    'Sesi dukungan dibuka sebagai READ_ONLY: tenant ini tidak berstatus aktif, jadi perbaikan data tidak diizinkan.',
  'sesi-diakhiri': 'Sesi dukungan diakhiri. Tenant diberi tahu bahwa aksesnya sudah tertutup.',
};
