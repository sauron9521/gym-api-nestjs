# PR #66 — Exercise archive & planned workout lifecycle consistency

## Finding

PRs #64–65 serialized workout creation and start with trainer–athlete termination. However, `WorkoutsRepository.startWorkout()` had no **current archival-state check** on the referenced exercises. An athlete could create a planned workout using an active global, personal or trainer-authored exercise, then start it **after the exercise was archived**. Simply checking `isArchived` in a separate request is insufficient: archiving could commit between the read and the workout status transition.

## Implementation

The repository now performs a PostgreSQL **`SELECT ... FOR SHARE OF e`** on all `exercises` rows referenced by the candidate `PLANNED` workout, joined through `workout_exercises` and ordered by exercise UUID. The query returns only `id`, `source`, `createdById`, and `isArchived`.

- The exercise locks are held for the remainder of the **existing interactive `startWorkout()` transaction**, through its conditional `PLANNED → IN_PROGRESS` update.
- Archiving already uses a normal Prisma `exercise.update({ data: { isArchived: true } })`, whose PostgreSQL row lock conflicts with `FOR SHARE`. No new lock is needed in the archive endpoint.
- If **any** referenced exercise is now archived, the repository returns `null` *before* changing the workout, assignment `startedAt`, or performing further authorization checks.
- The same locked query supplies trainer ownership data for PR #65's ACTIVE relationship checks, replacing the previous unlocked trainer exercise lookup. For workout starts using a program assignment, lock order is **exercise rows → active trainer–athlete relationships → program assignment**. This order is preserved within the start transaction.
- When archival commits first, a start waits for the row and observes the updated archived flag; it is denied. When start obtains the row lock first, archive waits for the start transaction to commit, so the start was valid at the moment the state transition happened.
- Attempts to start a denied planned workout still return **409 Conflict** through the existing `WorkoutsService.start()` handling. Existing `IN_PROGRESS` or `COMPLETED` workouts are not revalidated or rewritten; historical exercise IDs, names and set snapshots remain intact.
- Already planned workouts can still be viewed, edited or cancelled according to current lifecycle rules; archiving is not a cascading deletion. Archived exercises cannot be selected for newly created workouts under the existing create-time checks.

This change focuses on concurrent **archiving** and **starting** existing workouts. It does not introduce transaction-level serialization of every exercise field edit or exercise-archive vs a concurrent *manual workout creation*, which can be assessed independently.

## Tests

- Repository units: live lock for global exercise references, trainer lock ordering, all three archived sources (`GLOBAL`, `ATHLETE_CUSTOM`, `TRAINER_CUSTOM`), program assignment timestamp unchanged, no mutation of already-started workouts.
- PostgreSQL integration: archived global, athlete-owned and trainer-owned manual starts all rejected; program workout with archived global exercise rejected without advancing assignment; starting first then archiving retains in-progress history; deterministic archive-first race uses actual row locks and `pg_blocking_pids()` to verify PostgreSQL waiting and denial after commit.
- HTTP E2E: a real athlete creates a private exercise and workout, archives the exercise via `DELETE /exercises/:id`, and receives safe `409 Conflict` with `Cache-Control: no-store` on start. `GET /workouts/:id` still returns the unchanged planned workout with its historical name snapshot.

## Compatibility

No Prisma schema changes or migrations, public DTO changes, new dependencies, or successful response-shape changes. The intentional behavior change is **409 instead of 200** for an attempt to start a planned workout referencing an archived exercise. Existing in-progress training and historical snapshots remain available.
