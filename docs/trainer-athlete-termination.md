# Terminating trainer–athlete relationships

The HTTP contract and ownership/redaction policies have not changed.

## Atomic workflow

`TrainerAthletesService.terminate()` performs an authorization and initial
status check. `TrainerAthleteTerminationService` performs the authoritative
transition in **one Prisma interactive transaction**:

1. Recheck that the relationship is active and the actor participates.
2. Atomically claim the relationship status transition to TERMINATED.
3. Collect exercises referenced by active program assignments and end those assignments.
4. Copy eligible trainer-owned exercises into private athlete-owned exercises.
5. Revoke trainer exercise assignments and trainer access to athlete exercises.
6. Return a redacted relationship response for trainers or a full response for athletes.

`TrainerAthleteExerciseCopyService.copyRelevantExercises()` receives the
transaction client from its caller. **It must never open its own transaction.**
If a copy or revoke step fails, the whole transaction must roll back.

## Copy eligibility

Only trainer-owned `TRAINER_CUSTOM` exercises that were assigned to the
athlete, occurred in started/completed workouts during the relationship, or
are part of an active assigned training program are considered. Already
copied exercises are skipped. Copies preserve the original's descriptive
information, muscle groups and equipment, but have source `ATHLETE_CUSTOM`,
visibility `PRIVATE` and the athlete as owner.

## Compatibility & checks

- No API routes, response projections, or database migrations are modified.
- Unit tests cover the coordinator and the copy policy separately.
- Existing HTTP/PostgreSQL E2E tests verify retained data, copy ownership,
  privacy, and concurrent termination behavior.
