import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../infra/database/generated/prisma/client.js';

import { UsersRepository } from './users.repository.js';
import type { UpdateMyProfileDto } from './dto/update-my-profile.dto.js';
import { AvatarService } from './avatar/avatar.service.js';

type UserWithProfile = NonNullable<
  Awaited<ReturnType<UsersRepository['findMe']>>
>;

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
    return this.toResponse(user);
  }

  async updateMe(userId: string, input: UpdateMyProfileDto) {
    const displayName =
      input.displayName !== undefined ? input.displayName : input.name;

    // Keep the old name field in sync for clients still using it.
    const data: Prisma.ProfileCreateWithoutUserInput = {
      name: displayName,
      displayName,
      firstName: input.firstName,
      lastName: input.lastName,
      avatarUrl: input.avatarUrl,
      timezone: input.timezone,
      birthday:
        typeof input.birthday === 'string'
          ? new Date(`${input.birthday}T00:00:00.000Z`)
          : input.birthday,
      height: input.height,
      weight: input.weight,
    };

    if (input.avatarUrl !== undefined) {
      // A legacy HTTPS URL PATCH must release any managed avatar it replaces.
      const result = await this.usersRepository.replaceAvatar(
        userId,
        data,
        null,
      );
      await this.avatarService.removePrevious(result.previousKey);
      return this.toResponse(result.user);
    }

    const user = await this.usersRepository.upsertMyProfile(userId, data);
    return this.toResponse(user);
  }

  private toResponse(user: UserWithProfile) {
    return {
      ...user,
      profile: user.profile
        ? {
            ...user.profile,
            // A PostgreSQL DATE is calendar-only, not an instant.
            birthday: user.profile.birthday
              ? user.profile.birthday.toISOString().slice(0, 10)
              : null,
            // Preserve the existing numeric JSON API contract.
            weight: user.profile.weight === null
              ? null
              : Number(user.profile.weight),
          }
        : null,
    };
  }
}
