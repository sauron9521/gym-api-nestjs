# Auth recovery rate-limit regressions — PR #119

## Existing coverage and gap

The existing `test/auth-rate-limit.e2e-spec.ts` covers registration,
email-link verification, refresh-token rotation and token revocation at
their configured per-route thresholds. Recovery endpoints have independent
`@Throttle({ default: { limit: 3, ttl: 60_000 } })` metadata but lacked
real HTTP regression coverage asserting that rejected traffic does not
reach the underlying services or mutate persistent records.

## Added tests

`test/integration/auth-recovery-rate-limit.integration.e2e-spec.ts`
exercises the real `AppModule`, the **actual** `ThrottlerGuard` and its
configured storage, authentication providers, `PrismaService`, and the
normal global validation pipes. It deliberately does **not** override
`ThrottlerGuard`, unlike the unrelated authentication lifecycle tests.

| Endpoint | First 3 requests | Fourth request | Side-effect assertion |
| --- | --- | --- | --- |
| `POST /auth/password-reset/forgot` | `202 Accepted` | `429 Too Many Requests` | Only three calls to `PasswordResetService.request`, three mail submissions, and three reset token rows |
| `POST /auth/password-reset/reset` | `400 Bad Request` for invalid links | `429 Too Many Requests` | `PasswordResetService.reset` called only three times; password hash, token count and session count unchanged |
| `POST /auth/email/verification` | `202 Accepted` with an authenticated, unverified cookie | `429 Too Many Requests` | Only three calls to `EmailVerificationService.send`, three mail submissions and no fourth verification token |

All three responses to rejected traffic retain
`Cache-Control: no-store`. The verification test also proves that the
existing session remains usable after the resend limit is reached.

For `reset`, the first three **invalid** tokens intentionally return
`400`: rate limiting counts requests regardless of application-level
success. The fourth request is rejected by the guard, before reaching the
service.

The test uses a test-only `Mailer` implementation: no real mail is
sent. The database is protected by `TEST_DATABASE_URL` and an isolated
UUID-based user fixture. With no `REDIS_URL` configured in CI, the
application's distributed storage uses its documented process-local
memory implementation; testing Redis-specific fail-closed behavior is
covered separately in the storage tests.

## Compatibility

**Tests and documentation only**. No runtime code, public endpoints,
Prisma schema/migrations, dependency versions, throttling policy or
GitHub Actions configuration changes.

All required GitHub Actions jobs must be green for the latest PR HEAD
before marking Ready for review. Do not automatically merge.
