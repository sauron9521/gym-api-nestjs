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
    "firstName": "Anna",
    "lastName": "Smith",
    "displayName": "Athlete",
    "avatarUrl": "https://cdn.example.com/avatars/athlete-1.webp",
    "timezone": "Europe/Kyiv",
    "birthday": "1998-03-04",
    "height": 193,
    "weight": 81.25
  }
}
```

New accounts have `"profile": null` until the first PATCH. Profile fields
may be `null`. Birthday uses **YYYY-MM-DD**, without timezone shifts.
Height is in whole centimetres. Weight uses PostgreSQL `DECIMAL(5,2)`
and supports decimal kilograms. The JSON API returns a number such as
`21.5`; clients can display it as `21.50 kg`.

## PATCH example

```http
PATCH /users/me
Content-Type: application/json

{"firstName":"Anna","lastName":"Smith","displayName":"Athlete","timezone":"Europe/Kyiv","birthday":"1998-03-04","height":193,"weight":81.25}
```

Only the supplied fields are modified. Explicit `null` clears a field;
omitting a field leaves its current value unchanged. Empty objects,
unknown fields and invalid measurements are rejected with HTTP 400.

Allowed fields:

- `firstName`, `lastName`, `displayName`: trimmed, 1–100 characters or null.
- `name`: legacy alias of `displayName`, same validation. PATCH of either
  field writes **both** columns; conflicting values in a single request are
  rejected. Existing names are copied to `displayName` by migration.
- `avatarUrl`: HTTPS URL of an externally hosted avatar (up to 2048
  characters) or null. Credentials in URLs are forbidden. The API never
  uploads, downloads or processes avatar images; a managed uploads API is
  reserved for a future PR.
- `timezone`: optional IANA zone (e.g. `Europe/Kyiv`) or `UTC`.
  It defaults to `UTC` and cannot be cleared with null.
- `birthday`: 1900-01-01 through today or null.
- `height`: integer 50–300 cm or null.
- `weight`: 1–600 kg, up to two decimal places, or null.

The server always takes the user ID from the authenticated principal.
Clients cannot alter `email`, `role`, `passwordHash`, `userId` or other
account fields through this endpoint. Neither passwords nor internal
profile IDs are exposed. Deleted accounts cannot use these routes.

## Follow-ups

Email/password changes, account deletion, public trainer
profiles, an image upload/storage service, and body metrics history
remain out of scope. Those require separate authorization and/or migrations.
