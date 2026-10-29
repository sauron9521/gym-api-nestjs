import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import {
  EmailVerificationController,
  PasswordResetController,
} from './controllers/index.js';

import {
  EmailVerificationMailer,
  PasswordResetMailer,
} from './mailers/index.js';
import { JwtAuth, SessionAuth } from './providers/index.js';
import { CredentialsService } from './services/index.js';
import { TokensController } from './controllers/tokens.controller.js';
import { PrismaSessionStore } from './prisma-session.store.js';

@Module({
  imports: [UsersModule],
  controllers: [
    AuthController,
    PasswordResetController,
    EmailVerificationController,
    TokensController,
  ],
  providers: [
    SessionAuth,
    CredentialsService,
    EmailVerificationMailer,
    JwtAuth,
    PasswordResetMailer,
    PrismaSessionStore,
  ],
})
export class AuthModule {}
