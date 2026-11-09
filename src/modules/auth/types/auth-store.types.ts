import type { Prisma } from '#prisma/client';
import type { authSessionSelect } from '../selects/auth-session.select.js';
import type {
  authRefreshTokenSelect,
  authPendingEmailTokenCutoffSelect,
} from '../selects/auth-token.select.js';

export type AuthSessionRow = Prisma.SessionGetPayload<{
  select: typeof authSessionSelect;
}>;

export type AuthRefreshTokenRow = Prisma.RefreshTokenGetPayload<{
  select: typeof authRefreshTokenSelect;
}>;

export type AuthPendingEmailTokenCutoffRow = Prisma.EmailTokenGetPayload<{
  select: typeof authPendingEmailTokenCutoffSelect;
}>;

/** The SQL DELETE ... RETURNING contract, with database snake_case aliased. */
export type AuthConsumedEmailTokenRow = {
  id: string;
  purpose: string;
  userId: string;
  email: string;
  fingerprint: string | null;
  createdAt: Date;
  expiresAt: Date;
};
