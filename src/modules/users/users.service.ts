import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

import { UsersRepository } from './users.repository.js';
import type { UpdateMyProfileDto } from './dto/update-my-profile.dto.js';

type UserWithProfile = NonNullable<
  Awaited<ReturnType<UsersRepository['findMe']>>
>;

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findMe(userId: string) {
    const user = await this.usersRepository.findMe(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toResponse(user);
  }

  async updateMe(userId: string, input: UpdateMyProfileDto) {
    const data: Prisma.ProfileCreateWithoutUserInput = {
      name: input.name,
      birthday:
        typeof input.birthday === 'string'
          ? new Date(`${input.birthday}T00:00:00.000Z`)
          : input.birthday,
      height: input.height,
      weight: input.weight,
    };

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
          }
        : null,
    };
  }
}
