import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { UsersRepository } from '../users/users.repository.js';
import { AuthController } from './auth.controller.js';
import { PasswordResetController } from './controllers/password-reset.controller.js';
import { EmailVerificationController } from './email-verification.controller.js';
import { EmailVerificationMailer } from './mailers/email-verification.mailer.js';
import { PasswordResetMailer } from './mailers/password-reset.mailer.js';
import { CredentialsService } from './services/credentials.service.js';
import { SessionAuth } from './services/session-auth.provider.js';

@Module({
  imports: [UsersModule],
  controllers: [
    AuthController,
    PasswordResetController,
    EmailVerificationController,
  ],
  providers: [
    SessionAuth,
    UsersRepository,
    CredentialsService,
    EmailVerificationMailer,
    PasswordResetMailer,
  ],
})
export class AuthModule {}
