# PR #67 — Atomic Exercise Archive & Workout Creation

## Security finding

`WorkoutsRepository.create()` already rechecked `isArchived: false` after locking trainer–athlete relationships, but did **not lock the exercise row**. An exercise owner/admin could archive it between that validation and the workout insert. The `createFromProgram()` path copied exercise snapshots from an active published training-program version without a final `isArchived` check at all. The existing PR #66 protection on **starting** planned workouts cannot undo an unauthorized new workout that was already saved.

## Change

Both manual workout creation and `createFromProgram()` now secure referenced exercise rows using a parameterized PostgreSQL `SELECT ... FOR SHARE`, ordered by exercise ID, inside the same existing Prisma interactive transaction as the final workout insert:

1. Resolve the distinct exercise IDs. For manual creation, use the supplied exercise IDs; for program creation, prefetch referenced IDs from the athlete's ACTIVE program assignment and PUBLISHED version, without returning private data to the API.
2. Lock all referenced exercise rows via `FOR SHARE`. This conflicts with Prisma's row UPDATE during `ExercisesRepository.archive()`, so the archive and workout insert cannot both commit based on a stale archival status.
3. Require all requested rows to exist and have `isArchived: false`. In manual creation, failures retain the current `400 One or more exercises are not available` contract. In program creation, return `null` (mapped to the existing service `404` response), without mutating the assignment or creating a workout.
4. Derive trainer IDs from the **locked** exercise rows, lock ACTIVE trainer–athlete relationships, and repeat manual workout visibility checks. The program path also locks its original ACTIVE relationship and the ACTIVE assignment, then verifies its final program-workout references match the locked ID set.
5. Insert the workout, nested exercises and set snapshots before releasing locks at transaction commit.

The lock ordering in manual and program creation is now **exercise rows → trainer–athlete relationships → program assignment**, aligning with PR #66 planned-workout start logic. This avoids opposite lock ordering between those flows. Existing relationship-termination transactions still serialize on the relationship row before they commit their revocations/copies; this PR does not rewrite termination or copy semantics.

If archival already holds a conflicting lock, creation waits and then observes `isArchived: true` and denies the write. If creation takes the shared lock first, archival waits until the workout creation commits; the workout was authorized at insert time. This protection applies to global, athlete-created and trainer-created exercises.

The service-side preflight check is deliberately retained for early feedback/snapshot generation; it is **not the final authorization boundary**. Exercise locks and the final access validation remain in the repository transaction.

## Regression tests

- Repository unit tests: shared exercise locks precede relationship locks and inserts, all three archived source categories are refused before writes, unknown IDs fail safely, trainer access is still required and duplicate exercise references are deduplicated.
- Real PostgreSQL integration: manual creation with an already archived exercise is denied; assigned-program creation with an archived source is denied; real concurrent archive-first transactions block both manual and assigned-program creation using `pg_blocking_pids()`; creating before a later archive preserves snapshot history.
- HTTP E2E: a real athlete archives their previously used exercise and cannot create a new workout from that source (`400`, uniform error envelope, `Cache-Control: no-store`), while an earlier planned workout remains in history and cannot start after archival (PR #66).

## Compatibility and scope

No Prisma schema/migration, DTO, dependencies, success-response shape, or endpoint changes. The intended behavior change is that new workouts referencing an archived exercise are rejected even when archival races the insert. Program-based creation now also rejects archives instead of creating an unusable workout. Previously started/completed workout history is unchanged.

This PR addresses **archival versus workout creation**, not transactional serialization of every metadata edit or concurrent modification of published program definitions. A protected published-version editing policy remains a separate invariant.
