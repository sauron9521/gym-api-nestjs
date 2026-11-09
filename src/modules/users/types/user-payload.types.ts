import type { Prisma } from '#prisma/client';

import type {
  userSelect,
  userSelectWithCredentials,
  userWithProfileSelect,
} from '../selects/user.select.js';

/** Safe account identity used by authentication and public responses. */
export type UserResponse = Prisma.UserGetPayload<{
  select: typeof userSelect;
}>;

export type UserWithCredentialsPayload = Prisma.UserGetPayload<{
  select: typeof userSelectWithCredentials;
}>;

export type UserWithProfilePayload = Prisma.UserGetPayload<{
  select: typeof userWithProfileSelect;
}>;

/** The HTTP profile serializes PostgreSQL DATE and Decimal explicitly. */
export type UserMeResponse = Omit<UserWithProfilePayload, 'profile'> & {
  profile:
    | (Omit<NonNullable<UserWithProfilePayload['profile']>, 'birthday' | 'weight'> & {
        birthday: string | null;
        weight: number | null;
      })
    | null;
};
