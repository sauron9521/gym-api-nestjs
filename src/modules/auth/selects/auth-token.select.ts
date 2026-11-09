import type { Prisma } from '#prisma/client';

/** Refresh-token lookup excludes revocation metadata from returned records. */
export const authRefreshTokenSelect = {
  id: true,
  familyId: true,
  userId: true,
  createdAt: true,
  expiresAt: true,
  familyExpiresAt: true,
  usedAt: true,
  claims: true,
} satisfies Prisma.RefreshTokenSelect;

/** Minimal projections for the existing revocation and pending-token checks. */
export const authRefreshTokenFamilyRevocationSelect = {
  revokedAt: true,
} satisfies Prisma.RefreshTokenFamilySelect;

export const authRevokedRefreshTokenSelect = {
  id: true,
} satisfies Prisma.RefreshTokenSelect;

export const authPendingEmailTokenCutoffSelect = {
  id: true,
  expiresAt: true,
} satisfies Prisma.EmailTokenSelect;
