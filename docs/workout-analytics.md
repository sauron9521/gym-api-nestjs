# Workout analytics (initial athlete-only API)

This is a **read-only, athlete-owned analytics** module, separate from
`WorkoutsService`. It uses PostgreSQL aggregates instead of loading every
workout/set into memory. No trainer or administrator can request another
athlete's historical workout results from these endpoints.

## Endpoints

Both require the existing session cookie or Bearer JWT and role `ATHLETE`.

- `GET /workout-analytics/summary?range=7d|30d|90d`
- `GET /workout-analytics/exercises/:exerciseId?range=7d|30d|90d`

Default range: `30d`. Unknown ranges, unknown query keys and invalid UUIDs
receive `400`. There is deliberately **no userId/athleteId query parameter**.
An exercise ID with no completed workout history for the authenticated
athlete receives `200` and an empty series with `name: null`; it does not
reveal whether that exercise exists for another user.

### Summary response

```json
{
  "range": "7d",
  "from": "2026-11-03T00:00:00.000Z",
  "asOf": "2026-11-09T22:00:00.000Z",
  "workoutCount": 3,
  "activeDays": 2,
  "completedSets": 4,
  "strengthVolumeKg": 1434,
  "daily": [
    { "date": "2026-11-07", "workoutCount": 2,
      "completedSets": 3, "strengthVolumeKg": 1084 },
    { "date": "2026-11-08", "workoutCount": 1,
      "completedSets": 1, "strengthVolumeKg": 350 }
  ]
}
```

### Exercise response

```json
{
  "range": "7d",
  "from": "2026-11-03T00:00:00.000Z",
  "asOf": "2026-11-09T22:00:00.000Z",
  "exerciseId": "14e80acf-9669-4e6a-81c5-18e706d1b391",
  "name": "Bench Press",
  "workoutCount": 3,
  "completedSets": 3,
  "strengthReps": 23,
  "strengthVolumeKg": 1434,
  "bestWeightKg": 70,
  "daily": []
}
```

The example `daily` array is abbreviated; actual results include one entry
per UTC date with a completed workout containing the specified exercise,
with `date`, `workoutCount`, `completedSets`, `strengthReps`,
`strengthVolumeKg`, and `bestWeightKg`.

## Definitions and exclusions

- Range is exactly **7, 30 or 90 UTC calendar dates**, including the current
  UTC date, starting at 00:00:00 UTC and ending at response `asOf`.
  The server and PostgreSQL host timezone or DST do not shift buckets.
- A **workout** counts only when `status = COMPLETED` and
  `completed_at` is inside the interval. `PLANNED`,
  `IN_PROGRESS`, `CANCELLED` and out-of-range records do not count.
- **Completed sets** count `workout_sets.status = COMPLETED` for all
  exercise types. Pending and skipped sets are excluded.
- **Strength volume in kg** is the sum of
  `actualReps * actualWeightKg` for completed sets whose **historical
  exercise type snapshot** was `STRENGTH`, only when both actual values
  are recorded. It includes all set types, including warmups.
  **Planned** reps/weight are never used.
- **Strength reps** sums `actualReps` for completed sets of strength
  exercises. Reps with no actual weight still count here but add zero to
  volume.
- **Best weight** is the highest actual weight among completed strength
  sets, **not a personal record with a standard form definition or
  estimated 1RM**. If none exist, it is null.
- **Active days** count distinct UTC dates with completed workouts.
- Exercise grouping uses historical `exerciseId` and the latest recorded
  name snapshot inside the requested interval. Renaming/archiving a
  catalog exercise does not rewrite historical analytics.
- An empty range returns zeros and `[]`, not fabricated daily zero rows.
  Chart clients can fill gaps for display without altering API data.

## Database, security and growth

Both endpoints filter by authenticated `athlete_id`; exercise ID is a
parameterized SQL value, never used as an identifier in SQL. Only the
specific aggregates and historical snapshots are read, avoiding mass
object hydration or access to other athletes' names and notes.

The exercise metadata and daily query share one PostgreSQL `REPEATABLE
READ` snapshot. Summary uses one grouped query. A new index
`(athlete_id, status, completed_at DESC)` supports bounded filtering;
the migration is forward-only and should be applied before scaling
analytics traffic. The date grouping can involve sort/hash grouping
and joining workout exercises/sets, so validate with representative
`EXPLAIN (ANALYZE, BUFFERS)` in staging before heavy public use.

**Not included in this first version:** all-time records, estimated 1RM,
muscle-group allocation, weekly trainer dashboards, exercise-copy lineage
grouping, pace/cardio statistics, custom user-timezone grouping or cached
time-series materializations. Define their distinct semantics in future PRs
rather than making misleading assumptions now.
