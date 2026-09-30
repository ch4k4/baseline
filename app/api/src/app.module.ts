import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { MembersModule } from './members/members.module.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { AuthzModule } from './authz/authz.module.js';
import { RolesModule } from './roles/roles.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SupportModule } from './support/support.module.js';
import { MenusModule } from './menus/menus.module.js';

@Module({
  imports: [
    DatabaseModule,
    CryptoModule,
    AuthModule,
    MembersModule,
    InvitationsModule,
    AuthzModule,
    RolesModule,
    PlatformModule,
    NotificationsModule,
    SupportModule,
    MenusModule,
  ],
})
export class AppModule {}
