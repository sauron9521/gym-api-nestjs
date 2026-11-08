# User profile API

## Endpoints

Both routes require authentication through the existing session cookie or
Bearer access token.

- `GET /users/me` — read the authenticated account and its optional profile.
- `PATCH /users/me` — create or partially update its profile (returns the
  same response format).

## Read response

```json
{
  "id": "user-uuid",
  "email": "athlete@example.com",
  "emailVerified": true,
  "role": "ATHLETE",
  "createdAt": "2026-11-08T10:00:00.000Z",
  "updatedAt": "2026-11-08T10:00:00.000Z",
  "profile": {
    "name": "Athlete",
    "birthday": "1998-03-04",
    "height": 193,
    "weight": 81
  }
}
```

New accounts have `"profile": null` until the first PATCH. Profile fields
may be `null`. Birthday uses **YYYY-MM-DD**, without timezone shifts.
Height is in whole centimetres, weight in whole kilograms (the existing
Prisma `Profile` model uses `Int` for both).

## PATCH example

```http
PATCH /users/me
Content-Type: application/json

{"name":"Athlete","birthday":"1998-03-04","height":193,"weight":81}
```

Only the supplied fields are modified. Explicit `null` clears a field;
omitting a field leaves its current value unchanged. Empty objects,
unknown fields and invalid measurements are rejected with HTTP 400.

Allowed fields: `name` (trimmed, 1–100 characters or null),
`birthday` (1900-01-01 through today or null),
`height` (integer 50–300 cm or null), `weight` (integer 1–600 kg or null).

The server always takes the user ID from the authenticated principal.
Clients cannot alter `email`, `role`, `passwordHash`, `userId` or other
account fields through this endpoint. Neither passwords nor internal
profile IDs are exposed. Deleted accounts cannot use these routes.

## Follow-ups

Email/password changes, account deletion, fine-grained public trainer
profiles, photos, body metrics history and fractional body-weight storage
are intentionally out of scope. Those require separate authorization
and/or migrations.
