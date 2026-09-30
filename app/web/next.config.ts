import type { NextConfig } from 'next';

const config: NextConfig = {
  // Browser hanya berbicara dengan Next. Panggilan ke NestJS terjadi di server,
  // jadi tidak ada CORS untuk diurus dan token tidak pernah sampai ke JavaScript.
  reactStrictMode: true,
};

export default config;
