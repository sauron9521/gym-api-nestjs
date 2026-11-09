import type {
  UserResponse,
  UserWithCredentialsPayload,
} from '#src/modules/users/types/user-payload.types';

/**
 * Explicit public allowlist: do not spread credential lookup rows.
 * New private columns in userSelectWithCredentials must never silently
 * become properties in a successful login/refresh identity response.
 */
export function toAuthenticatedUser(user: UserWithCredentialsPayload): UserResponse {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
