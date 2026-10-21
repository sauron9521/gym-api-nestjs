import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { UsersRepository } from '../users/users.repository.js';
import { AuthController } from './auth.controller.js';
import { CredentialsService } from './services/credentials.service.js';
import { SessionAuth } from './services/session-auth.provider.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [SessionAuth, UsersRepository, CredentialsService],
})
export class AuthModule {}
