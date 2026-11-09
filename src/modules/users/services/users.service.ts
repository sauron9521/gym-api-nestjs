import { Injectable, NotFoundException } from '@nestjs/common';

import { AvatarService } from '../avatar/avatar.service.js';
import type { UpdateMyProfileDto } from '../dto/update-my-profile.dto.js';
import {
  mapProfileUpdateInput,
  mapUserWithProfile,
} from '../mappers/user-profile.mapper.js';
import { UsersRepository } from '../repositories/users.repository.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly avatarService: AvatarService,
  ) {}

  async findMe(userId: string) {
    const user = await this.usersRepository.findMe(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return mapUserWithProfile(user);
  }

  async updateMe(userId: string, input: UpdateMyProfileDto) {
    const data = mapProfileUpdateInput(input);

    if (input.avatarUrl !== undefined) {
      // A legacy HTTPS URL PATCH must release any managed avatar it replaces.
      const result = await this.usersRepository.replaceAvatar(
        userId,
        data,
        null,
      );
      await this.avatarService.removePrevious(result.previousKey);
      return mapUserWithProfile(result.user);
    }

    const user = await this.usersRepository.upsertMyProfile(userId, data);
    return mapUserWithProfile(user);
  }
}
