/**
 * Error state satu bentuk untuk semua halaman administrasi (AC DEMO-0307).
 *
 * Kegagalan memuat TIDAK boleh mengalihkan halaman ke dirinya sendiri dengan
 * pesan di query: API yang macet akan membuat pengalihan itu berulang tanpa
 * ujung. Karena itu kegagalan dirender di tempat, bukan dipantulkan.
 */
export default function KartuGagal({ judul, pesan }: { judul: string; pesan: string }) {
  return (
    <div className="card">
      <h2 className="judul-kartu">{judul}</h2>
      <p className="error" role="alert" data-testid="form-error">
        {pesan}
      </p>
      <p className="kosong" style={{ marginBottom: 0 }}>
        Halaman ini tidak menampilkan data lama sebagai pengganti: daftar yang usang lebih
        menyesatkan daripada tidak ada daftar sama sekali.
      </p>
    </div>
  );
}
