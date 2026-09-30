import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformAdminsController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';
import { PlatformTenantsController } from './tenants.controller.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PlatformAdminsController, PlatformTenantsController],
  providers: [PlatformService, TenantProvisioningService],
  exports: [PlatformService],
})
export class PlatformModule {}
