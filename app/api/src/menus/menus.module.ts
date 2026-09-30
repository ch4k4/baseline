import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { MyMenuController } from './menus.controller.js';
import { MenuService } from './menu.service.js';

@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [MyMenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenusModule {}
