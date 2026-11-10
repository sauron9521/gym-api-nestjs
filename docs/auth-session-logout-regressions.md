# Session logout and global revocation HTTP regressions — PR #115

## Coverage gap

The previous session PRs (#112–#114) tested session listing, scoped DELETE
revocation, expiration cleanup, idle activity and absolute TTL. Existing
unit tests cover the controller's `signOut` and `signOutEverywhere` methods;
other HTTP suites already validate refresh-token family revocation.

This PR checks **cookie-session logout behavior at the full HTTP/PostgreSQL
boundary**, which is distinct from refresh-token revocation.

## Scenarios

1. **Single-device logout**: a POST to `/auth/sign-out` with one valid cookie
   returns HTTP 204, removes that session, and immediately denies its reuse.
   Another session for the same user and a different user's session both
   stay usable. Replaying the logged-out cookie is rejected.
2. **All-device logout**: authenticated POST to
   `/auth/sign-out-everywhere` invalidates both sessions of the acting
   user, while preserving the unrelated user's session.
3. **Missing or invalid cookie**: public `POST /auth/sign-out` responds
   with HTTP 401 and does not invalidate an unrelated valid session.
   Guard/error and successful auth responses retain `Cache-Control: no-store`.

Each case creates isolated user fixtures and exercises the real
`AppModule`, cookie authentication, `SessionsController` and PostgreSQL.
Only the per-IP throttler guard is bypassed to avoid cross-test rate-limit
interaction. The shared test database guard remains enabled.

## Non-goals and compatibility

Do not repeat refresh-token family tests or change JWT revocation policy:
short-lived access JWTs are stateless and remain valid until expiry unless
their principal becomes ineligible. This PR is **tests + documentation only**,
without endpoint changes, runtime logic, Prisma schema/migrations, auth TTLs,
dependencies or CI configuration.

Keep the PR Draft until every required GitHub Actions job is green for its
latest HEAD and the final diff has been reviewed. **Do not auto-merge**.
