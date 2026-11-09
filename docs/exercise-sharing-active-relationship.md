# PR #63 — Exercise sharing & trainer access security

## Finding

Exercise access for trainers and athletes was previously evaluated in two steps: `TrainerAthletesService.getExerciseAccessContext()` first queried the currently active relationships and returned a list of IDs, and `buildExerciseVisibilityWhere()` subsequently used that list in a separate Prisma read/availability query. Termination can happen **between those steps**. Even with termination revocation in one database transaction, a request that already obtained the IDs could still query trainer-owned exercises after a relationship ended. Selected trainer access was also contingent on the stale list rather than rechecking the ACTIVE relationship in the same SQL query.

## Change

Both shared-exercise branches of `buildExerciseVisibilityWhere()` now **also check a current ACTIVE trainer–athlete relationship via the exercise creator's Prisma relation filter**:

- Athlete reading a trainer-created exercise: `createdBy.trainerRelationships.some({ athleteId: actor.id, status: 'ACTIVE' })`, in addition to the existing allowed-trainer ID filter.
- Trainer reading an athlete-created exercise: `createdBy.athleteRelationships.some({ trainerId: actor.id, status: 'ACTIVE' })`, in addition to `visibility: SELECTED_TRAINERS`, an unrevoked explicit grant and the existing allowed-athlete ID filter.

This protects list/detail views, workout exercise validation and the reusable `findAvailableForWorkout` API for any query issued **after relationship termination committed**, even if a previously obtained context is passed to the service. The queries evaluate the active relationship in the same PostgreSQL statement as the exercise selection. A separate transaction/lock would still be required to make a *workout creation* and *relationship termination* fully serializable under exact concurrent execution; this change does not claim to solve that broader transactional race.

## Compatibility

No changes to database models, DTOs, API shape, HTTP statuses or previously permitted reads/writes. Existing global, personal and admin visibility is unchanged. The trainer can still manage trainer-owned exercises; after termination an athlete retains private copies of trainer exercises referenced by eligible prior training activity, not the original shared resources. The trainer cannot view the athlete's copied resources. Program editing still restricts source exercises to global or trainer-owned.

## Tests

- Unit policy snapshots explicitly assert the new LIVE relationship checks for both roles, including stale contexts.
- Existing full HTTP + PostgreSQL termination/copy E2E test now checks active-state visibility in both directions, direct service access with a retained ACTIVE context before/after termination, 404 for both former partners, denied new workouts with the revoked original, and continued access to an athlete-owned private copy.
- Existing copy, assignment revocation and in-progress history expectations remain tested.

CI: Prisma validation/generation, lint, TS/ESM build, unit, PostgreSQL integration/E2E, OpenAPI/types, coverage, security audit, Docker production HTTP smoke.
