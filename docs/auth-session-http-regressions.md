# Session-management HTTP regressions — PR #112

## Context

The previous token lifecycle PR (#111) hardened refresh-token families.
Existing session coverage includes a store contract, direct Prisma integration,
a soft-deleted owner check, and controller unit tests with mocked
`SessionService`. It did not exercise the session-list and per-session revoke
routes together across two principals using real Nest guards, cookies and
PostgreSQL.

`AuthModule` permits both cookie-based and JWT bearer authentication.
A JWT-authenticated request has an authenticated principal but may not have
a `@CurrentSession()` record. The existing `GET /auth/sessions` code
dereferenced `current.id` without accounting for that mode.

## Changes

- Allow `SessionsController.list` to accept an absent current session and
  report `current: false` for every returned session when authenticated
  via bearer token only.
- Pin the bearer-only projection in a focused controller unit regression.
- Add a dedicated HTTP/PostgreSQL integration suite covering:
  - Two simultaneous cookie sessions, exactly one `current` per cookie,
    and an allowlisted response (id, timestamps, user agent and current flag)
    without owner IDs or session metadata.
  - JWT-only access to `GET /auth/sessions`, with no accidental `current`
    session or a server error.
  - Cross-user list isolation and 404 revocation of a foreign session.
    An authorized 204 revoke invalidates only the chosen owned cookie;
    repeat revocation is 404; other active sessions remain valid.

## Compatibility and validation

No Prisma schema/migration, new dependency, token/session lifetime or endpoint
change. One null-safe controller projection fixes the mixed-auth behavior.
The new HTTP tests use the existing `TEST_DATABASE_URL` guard, a real
Nest application and user-scoped fixture cleanup. For isolation these tests
bypass only the per-IP throttler guard; auth providers and DB access run
normally.

Run the usual build, lint, unit tests, PostgreSQL E2E and full required
CI gates on the latest HEAD. Keep as Draft until all required checks succeed
and the final diff is reviewed. **No automatic merge.**
