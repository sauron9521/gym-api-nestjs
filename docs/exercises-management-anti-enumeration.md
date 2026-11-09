# PR #62 — Exercise management anti-enumeration

## Vulnerability / behavioral change

Previously `ExercisesService.update()` and `archive()` loaded *any* unarchived exercise by ID and then applied an ownership assertion. A user who knew an arbitrary UUID could tell that a foreign private exercise existed because `PATCH /exercises/:id` and `DELETE /exercises/:id` returned `403` for existing foreign exercises, but `404` for unknown or archived IDs. The `GET` routes already hide inaccessible private exercises behind `404`.

This PR intentionally changes the **HTTP status for foreign custom exercise management** from `403` to `404` with the same safe message `Exercise not found` used for missing IDs. Any web/mobile client that treats all 403s as edit-denied should also handle 404 as an inaccessible resource. API response fields and error-envelope shape remain unchanged.

## Implementation

- Centralized `buildExerciseManagementLookupWhere(actor)` in the existing exercise access policy. Repository fetches on `PATCH` and `DELETE` are explicitly restricted to **global exercises** or **custom exercises created by the acting user**; `isArchived: false` remains required. This prevents fetching another user's custom row merely to deny mutation.
- `assertCanManageExercise` keeps `403 Forbidden` for non-admin attempts to modify globally visible exercises. For a foreign custom exercise, it now returns `404 Not Found` as a defensive second authorization check, including if a mocked/incorrect repository returns the row.
- Existing conditional update predicates (`id`, `createdById`, `source`, `isArchived`) remain intact to protect against changes between access checks and writes.
- Owners retain their existing update/archive permissions; admins retain management of global exercises. Trainer/athlete read visibility is unchanged; this PR changes only management of inaccessible custom exercises.

## Tests

- Policy unit tests: lookup scoping for athlete, trainer and admin; 403 for unprivileged global writes, 404 for foreign custom, authorized owners/admins unchanged.
- Service unit tests: filtered repository lookup and no write after foreign/missing lookup; defensive 404; forbidden global writes; admin global archive allowed.
- Real PostgreSQL/HTTP E2E: compare `PATCH` and `DELETE` for a foreign private vs nonexistent UUID; same status, code and message; no private name leak or DB mutation; no-store and request-ID remain correct; non-admin global writes remain 403.
- Cross-module principal isolation suite from PR #61 updated to expect the new secure 404 behavior for foreign private writes with bearer auth.

No Prisma schema/migration, new library, session/token, or exercise GET/list behavior changes.
