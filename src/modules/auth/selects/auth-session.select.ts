import type { Prisma } from '#prisma/client';

/** Contract fields for session reads, excluding unrelated persistence columns. */
export const authSessionSelect = {
  id: true,
  userId: true,
  createdAt: true,
  expiresAt: true,
  lastActiveAt: true,
  mfa: true,
  metadata: true,
} satisfies Prisma.SessionSelect;
