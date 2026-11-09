import type { Prisma } from '#prisma/client';

/** Safe account fields. No passwordHash or soft-delete metadata. */
export const userSelect = {
  id: true,
  email: true,
  emailVerified: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/** Full authenticated profile projection, excluding managed avatar keys. */
export const userWithProfileSelect = {
  ...userSelect,
  profile: {
    select: {
      name: true,
      firstName: true,
      lastName: true,
      displayName: true,
      avatarUrl: true,
      timezone: true,
      birthday: true,
      height: true,
      weight: true,
    },
  },
} satisfies Prisma.UserSelect;

/** Internal only: never return passwordHash in public API responses. */
export const userSelectWithCredentials = {
  ...userSelect,
  passwordHash: true,
} satisfies Prisma.UserSelect;

export const userAvatarKeySelect = {
  profile: { select: { avatarKey: true } },
} satisfies Prisma.UserSelect;

export const profileAvatarOwnerSelect = {
  user: { select: { deletedAt: true } },
} satisfies Prisma.ProfileSelect;

export const userEmailVerificationSelect = {
  id: true,
  email: true,
  emailVerified: true,
} satisfies Prisma.UserSelect;
