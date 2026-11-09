# Auth providers and credentials service review (PR #57)

## Narrow scope

- `JwtAuth` and `SessionAuth` stay as the two framework authentication providers. Their registration order remains session at default 0 and JWT at explicit 1, with no changes to realm, session cookie or validation behavior.
- Both providers continue to use `UsersRepository.findUserById`, which selects public fields and rejects soft-deleted users. A new wrapper/identity service would introduce an unnecessary dependency for these one-line lookups.
- The credential verifier still checks the password even if no user exists (delegating to the hasher with an undefined hash), preserves the existing password rehash behavior, and retains registration's uniqueness handling.
- The one security-hardening change is a dedicated **explicit allowlist** mapper for successful password logins. Previously `{ passwordHash, ...user }` silently exposed every other field returned by the internal credential projection. Now the `UserResponse` output explicitly names only `id`, `email`, `emailVerified`, `role`, `createdAt` and `updatedAt`.
- Type-only imports distinguish auth package contracts from runtime classes in providers.

## Guarantees

- No changes to `@nestjs/authentication` dependency wiring, provider precedence, JWT subject logic, cookie handling, token/session storage, password hashing, API routes, Prisma schema, or HTTP response shape.
- Public identity must never include `passwordHash` or future persistence-only fields even if the credential repository query grows.
- Existing auth controller + E2E login and refresh flows remain covered by CI. New tests pin provider registration/lookup and the public projection boundary.

## CI

Prisma validation/generate, lint, TypeScript build, ESM smoke, unit tests, PostgreSQL integration/E2E auth and concurrent token tests, OpenAPI, coverage, vulnerability audit and Docker production smoke are required before merge.
