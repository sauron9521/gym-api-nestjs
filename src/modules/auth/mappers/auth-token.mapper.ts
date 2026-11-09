import type {
  EmailTokenPurpose,
  EmailTokenRecord,
  RefreshTokenRecord,
} from '@nestjs/authentication';
import type {
  AuthConsumedEmailTokenRow,
  AuthRefreshTokenRow,
} from '../types/auth-store.types.js';

/** Never pass persistence-only fields such as revoked into auth records. */
export function toRefreshTokenRecord(row: AuthRefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    familyId: row.familyId,
    userId: row.userId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    familyExpiresAt: row.familyExpiresAt,
    ...(row.usedAt !== null ? { usedAt: row.usedAt } : {}),
    ...(row.claims !== null
      ? { claims: row.claims as Record<string, unknown> }
      : {}),
  };
}

/** The SQL consume path stays atomic; this mapper only normalizes its result. */
export function toEmailTokenRecord(row: AuthConsumedEmailTokenRow): EmailTokenRecord {
  return {
    id: row.id,
    purpose: row.purpose as EmailTokenPurpose,
    userId: row.userId,
    email: row.email,
    ...(row.fingerprint !== null ? { fingerprint: row.fingerprint } : {}),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
