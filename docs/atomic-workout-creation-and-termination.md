# PR #64 — Atomic workout creation and trainer–athlete termination

## Security finding

Manual workouts previously validated exercise availability through a normal service query and **later** inserted a workout in a separate database call. If collaboration terminated in between, a stale authorized exercise could be used to create a new workout. The program-workout creation transaction already locked its assignment, but only checked the trainer–athlete relationship without locking it; termination locks the relationship first, then updates assignments.

## Manual workout creation

`WorkoutsRepository.create(data, athleteId, exerciseIds)` now owns an interactive PostgreSQL transaction:

1. Identify the creators of referenced `TRAINER_CUSTOM` exercises (without loading private exercise details into an HTTP response).
2. Acquire `FOR SHARE` locks on the **currently ACTIVE** `trainer_athletes` rows for those trainers and the acting athlete. Skip the lock SQL if there are no trainer-owned references.
3. Under the **same transaction**, re-read all referenced exercises using `buildExerciseVisibilityWhere`, the currently locked active relationships, and `isArchived: false`. Reject with the preexisting `400 One or more exercises are not available` if any UUID is inaccessible.
4. Insert the workout and nested exercises/sets before committing. Relationship locks remain held through the insert.

Termination already uses a transaction that updates the relationship row and then performs copies, revocations and assignment updates; `FOR SHARE` conflicts with that UPDATE. If termination holds the row first, creation waits and then sees the terminated status, rejecting without a workout. If creation holds the row first, termination waits until the workout commits, making the order explicit. Global and the athlete's own exercises do not require relationship locks but still pass the transactional access check.

The existing service-level check is kept as a quick preflight and to preserve the snapshot/input construction; it is explicitly **not** the final authorization boundary.

## Assigned program workouts

`createFromProgram` now locks the ACTIVE relationship row using `FOR SHARE OF relationship` **before** locking the training program assignment. This matches termination's lock order (relationship → assignment), and avoids an ABA/race where the assignment was active while its relationship was being revoked. The existing assignment `FOR UPDATE` check and published-version constraints remain intact.

## Regression tests

- Repository unit tests verify the locked relationship path, final availability check, no insert on denied access and error propagation.
- Existing service tests verify all three mandatory arguments are passed into protected creation.
- Real PostgreSQL concurrency integration tests hold a relationship row lock in one transaction, launch manual or assigned-program creation in another, observe a genuine PostgreSQL lock wait with `pg_blocking_pids()`, commit termination and assert no new workouts are written.
- Existing idempotency, program assignment, trainer/athlete exercise-copy and E2E coverage continues to run in CI.

## Compatibility

No changes to Prisma models, migrations, DTOs, API response bodies, success codes, roles, or dependency versions. `400` remains the manual-workout rejection for unavailable exercises, and program-based creation still maps missing/inactive assignment to `404` at the service boundary.

**Boundary:** This serializes relationship termination against **creation** of new workouts with trainer-owned exercises, not all possible later operations on already-created planned workouts. Existing in-progress workout and private-copy policies remain unchanged. Full transactional snapshot consistency for concurrent edits/archives of the exercise record itself is a separate concern.
