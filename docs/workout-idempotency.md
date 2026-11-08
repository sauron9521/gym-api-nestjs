# Workout creation idempotency

`POST /workouts` and `POST /workouts/from-program` accept the optional
`Idempotency-Key` request header.

## Client behavior

- Generate one random UUID for **one logical workout creation**.
- Persist that key before the first request.
- Retry the same operation with the **same key and same request body** if
  the response is lost or the network fails.
- Generate a fresh key for a *new* workout, even when repeating the same
  training-program workout on another day.
- Do **not** reuse the key for a different endpoint or request body.

Example:

```http
POST /workouts/from-program
Idempotency-Key: 994534b9-3535-4d4d-94dd-ef5f508bb7ae
Content-Type: application/json

{"assignmentId":"<uuid>","programWorkoutId":"<uuid>"}
```

## Server guarantees

- Keys must contain 8–128 URL-safe ASCII characters (including UUIDs).
  Invalid/blank headers return HTTP 400.
- Keys are unique **per athlete**, enforced by a PostgreSQL index.
  Keys are optional so existing clients remain compatible.
- The server stores a SHA-256 fingerprint of a canonical representation
  of the operation and validated body. Property order does not matter.
- Repeating the same key with the same operation and body returns **the
  original workout ID**; even concurrent requests create only one row
  and one set of child records.
- Reusing a key for another operation/body returns HTTP 409.
- Replays return the *current* workout representation, not a frozen
  snapshot of the original HTTP response; HTTP status remains 201.
- If a training-program assignment is no longer active, a retry of a
  previously successful request can still retrieve the original workout.
  A **new** key does not bypass assignment validation.
- Requests without a header preserve the previous behavior: repeated
  identical requests may create separate workouts.
- Idempotency is scoped to workout **creation only**, not start,
  set updates, cancellation, or completion.

The key and fingerprint are private database fields, not part of the
workout response DTO.

## Storage

`Workout.idempotencyKey` and `Workout.idempotencyFingerprint` are nullable;
a composite unique index is defined on `(athleteId, idempotencyKey)`.

The key currently remains reserved for as long as the workout exists.
No automatic expiration or key-recycling policy is implemented.

## Testing

E2E tests cover sequential and concurrent retries, payload mismatch,
invalid headers, per-athlete isolation and legacy behavior.
