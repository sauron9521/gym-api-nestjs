# Workout transaction and idempotency regression audit (PR #109)

## Existing test coverage

Workouts already includes PostgreSQL-backed concurrency tests for assignment
completion against creation, relationship termination, exercise archival,
and set updates against completion/cancellation. HTTP coverage also checks
concurrent identical manual creation requests, program-based creation,
sequential conflicting-key requests, and per-athlete key scoping.

## New coverage

1. Simultaneous creation requests with the same idempotency key and different
   bodies: exactly one success, one conflict, one persisted workout.
2. A retry after a permitted workout edit returns the same workout with its
   current state, without creating a second record.
3. Simultaneous requests with the same key from two different athletes
   remain independent and do not expose one another's workout.
4. Canonicalization of undefined, null and array ordering for request
   fingerprints, plus header key-length and character boundaries.
5. Fail-closed set updates/completion when the parent row is missing,
   completed, or lacks qualifying completed sets under the transaction lock.

## Verification and compatibility

Existing Vitest unit suites, coverage, PostgreSQL-backed E2E suites, and
required CI gates exercise all added scenarios. Runtime business logic, HTTP
APIs, Prisma schema, migrations and npm dependencies are unchanged.

These are targeted gaps, not a claim of missing tests for every other
concurrency path: many were already thoroughly covered.
