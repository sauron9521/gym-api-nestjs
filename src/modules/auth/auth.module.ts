import { Module } from '@nestjs/common';
import { UsersRepository } from '../users/users.repository.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [],
  controllers: [AuthController],
  providers: [AuthService, UsersRepository],
})
export class AuthModule {}
