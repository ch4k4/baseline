import { Controller, Get, Req } from '@nestjs/common';
import { AuthenticatedWithSupport } from '../authz/access.decorator.js';
import { ResolvedSession } from '../auth/pre-context.repository.js';
import { MenuService } from './menu.service.js';

/**
 * `GET /me/menu` (Demo Foundation sec.11.1, DEMO-0403/0405).
 *
 * Route IDENTITAS, bukan route ber-permission: setiap session sah berhak
 * mengetahui navigasinya sendiri, dan isinya sudah disesuaikan dengan hak session
 * itu. Memberinya permission tersendiri akan menghasilkan lingkaran - halaman
 * tidak dapat menggambar navigasi yang menuntun ke izin untuk melihat navigasi.
 *
 * Sesi support ikut dilayani (lihat @AuthenticatedWithSupport di access.decorator):
 * mode support memakai layar tenant, jadi ia butuh navigasinya - dengan himpunan
 * permission tetap miliknya, bukan hak anggota tenant mana pun.
 */
@Controller('api/v1/me/menu')
export class MyMenuController {
  constructor(private readonly menus: MenuService) {}

  @Get()
  @AuthenticatedWithSupport()
  async mine(@Req() req: any) {
    const session: ResolvedSession = req.session;
    return { menu: await this.menus.forSession(session, req.support) };
  }
}
