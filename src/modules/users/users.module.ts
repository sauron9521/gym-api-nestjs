import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { RootController } from './root.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

@Module({
  providers: [UsersRepository, UsersService],
  controllers: [RootController, UsersController],
  exports: [UsersRepository],
})
export class UsersModule {}
