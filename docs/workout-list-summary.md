# Workout list response size

## Overview

`GET /workouts` keeps its current **full** response by default. Web/Mobile
clients that only need a calendar/history card can opt in to a compact
projection with `GET /workouts?view=summary&page=1&limit=20`.

The `summary` response has the same `{ data, meta }` envelope and
authorization/filter/pagination behavior. Each data item contains:

- `id`, `title`, `athleteId`, `createdById`, `status`
- `scheduledAt`, `startedAt`, `completedAt`
- `programAssignmentId`, `programWorkoutId`
- `createdAt`, `updatedAt`, `exerciseCount` (integer)

It **does not** return `notes`, nested `exercises`, or nested `sets`.
`exerciseCount` is the Prisma relation count computed by PostgreSQL.
The implementation never loads the exercise or set row arrays to produce
this summary.

`GET /workouts?view=full` and requests without `view` continue to
return the existing complete workout response, as does
`GET /workouts/:id`.

## Considerations

- The compact representation is opt-in for backwards compatibility.
- `view` accepts only `summary` and `full`; unknown values return 400.
- Both views retain the existing athlete ownership filter.
- Both views use the same stable sort and pagination metadata.
- `exerciseCount` counts workout exercise slots, not unique exercise IDs.
- A future major API version may make summary the default after clients
  migrate and contract tests are updated.
- If clients need set totals, prefer a separate aggregation query to
  reloading all nested sets for every list row.

## Verification

Check the repository's unit, DTO, OpenAPI contract and integration/E2E tests,
then benchmark payload size and query timing against a realistically populated
test database. No performance numbers are claimed here without measurement.
