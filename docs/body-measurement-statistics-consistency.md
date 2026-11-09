# Body-measurement statistics: consistent snapshots and UTC-day charts

The existing authenticated endpoint `GET /body-measurements/statistics`
supports one metric at a time with chart ranges of 7, 30, or 90 days.
This change corrects **read consistency and chart date boundaries** without
changing the HTTP response shape, Prisma schema, or the existing user
permissions.

## Consistency

The endpoint calculates `first`, `latest`, the historical 7/30/90-day
baselines, and the chart series using six read queries. Previously those
queries were separate, allowing a concurrent INSERT, UPDATE, or DELETE to
be visible in some fields but not others.

All six reads now run inside one PostgreSQL transaction with
`REPEATABLE READ` isolation. PostgreSQL establishes the snapshot on the
first query and uses that same snapshot for the remaining reads. This
prevents mixed-state responses when a measurement changes concurrently.
The `asOf` cutoff is still fixed once at the start of the API request.

## Two distinct time definitions

- **Chart** (`series`): the latest non-null measurement per **UTC calendar
  date**. A `7d` range includes today's UTC date and the preceding six
  complete UTC calendar dates. The first boundary is inclusive; `asOf`
  is the inclusive upper bound. The result never includes 8 partial UTC
  dates or drops measurements from the beginning of the earliest date.
- **Changes** (`7d`, `30d`, `90d`): historical values from exactly
  7/30/90 × 24 hours before `asOf`, preserving the established comparison
  semantics and response contract.

Client charts should label the data in UTC (or explicitly convert the
date labels for the user's display timezone); UTC grouping is deliberate
and independent of database host timezone, local DST or server location.

## Query plans

The existing Prisma index
`(user_id, measured_at DESC, id DESC)` supports the per-athlete time range
filter, first/latest lookups and chart input scan. The chart's
`DISTINCT ON (DATE(measured_at AT TIME ZONE 'UTC'))` may additionally
require a sort/grouping step. This PR makes **no new index or migration**.

The PostgreSQL integration test runs an `EXPLAIN` with local sequential
scans disabled to confirm that the index is a viable access path. This
does not imply PostgreSQL will always choose that index on a tiny fixture
or every production dataset. Review actual production plans with
`EXPLAIN (ANALYZE, BUFFERS)` on representative volumes before adding
expression/partial indexes.

## Regression checks

- Fixed UTC boundary crossing March daylight saving transition
- Inclusive first-day midnight; exclusion of dates outside the range
- Latest non-null point selected when multiple metrics share a UTC date
- Points after `asOf` never included
- A single `REPEATABLE READ` snapshot for all six queries
- Existing HTTP authorization/response shape and metric allowlisting
- PostgreSQL index suitability for user/date filtering
