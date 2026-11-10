# Auth account-throttling Redis-client outage and recovery — PR #123

## Purpose

PR #122 consolidated account-level auth throttling. Existing unit tests
cover mocked Redis errors, while the HTTP/PostgreSQL suites cover normal
rate limits. This integration test exercises **an actual Redis client
disconnect and reconnect** through the real Nest authentication routes.

The test uses a real `DistributedThrottlerStorage` instance connected to
`TEST_REDIS_URL`. It injects that instance into the Nest application so
both account guards depend on the same real Redis client, irrespective of
when other tests initialize ConfigModule. Only the client belonging to
this test application is disconnected; the **shared CI Redis service is
never stopped, flushed or restarted**.

## Scenario

Use `AppModule`, real authentication/session providers, guarded test
PostgreSQL, both account guards and Redis storage. Replace only the
outgoing `Mailer`, and bypass the *global IP guard in this test only* to
isolate account-level failure handling.

1. Create one unverified test user, log in and establish that Redis is
   healthy.
2. Both account endpoints return **202**. Confirm two persisted email
   tokens and two mail submissions.
3. Explicitly disconnect the **real ioredis client** held by the
   injected storage. Readiness becomes unhealthy.
4. `POST /auth/password-reset/forgot` and authenticated
   `POST /auth/email/verification` return **503**, before creating any
   new token or invoking the mailer. A request for an unknown recovery
   email also returns 503.
5. Check `Cache-Control: no-store`, response privacy, preserved
   `emailVerified: false`, token count and mail count.
6. Reconnect that same Redis client without restarting NestJS.
   Readiness becomes healthy, both routes return **202** and the user's
   existing session remains valid.
7. The original Redis counters survive the client interruption: five
   accepted requests per account policy are followed by **429** for the
   sixth. Tokens and mail submissions match exactly the accepted calls.

All test identities are unique and PostgreSQL fixture cleanup deletes
only that user's rows.

## Scope and limitations

The fault is a **controlled Redis-client disconnection**, not a simulated
network partition or a shutdown of the remote Redis server. It proves the
fail-closed and manual reconnection lifecycle for the real client and
real HTTP flows, but does not independently validate ioredis' automatic
reconnection timing, multi-region failover, or service-level availability.

This test runs only when `TEST_REDIS_URL` is configured; otherwise it
skips, consistent with the existing Redis integration suites. No actual
emails are sent.

**Tests and documentation only.** No changes to application behavior,
Redis configuration, throttling thresholds, Prisma, migrations, API
contracts or dependency versions. Require all CI checks green on the
latest PR commit before merging.
