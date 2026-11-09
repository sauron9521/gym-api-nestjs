import type { Prisma } from '#prisma/client';

import type { UpdateMyProfileDto } from '../dto/update-my-profile.dto.js';
import type {
  UserMeResponse,
  UserWithProfilePayload,
} from '../types/user-payload.types.js';

/** Keep PATCH legacy name/displayName semantics unchanged. */
export function mapProfileUpdateInput(
  input: UpdateMyProfileDto,
): Prisma.ProfileCreateWithoutUserInput {
  const displayName =
    input.displayName !== undefined ? input.displayName : input.name;

  return {
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
}

/** Stable public API: date-only birthday, JSON number weight, nullable profile. */
export function mapUserWithProfile(user: UserWithProfilePayload): UserMeResponse {
  return {
    ...user,
    profile: user.profile
      ? {
          ...user.profile,
          birthday: user.profile.birthday
            ? user.profile.birthday.toISOString().slice(0, 10)
            : null,
          weight: user.profile.weight === null
            ? null
            : Number(user.profile.weight),
        }
      : null,
  };
}
