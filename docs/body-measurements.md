# Body Measurements API

Authenticated users can manage **only their own** measurements; actor IDs
come from `@CurrentUser()`, never from request bodies. Trainer/athlete
relationships do not grant access to this endpoint.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/body-measurements` | Create a dated measurement |
| GET | `/body-measurements?page=1&limit=20&from=...&to=...` | Paginated newest-first history |
| GET | `/body-measurements/:id` | One own record |
| PATCH | `/body-measurements/:id` | Partial update |
| DELETE | `/body-measurements/:id` | Delete, HTTP 204 |

Unauthorized requests return 401. A record owned by someone else returns
404, exactly like a nonexistent record.

## Example create request

```json
{
  "measuredAt": "2026-11-08T10:30:00+02:00",
  "weightKg": 81.25,
  "bodyFatPct": 14.5,
  "chestCm": 108.5,
  "waistCm": 82,
  "hipsCm": 96.5,
  "armCm": 36.25,
  "thighCm": 57.5,
  "notes": "Morning, before breakfast"
}
```

All metrics are optional, but **at least one must be non-null**.
Weight is 1–600 kg; body fat is 0–100%; chest/waist/hips
1–400 cm; arm 1–200 cm; thigh 1–250 cm.
All metrics have up to two decimal places. `notes` accepts a
trimmed string up to 500 characters or null.

Date-time values must include a timezone offset (or `Z`) and must not
be later than current time (allowing 60 seconds of client clock skew).
If `measuredAt` is omitted on create, PostgreSQL defaults to now.
Data are stored in UTC as `TIMESTAMPTZ(3)` and returned as ISO UTC
timestamps. The user's `Profile.timezone` controls future client display,
not data storage.

## History and charting

The listing response uses `{ data, meta: { total, skip, take, totalPages } }`
and is sorted by `measuredAt DESC, id DESC`. Date filters are inclusive,
allowing chart clients to fetch pages over a desired time range.
Numeric fields are returned as numbers, never Prisma Decimal JSON strings.
Internal `userId` is excluded from public responses.

PATCH updates only supplied fields, including explicit `null` to
clear a metric. Clearing the last remaining metric returns HTTP 400.
PostgreSQL also enforces the nonempty record invariant.

## Compatibility note

This module intentionally leaves `Profile.weight` **unchanged**.
`Profile.weight` is a manually editable current-weight field;
`BodyMeasurement.weightKg` is the historical measurement log. There
is no implicit synchronization or destructive backfill. A future
explicit synchronization policy can reconcile them without changing
existing clients.

## Follow-ups

Potential later features: goal weight, summary/trend projections, private
progress photos, trainer sharing consent, CSV export and optional syncing
of the latest recorded weight back into the profile.

## Statistics for Web / Mobile charts

`GET /body-measurements/statistics?metric=weightKg&range=90d` is an
**authenticated, owner-only** endpoint. The `metric` parameter accepts:
`weightKg`, `bodyFatPct`, `chestCm`, `waistCm`, `hipsCm`,
`armCm`, and `thighCm`. Default: `weightKg`.

`range` accepts `7d`, `30d` and `90d` (default: `90d`).
The response includes the selected metric's unit, first-ever and latest-ever
non-null record, overall delta/percent change, 7/30/90-day comparisons,
and a chart series of **one point per UTC calendar day**, taking the latest
measurement of that day. Chart points are sorted oldest to newest, with
at most 8/31/91 daily points depending on the requested range.

A comparison for N days uses the latest record **at or before** the cutoff
(`asOf - N * 24 hours`) as baseline and the latest record inside the N-day
window as endpoint. If either is absent, `delta` and `percentChange` are
`null`, not `0`; this avoids inventing progress without historical data.
A percent change with zero baseline is `null`. Negative deltas denote
reductions in the selected metric; they are not automatically judged as good
or bad. Values and deltas are numeric with two-decimal precision.

Example (abbreviated):

```json
{
  "metric": "weightKg",
  "unit": "kg",
  "range": "90d",
  "asOf": "2026-11-08T19:30:00.000Z",
  "first": {"id": "uuid", "measuredAt": "2026-09-01T09:00:00.000Z", "value": 78.5},
  "latest": {"id": "uuid", "measuredAt": "2026-11-08T09:00:00.000Z", "value": 81.25},
  "overall": {"delta": 2.75, "percentChange": 3.5},
  "changes": {
    "7d": {"baseline": null, "delta": null, "percentChange": null},
    "30d": {"baseline": null, "delta": null, "percentChange": null},
    "90d": {"baseline": null, "delta": null, "percentChange": null}
  },
  "series": [{"id": "uuid", "measuredAt": "2026-11-08T09:00:00.000Z", "value": 81.25}]
}
```

Statistics do not change profile weight or measurements, do not share
results with trainers, and need no new Prisma migration. Results are
computed directly from database records so edits/deletes are reflected
on subsequent requests. Date windows are based on UTC 24-hour durations;
the chart's daily buckets also use UTC, not the profile display timezone.
