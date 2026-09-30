import { Module } from '@nestjs/common';
import { AuthController, MeController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { PreContextRepository } from './pre-context.repository.js';
import { SessionGuard } from './session.guard.js';
import { TicketService } from './ticket.service.js';
import { AuditService } from './audit.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { JwtService } from './jwt.service.js';
import { TokenService } from './token.service.js';
import { SupportLifecycleService } from '../support/support-lifecycle.service.js';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    PasswordService,
    PreContextRepository,
    SessionGuard,
    TicketService,
    AuditService,
    RateLimitService,
    JwtService,
    TokenService,
    SupportLifecycleService,
  ],
  exports: [
    PreContextRepository,
    SessionGuard,
    PasswordService,
    AuditService,
    JwtService,
    RateLimitService,
    TicketService,
    TokenService,
    SupportLifecycleService,
  ],
})
export class AuthModule {}
