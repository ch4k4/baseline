import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SupportSessionsController, TenantSupportSessionsController } from './support.controller.js';
import { SupportService } from './support.service.js';

/**
 * SupportLifecycleService TIDAK didaftarkan di sini melainkan di AuthModule, dan
 * itu bukan kekeliruan letak berkas: jalur logout (AuthService) juga memakainya,
 * dan modul yang saling mengimpor tidak akan terpasang. Modul ini mengimpor
 * AuthModule, jadi ia mendapatkannya dari sana.
 */
@Module({
  imports: [AuthModule],
  controllers: [SupportSessionsController, TenantSupportSessionsController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
