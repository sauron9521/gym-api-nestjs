# Session idle and absolute TTL regressions — PR #114

## Background

The application configures `@nestjs/authentication` with
`session: { absoluteTtl: '7d', idleTtl: '1d' }`.
The library's default `touchInterval` is one minute. The expiration tests
in PR #113 cover database `expiresAt` cleanup and access denial after
absolute expiry. They do not cover **idle inactivity**, refreshing the idle
clock through HTTP, or retaining the absolute expiry on activity.

## New end-to-end coverage

The existing HTTP/PostgreSQL session-management suite now includes three
additional cases using the real Nest authentication providers:

1. A session whose `lastActiveAt` is **more than 24 hours** in the past
   receives HTTP 401 for protected user and session-list routes, although its
   absolute `expiresAt` is still in the future. A second login remains valid.
2. An authenticated request with `lastActiveAt` twenty minutes ago is
   permitted and moves `lastActiveAt` forward (beyond the default
   one-minute touch interval), but **does not change `expiresAt`**.
3. A newly issued cookie session receives an absolute lifetime of about
   **seven days**, and an expired `expiresAt` rejects the cookie even when
   `lastActiveAt` is fresh.

The tests backdate PostgreSQL timestamps instead of using fake timers across
the global Nest application. A margin around the one-day boundary avoids
wall-clock precision races. Fixture users are removed between test cases;
the existing `TEST_DATABASE_URL` guard ensures an isolated test database.

## Compatibility

This PR adds **tests and documentation only**, without changing runtime
behavior, auth TTLs, Prisma models/migrations, dependencies, API contracts,
or CI settings.

All required CI gates must pass on the latest PR head. Keep this PR as a
draft until the diff is reviewed and checks are green; **do not merge
automatically**.
