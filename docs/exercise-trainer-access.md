# Exercise trainer access API

Athletes can explicitly grant a connected trainer read access to an
athlete-owned custom exercise. Sharing is **opt-in**; it does not make
the exercise public to every trainer.

## Endpoints

All three endpoints require an authenticated athlete. A foreign, archived,
global or trainer-owned exercise is treated as `404 Exercise not found`.

- `GET /exercises/:id/trainer-access` — list active grants for this athlete
  and exercise, with `{ id, exerciseId, trainerId, grantedAt, revokedAt }`
  records (not trainer email addresses).
- `POST /exercises/:id/trainer-access` with
  `{ "trainerId": "<UUID>" }` — grant/regrant access. Returns **200** with
  the grant record.
- `DELETE /exercises/:id/trainer-access/:trainerId` — revoke access. Returns
  **204** even if the grant was already revoked or was never created.

The POST requires the exercise to be `ATHLETE_CUSTOM`, created by the
requesting athlete, unarchived, and set to `SELECTED_TRAINERS`. A trainer
must currently have an `ACTIVE` trainer–athlete relationship with the owner.
If visibility is `PRIVATE` or the relationship is not active, POST returns
**409**. Malformed IDs and mass-assignment payloads return **400**. Guests
receive **401** and other authenticated roles receive **403**.

## Concurrency and revocation

The `grant` transaction locks the exercise with `FOR UPDATE` before
checking its visibility, and locks the active trainer–athlete relationship
with `FOR UPDATE` before upserting the grant. Those locks serialize
concurrent private-visibility updates, archiving and relationship
termination with a new grant.

The uniqueness constraint on `(exerciseId, trainerId)` is reused to
restore previously revoked grants without duplicate rows. The existing
`PATCH /exercises/:id` logic revokes grants when setting `PRIVATE`; the
existing relationship termination transaction revokes grants when
collaboration ends.

Read access is already enforced by
`buildExerciseVisibilityWhere()`: it requires the grant, the
`SELECTED_TRAINERS` visibility and an active trainer–athlete relationship.
An old grant never overrides a terminated relationship.

The list endpoint independently filters to active relationships to avoid
displaying obsolete permissions. The DELETE endpoint permits cleanup even
if the relationship is no longer active.

## Verification

The PR adds DTO and service tests, response-contract tests, and HTTP +
PostgreSQL integration coverage for authorization, isolation,
grant/revoke/regrant, status code behavior, private-visibility revocation,
and relationship termination.

No Prisma schema change or migration is needed because
`ExerciseTrainerAccess` and the relevant indexes already exist.
