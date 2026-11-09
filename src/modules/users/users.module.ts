import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './repositories/users.repository.js';
import { UsersService } from './services/users.service.js';
import { AvatarDiskStorage } from './avatar/avatar-disk.storage.js';
import { AvatarService } from './avatar/avatar.service.js';
import { AvatarImageProcessor } from './avatar/avatar-image.processor.js';
import { AvatarOrphanCleanupService } from './avatar/avatar-orphan-cleanup.service.js';
import { AvatarPublicController } from './avatar/avatar-public.controller.js';

@Module({
  providers: [
    UsersRepository,
    UsersService,
    AvatarService,
    AvatarDiskStorage,
    AvatarImageProcessor,
    AvatarOrphanCleanupService,
  ],
  controllers: [UsersController, AvatarPublicController],
  exports: [UsersRepository],
})
export class UsersModule {}
