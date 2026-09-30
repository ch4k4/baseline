import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SaaS Demo',
  description: 'Demo isolasi tenant: login, session, dan daftar anggota per tenant',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
