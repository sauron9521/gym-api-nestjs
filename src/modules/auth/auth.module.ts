import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import {
  EmailVerificationController,
  PasswordResetController,
  SessionsController,
  TokensController,
} from './controllers/index.js';

import {
  EmailVerificationMailer,
  PasswordResetMailer,
} from './mailers/index.js';
import { JwtAuth, SessionAuth } from './providers/index.js';
import { CredentialsService } from './services/index.js';
import { PrismaSessionStore } from './prisma-session.store.js';
import { PrismaTokenStore } from './prisma-token.store.js';
import { TokenCleanupService } from './services/token-cleanup.service.js';

@Module({
  imports: [UsersModule],
  controllers: [
    AuthController,
    PasswordResetController,
    EmailVerificationController,
    TokensController,
    SessionsController,
  ],
  providers: [
    SessionAuth,
    CredentialsService,
    EmailVerificationMailer,
    JwtAuth,
    PasswordResetMailer,
    PrismaSessionStore,
    PrismaTokenStore,
    TokenCleanupService,
  ],
})
export class AuthModule {}
