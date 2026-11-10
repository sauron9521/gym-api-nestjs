# Authentication recovery rate-limiting regressions — PR #119

## Context

The existing `@Throttle` decorators already set **three requests per
60 seconds** for:

- `POST /auth/password-reset/forgot`
- `POST /auth/password-reset/reset`
- `POST /auth/email/verification`

The auth controller-registry tests pin the decorator metadata, but the
HTTP throttling suite covered only registration, email-verify, refresh
and token revoke. This PR adds tests confirming the throttler actually
blocks excessive password recovery and verification-resend requests
**before** the relevant service or mail/token persistence work runs.

## HTTP regression coverage

1. **Forgot password (mocked service)**: the first three requests receive
   202; the fourth receives 429 with `Cache-Control: no-store`. The
   `PasswordResetService.request` spy runs exactly three times, so the
   blocked request does not queue an additional recovery email.
2. **Reset password (mocked service)**: the first three requests receive
   200; the fourth receives 429 with `no-store`. The
   `PasswordResetService.reset` spy is called only for the accepted
   requests, not for the blocked token.
3. **Authenticated email verification resend (real HTTP + PostgreSQL)**:
   use a real `AppModule`, Nest authentication and database; three
   successful resends issue three emails and three persisted email
   tokens. The fourth request receives 429; neither the `Mailer` call
   count nor the token-row count increases. The original cookie remains
   valid after rate limiting.

The mocked-controller suite uses the real Nest `ThrottlerGuard` with
an isolated in-memory counter and checks that application services are
not invoked after the limit. The resend suite keeps the production auth
guard and configured distributed-throttler provider; it replaces only
the outgoing `Mailer` to avoid external email delivery. Both test
suites exercise real HTTP requests and early no-store response headers.

The authenticated test uses the `TEST_DATABASE_URL` guard, an
individually identified account and FK-cascaded fixture cleanup.

## Scope and limitations

This PR is **tests and documentation only**: no runtime rate-limit
changes, Prisma schema/migrations, API contract changes, dependency
updates or CI modifications.

These checks validate the existing **per-IP** fixed-window policy in
one application instance. They do not prove protection against
distributed attacks from many IPs or enforce per-account quotas.
Redis-related availability, trusted reverse proxies and account-level
abuse detection remain separate security concerns.

All required GitHub Actions gates must pass on the latest commit before
marking Ready for review. Do not merge automatically.
