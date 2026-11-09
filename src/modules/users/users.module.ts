import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';
import { AvatarDiskStorage } from './avatar/avatar-disk.storage.js';
import { AvatarService } from './avatar/avatar.service.js';
import { AvatarPublicController } from './avatar/avatar-public.controller.js';

@Module({
  providers: [UsersRepository, UsersService, AvatarService, AvatarDiskStorage],
  controllers: [UsersController, AvatarPublicController],
  exports: [UsersRepository],
})
export class UsersModule {}
