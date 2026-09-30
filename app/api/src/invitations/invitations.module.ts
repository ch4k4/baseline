import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationService } from './invitation.service.js';

@Module({
  imports: [AuthModule],
  controllers: [InvitationsController],
  providers: [InvitationService],
  exports: [InvitationService],
})
export class InvitationsModule {}
