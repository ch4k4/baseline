/**
 * Tujuan setelah undangan diterima. Sengaja tanpa parameter: nama tenant,
 * email, atau token tidak perlu ikut ke URL berikutnya.
 */
export default function InvitationAcceptedPage() {
  return (
    <main>
      <h1>Undangan diterima</h1>
      <div className="card">
        <p className="notice" role="status" data-testid="accept-success">
          Anda sudah menjadi anggota. Tautan undangan kini tidak berlaku lagi.
        </p>
        <p style={{ margin: 0 }}>
          <a href="/login" data-testid="go-login">
            Masuk
          </a>{' '}
          dengan email undangan dan password Anda.
        </p>
      </div>
    </main>
  );
}
