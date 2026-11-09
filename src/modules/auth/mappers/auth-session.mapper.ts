import type { MfaState, SessionRecord } from '@nestjs/authentication';
import type { AuthSessionRow } from '../types/auth-store.types.js';

/** Keep the authentication package's optional-field semantics (not nulls). */
export function toSessionRecord(session: AuthSessionRow): SessionRecord {
  return {
    id: session.id,
    userId: session.userId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    lastActiveAt: session.lastActiveAt,
    ...(session.mfa !== null ? { mfa: session.mfa as MfaState } : {}),
    ...(session.metadata !== null
      ? { metadata: session.metadata as Record<string, unknown> }
      : {}),
  };
}
