# Password reset security regression coverage — PR #116

## Existing baseline

The password-reset controller already has mocked unit coverage for forgotten
password requests, successful and invalid reset responses, and MFA response
mapping. The PostgreSQL token-store contract covers atomic email-token
consumption. However, the whole request → mail → reset → credential/session/
refresh-token lifecycle had no dedicated real HTTP/PostgreSQL integration suite.

The application uses `@nestjs/authentication` with a concrete
`PasswordResetMailer` and `PrismaTokenStore`. The package documents
one-hour single-use links tied to the account's existing address and password
hash. After a successful reset, it revokes the user's older sessions and
refresh-token families, then `signIn: true` creates a new browser session.

## Added regressions

| Scenario | Security contract |
| --- | --- |
| Known and unknown email | Both requests return empty HTTP 202 with no-store; only the known account receives a reset email/token |
| Invalid and expired tokens | Reset returns 400 and the original password remains valid |
| Successful reset | Old password fails, new password succeeds, link replay fails, old cookie sessions and refresh family are invalidated, new session works |
| Two outstanding links | Using one invalidates the other, and no pending reset token remains |

The test `Mailer` is a spy: no email leaves the test process, but the
**real framework reset service, token store, credentials repository and
PostgreSQL** are involved. The async mail submission is awaited with
`vi.waitFor`, because the recovery endpoint intentionally returns 202
before dispatch finishes. The default application `ValidationPipe` and
`StandardSchemaValidationPipe` are applied, as in production. Only the
IP-based throttler is bypassed for test independence.

The fixtures use the dedicated `TEST_DATABASE_URL` guard and are physically
removed after each test; foreign-key cascades clean dependent auth records.

## Security limitations and future work

Short-lived **access JWTs are stateless** and normally remain usable until
their 15-minute expiry, even after password reset; this PR does not claim
immediate access-token invalidation. If immediate JWT revocation is a future
requirement, design a token-version/revocation check as a separate project.

Response-body equality does not prove constant-time behavior, although the
framework's documented asynchronous dispatch is intended to prevent obvious
timing-based account enumeration. Distributed guessing, abuse monitoring
and account-level rate limits are separate concerns.

## Compatibility and validation

This PR adds **tests and documentation only**: no code changes to production
auth, token TTLs, password hashing, routes, Prisma schemas/migrations,
dependencies or CI settings.

Keep the PR **Draft** until lint, build, tests, PostgreSQL integration,
dependency audit and Docker smoke pass on its latest commit. Review the final
diff and do **not auto-merge**.
