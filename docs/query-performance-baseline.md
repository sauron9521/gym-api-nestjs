# Workout and assignment query performance baseline

## Current behavior

The two public list endpoints support `view=summary` and `view=full`:

- Workouts: `GET /workouts?page=1&limit=20&view=summary`.
- Assignments: `GET /training-programs/assignments?page=1&limit=20&view=summary`.

`summary` avoids hydrating nested workout sets / historical workout arrays
and is recommended for list screens. Omitting `view` currently preserves the
legacy **full** response, so this PR intentionally makes no incompatible
endpoint/DTO changes. Full assignment rows may include every related workout
even though the number of assignment rows is paginated.

Both repositories page using an immutable ID tiebreaker after
`createdAt DESC` (workouts) or `assignedAt DESC` (assignments). They
also perform a matching `COUNT(*)` query for the total. Trainer list access
uses the trainer's program ownership, and historical trainer relations must
not disclose private contact data.

## Repeatable PostgreSQL probe

Run only against a **dedicated** PostgreSQL test database with migrations:

```sh
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gym_app_test npm run perf:queries -- --rows=2000
```

The script:

1. Requires `TEST_DATABASE_URL`; refuses names not ending in `_test`.
2. Opens a transaction, creates synthetic trainer/athlete, a program/version,
   a trainer-athlete relationship, and equal-sized assignment/workout samples.
3. Executes `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for workout list/count,
   filtered workout list, athlete assignment list/count and trainer list/count.
4. Prints planning time, execution time, returned rows, shared buffers and
   observed plan-node types.
5. **Always rolls back** seeded data on success or failure.

The tool accepts `--rows=N` in the 1–20,000 range (default 2,000).
CI smoke-checks it with 100 rows **after migrations**, and tests its guard
rails without a database. No timing-based CI failure threshold is enforced:
GitHub-hosted runners are noisy, and elapsed latency must be assessed on a
consistent/staging machine with representative row counts.

## How to interpret the results

- Check if a `Sort` or `Seq Scan` persists at larger row counts, versus
  an index scan; collect results at 2k, 10k, and 20k.
- Current Prisma indexes include `(athlete_id, scheduled_at)` and
  `(athlete_id, status, scheduled_at)` for workouts, but the default page
  order is `(created_at DESC, id DESC)`.
- Assignment indexes include `(athlete_id, status, assigned_at)`, while
  the unfiltered athlete list orders by `(assigned_at DESC, id DESC)`;
  trainer listings filter through version/program ownership.
- Candidate composite indexes and migration safety belong in PR #151:
  add only when the larger-scale plans justify them. Compare write overhead
  and `EXPLAIN` after migration.
- This SQL probe intentionally models filters and ordering, **not the exact
  Prisma-generated SQL**, relation hydration, API authorization overhead, or
  HTTP serialization. Collect a separate p95 HTTP benchmark on staging
  before claiming request-level latency improvements.
- The benchmark's rollback avoids persistent fixtures; it still performs
  normal test-database queries and may temporarily consume resources.
  Do not run it against production credentials or a shared service.
