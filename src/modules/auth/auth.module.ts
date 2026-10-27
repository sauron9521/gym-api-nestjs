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
import { SessionAuth } from './providers/index.js';
import { CredentialsService } from './services/index.js';
import { TokensController } from './controllers/tokens.controller.js';
import { JwtAuth } from './providers/jwt-auth.provider.js';

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
  ],
})
export class AuthModule {}
