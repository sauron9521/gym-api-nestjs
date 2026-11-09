# Auth response confidentiality and safe cleanup logging — PR #58

## Scope

- Add a lightweight `AuthNoStoreInterceptor` on all five authentication controllers: login/registration, token issuance/refresh/revoke, reset, email verification, and session management. It sets `Cache-Control: no-store` for requests that reach those controllers, preventing browsers and shared caches from retaining tokens, session identifiers, and personal session data.
- In `TokenCleanupService`, do not pass caught errors, `Error.stack`, `Error.message`, SQL, token values or opaque strings to Nest's logger. Log only the constant event `AUTH_TOKEN_CLEANUP_FAILED`, which can be monitored without containing secrets.
- HTTP status codes and response JSON payloads remain unchanged, including existing generic invalid credentials messages and reset-link validation. The interceptor only adds a response header.

## Existing safeguards retained

- The global `ApiExceptionFilter` already converts unexpected Prisma/HTTP failures to safe JSON and logs only an error category and request ID for server errors. No change to this cross-application behavior was needed.
- `CredentialsService` uses explicit safe response projection (PR #57), `UsersRepository` rejects soft-deleted users, and `AuthModule` uses distinct session/JWT providers.
- Throttling for registration, login, token issuance/refresh/revocation, password reset and email verification is untouched.
- The token cleanup cron still runs daily, invokes refresh and email cleanup concurrently, reports success only if both succeed, and catches errors so the scheduler continues to operate.

## Boundaries / follow-ups

- Nest guards execute before interceptors. An authorization failure rejected entirely by a guard may not receive the new header; such responses do not include successful auth secrets. If complete coverage including guard failures is later required, use a router-level middleware and test it separately.
- The generic cleanup log intentionally omits stack traces. Diagnose persistent failures using controlled, access-restricted instrumentation rather than unrestricted production logs containing Prisma exceptions.
- No schema or migration changes, no new dependencies, no change to auth state, token lifecycle or authorization decisions.

## Regression tests

- Unit: interceptor sets `Cache-Control: no-store` without touching handler values; token cleanup logs only its safe marker for `Error` and non-`Error` failures, never any token/SQL content.
- HTTP: login success and 401, token issuance, invalid credentials, refresh rejected token and revoke responses include `no-store`, do not echo secret request fields; existing status/response assertions preserved.
- CI: Prisma checks, lint, TypeScript/ESM build, unit, PostgreSQL integration/E2E + coverage, OpenAPI, Docker smoke and dependency audit.
