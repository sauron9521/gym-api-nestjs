import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { UsersRepository } from '../users/users.repository.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CredentialsService } from './credentials.service.js';
import { SessionAuth } from './session-auth.provider.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, SessionAuth, UsersRepository, CredentialsService],
})
export class AuthModule {}
