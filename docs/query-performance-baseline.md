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
CI smoke-checks it with 2,000 rows **after migrations**, and tests its guard
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

## PR #151: targeted indexes and validation

The initial CI baseline from PR #150
([run 43168907107](https://github.com/sauron9521/gym-api-nestjs/actions/runs/43168907107))
used only **100 rows**. PostgreSQL selected sequential scans and sorts on
some queries, with observed execution times below 0.4 ms on that small fixture.
That does **not** prove an index would make those small queries faster.

Two new nonunique B-tree indexes match stable page ordering and filtering:

- `workouts_athlete_id_created_at_id_idx`: `athlete_id, created_at DESC, id DESC`.
- `training_program_assignments_athlete_id_assigned_at_id_idx`:
  `athlete_id, assigned_at DESC, id DESC`.

The existing `(athlete_id, status, assigned_at)` assignment index stays: the
`status` middle column makes it useful for differently filtered workloads.
Trainer assignment queries join program ownership, so neither new index
guarantees improvement for that path. The `training_program_workouts`
nonunique index on `(version_id, week_number, day_number)` is removed because
the surviving unique index has the same key order.

Each index operation lives in its **own** migration file and uses
`CONCURRENTLY`, with no explicit `BEGIN/COMMIT`. This is intentional:
PostgreSQL cannot run concurrent index builds/drops inside a transaction block.
CI's `prisma migrate deploy` and the integration test verify the physical
result. Do not combine these operations into one SQL migration.

### Staging / production deployment checklist

1. First verify backup/restore readiness, disk space, migration state,
   and a maintenance/monitoring window even though concurrent index builds
   do not normally block ongoing inserts or updates.
2. Apply the three migrations in committed order using
   `npm run db:migrate:deploy` (configured for Prisma ORM 7).
   Do not apply schema changes with `db push` in production.
3. Check `pg_index.indisvalid` and `pg_index.indisready` for the new indexes
   and confirm the old duplicate index is gone.
4. Re-run `npm run perf:queries -- --rows=2000` and optionally 10k/20k on
   a dedicated, migrated **test** database; compare query plans at the same
   size, not just elapsed time from different runners.
5. Monitor writes, disk consumption, query plans and workload-level p95
   response latency; adding indexes increases write and storage overhead.

**Failure recovery:** Concurrent index creation can leave behind an
`INVALID` index. If that happens, stop rollout; inspect the catalog and
the `_prisma_migrations` failure. With DBA approval, drop the invalid index
using `DROP INDEX CONCURRENTLY`, then use the documented Prisma
`migrate resolve --rolled-back` recovery procedure before retrying. Do not
edit an already applied migration, blindly rerun `IF NOT EXISTS`, or
delete a valid unique constraint index. The test suite checks that the
unique workout slot index is still present.

These are **query-shape optimizations**, not yet measured production speedups.
The benchmark is SQL-based, not full Prisma/HTTP request profiling.
