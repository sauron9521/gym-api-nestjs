# Auth account-throttling Redis outage and recovery regressions — PR #123

## Purpose

The account recovery and email-verification resend guards were unified in
#122. Their existing unit tests cover propagation of storage errors (503),
and HTTP/PostgreSQL tests cover the normal 5/hour quota, but no integration
test deliberately interrupted the **real Redis transport** during an
authenticated auth workflow and checked its recovery.

This test uses a dedicated **TCP fault-injection proxy** in front of the
existing `TEST_REDIS_URL` Redis service. It injects an actual
`DistributedThrottlerStorage` configured with the proxy URL into both
account guards, rather than relying on mutable process environment
variables or a fake storage. Only this Nest test application connects to
the proxy: the shared CI Redis container remains running, and other
Redis test suites are not affected.

## Scenario

Run `AppModule` with the real authentication providers, database, both
account-throttle guards, `AuthAccountThrottleService` and
`DistributedThrottlerStorage`. Replace only the outgoing `Mailer` and
override the global IP `ThrottlerGuard` to ensure HTTP failures are
caused by account-level throttling, not by an earlier IP guard.

1. Create an unverified test account in the guarded PostgreSQL test
   database, log in, and establish that Redis is ready.
2. Successfully submit one password-reset request and one authenticated
   verification resend; confirm two submitted messages and two database
   email tokens.
3. Close live Redis proxy connections and reject new connections.
   `DistributedThrottlerStorage.checkReadiness()` reports unhealthy.
4. Check both routes return **503**, including for a nonexistent recovery
   email. Responses retain `Cache-Control: no-store`; neither raw email
   nor Redis connection strings are present in response bodies.
   No additional email token or mail submission is created, and the
   user's `emailVerified` flag remains unchanged.
5. Reopen the proxy and wait for the existing ioredis client to reconnect;
   check readiness returns healthy without restarting Nest.
6. Both routes return their normal **202** status again, issue tokens and
   submit email; the authenticated session remains valid.
7. Confirm counters **continue from before the outage**: after five
   accepted requests per account policy, the sixth returns **429** for
   both endpoints. Redis outage does not reset the hourly quota.

The test uses a unique identity and deletes only its own database records.
It does not flush Redis, change system-wide network settings or alter the
shared CI Redis container. Connections and the proxy close in cleanup.

## Scope and interpretation

This is a real local network outage/resumption test using plain
`redis://` on `TEST_REDIS_URL`. With no `TEST_REDIS_URL`, the Redis
test suite is skipped (same convention as existing Redis E2E tests).
No external mail is sent.

A successful test confirms fail-closed response handling and recovery
for this transport scenario. It does not establish service-level uptime
SLAs, fault tolerance of multi-region Redis clusters, or protection
against every possible failure mode.

Only a test suite and documentation are changed. No production code,
throttle limits, API contract, token TTL, migration or dependency changes.
Required CI gates must pass for the latest commit before merge.
