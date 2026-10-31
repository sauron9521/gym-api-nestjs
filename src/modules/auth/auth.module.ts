import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import {
  AuthController,
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
import { CredentialsService, TokenCleanupService } from './services/index.js';
import { PrismaSessionStore, PrismaTokenStore } from './stores/index.js';

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
