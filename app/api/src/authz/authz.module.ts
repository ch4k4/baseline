import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { AccessGuard } from './access.guard.js';
import { PermissionService } from './permission.service.js';
import { MyPermissionsController, PermissionsController } from './permissions.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [PermissionsController, MyPermissionsController],
  providers: [PermissionService, { provide: APP_GUARD, useClass: AccessGuard }],
  exports: [PermissionService],
})
export class AuthzModule {}
