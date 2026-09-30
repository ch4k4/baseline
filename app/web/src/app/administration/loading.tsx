/**
 * Loading state untuk seluruh halaman administrasi (Demo Foundation sec.12.1).
 *
 * Halaman ini server component yang menunggu API, jadi perpindahan route punya
 * jeda nyata. Tanpa berkas ini, browser menampilkan halaman lama tanpa tanda
 * apa pun - dan orang mengira kliknya tidak masuk, lalu mengklik lagi.
 */
export default function Loading() {
  return (
    <main>
      <p className="sub" role="status" data-testid="memuat">
        Memuat...
      </p>
      <div className="card rangka" aria-hidden="true">
        <span className="baris-rangka" />
        <span className="baris-rangka pendek" />
        <span className="baris-rangka" />
      </div>
    </main>
  );
}
