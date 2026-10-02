import 'reflect-metadata';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { failWithExplanation } from './database/preflight.js';
import { loadKek } from './crypto/kek-source.js';
import { loadJwtSecret } from './auth/jwt-secret-source.js';
import { supportContextMiddleware } from './database/support-context.js';

export async function bootstrap(port = Number(process.env.PORT ?? 3001)) {
  // KEK diperiksa SEBELUM Nest dibuat. Kalau gagal di dalam dependency injection,
  // Nest mencetak stack trace merahnya sendiri dan pesan yang menyebut obatnya
  // tenggelam di bawahnya.
  loadKek();
  loadJwtSecret();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  // Wadah per permintaan untuk penanda sesi support (DEMO-0312). Dipasang sebagai
  // middleware, BUKAN di guard: guard hanya mengembalikan boolean dan tidak
  // membungkus jalannya handler, sedangkan penanda harus terbaca oleh unit of work
  // di dalam handler. Middleware membuka wadahnya sebelum route diproses, guard
  // mengisinya, dan unit of work membacanya - lihat database/support-context.ts.
  app.use(supportContextMiddleware);
  app.enableShutdownHooks();
  await app.listen(port);
  return app;
}

// Padanan ESM untuk `require.main === module`: berkas ini dijalankan langsung
// (node dist/src/main.js), bukan diimpor tes. Perbandingan lewat realpath, bukan
// string URL, supaya huruf drive dan pemisah path Windows tidak membuatnya
// diam-diam salah (API tidak start tanpa pesan apa pun).
function dijalankanLangsung(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (dijalankanLangsung()) {
  bootstrap()
    .then(() => console.log(`API siap di http://127.0.0.1:${process.env.PORT ?? 3001}`))
    .catch((error) => failWithExplanation(error));
}
