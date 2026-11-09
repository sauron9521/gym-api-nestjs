# PR #65 — Planned workout start authorization

## Problem

The exercise-sharing authorization checks introduced in PR #63, and transaction-level protection for *creating* workouts introduced in PR #64, do not protect **starting an already-created, PLANNED manual workout**. A workout may have been created while a trainer–athlete relationship was ACTIVE, but the trainer may terminate collaboration before the athlete presses Start. The workout still contains historical trainer exercise references. Previously `WorkoutsRepository.startWorkout` only validated the training-program assignment status for program workouts; manual planned workouts transitioned to `IN_PROGRESS` without checking whether the athlete retained access to the trainer-owned exercises.

## Solution

`WorkoutsRepository.startWorkout()` now performs all checks inside its existing PostgreSQL interactive transaction:

1. Read the planned workout for the authenticated athlete (the existing precondition).
2. Identify **TRAINER_CUSTOM** exercise owners referenced by that workout.
3. For program workouts, also identify the exact `trainerAthleteId` of the original program assignment. This prevents a newly established relationship with the same trainer from reactivating an older terminated assignment.
4. Acquire `FOR SHARE` locks for the required **ACTIVE trainer–athlete relationship rows**, ordered by primary key. The shared lock conflicts with the `UPDATE` used by the termination transaction. This reuses the same locking helper as PR #64 workout creation. For exclusively global/athlete-owned manual workouts there are no relationship locks.
5. If any required trainer is inactive, or a program assignment's original relationship is inactive, abort with no mutation. Otherwise, acquire the program assignment's existing `FOR UPDATE` lock (if present), verify status ACTIVE and update `startedAt` on its first start.
6. Transition the planned workout to `IN_PROGRESS` under the original conditional `id`/`athleteId`/`status` update while the locks are held.

If termination wins, starting the workout returns `null` from the repository and the existing service maps it to **409 Conflict**. If starting wins, termination waits for the transaction commit, so the start is authorized at the time of transition.

This changes the behavior of **manual workouts using trainer-created exercises after access revocation**: they can still be viewed/edited/cancelled for historical context, but **cannot be started** without an ACTIVE relationship. A workout that was already `IN_PROGRESS` remains in progress after termination; its snapshot and performance history are preserved. Personal and global planned workouts can still start independently. Termination's private-copy policy remains unchanged; athletes may create a new workout using their own copy.

For program workouts, the existing requirement for an ACTIVE program assignment remains; the additional matching relationship check defends against invalid/inconsistent assignment states and applies the same lock order as termination (relationship → assignment).

## Regression tests

- Repository unit tests: successful start without trainer access for global-only workouts; multiple trainer references deduplicated and locked; rejection after revocation; program relationship mismatch; relationship-before-assignment order; no mutation for already-started workouts.
- PostgreSQL integration tests: active shared exercise starts; terminated shared exercise stays PLANNED and keeps its historical snapshots; global-only workout continues to work; two real concurrent termination/start races observed through `pg_blocking_pids()`; program start blocked even if its assignment still says ACTIVE when the underlying relationship is terminated.
- HTTP E2E: create an unused trainer-exercise PLANNED workout during ACTIVE collaboration, end the relationship, verify `POST /workouts/:id/start` returns the existing safe 409 conflict with `no-store`, and confirm the original workout and snapshots are untouched.

No Prisma migration, DTO, dependency or success-body changes.
