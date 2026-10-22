import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { UsersRepository } from '../users/users.repository.js';
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
