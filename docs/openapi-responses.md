# Typed OpenAPI response contracts

The backend now explicitly documents response shapes for the four central
training modules in `src/openapi/response-contracts.ts`.

## Source of truth

The data returned by controllers is determined by the Prisma `select`
constants in repositories and training-program select files. The Swagger
response schemas reflect exactly those selected fields:

- **Exercises**: full exercise (including nested muscle group/equipment),
  paginated list, and the separate small archive result.
- **Workouts**: workouts with nested exercises and sets, paginated list,
  and a separate set-update response.
- **Trainer–Athletes**: normal response and a historical **redacted**
  response for former trainer access. No historical email disclosure.
- **Training Programs**: program summaries, full version snapshots,
  assignment full/summary/details/historical variants, plus all
  mutating endpoints that return the full version snapshot.

Decimal values from Prisma (e.g. `plannedWeightKg`,
`actualWeightKg`, `targetRpe`) are **JSON strings**.
This is intentionally different from `BodyMeasurement` responses, which
the service explicitly converts to numeric JSON.
DateTimes are ISO 8601 UTC strings; nullable fields are represented as
a field present with `null`.

## Intentional response variants

`GET /training-programs/assignments?view=summary` returns the summary
projection without the unbounded `workouts` array. A former trainer's
historical projection omits email, assignedBy and workout lists.
`GET /training-programs/assignments/:assignmentId` may return detailed
or historical data depending on relationship access.

These are **unions** in the generated OpenAPI client, not a single type
with fabricated sensitive fields. Consumers must narrow on available
properties before accessing `workouts`, `assignedBy` or `email`.

## Generating client types

```powershell
npm ci
npm run docs:openapi
npm run docs:types
```

The generated `openapi/api-types.d.ts` contains the response definitions
for each endpoint. Use its `paths` type in Next.js/Expo or a shared Nx
package. The outputs are generated and ignored by git.

## Regression protection

Unit tests in `src/openapi/test/response-contracts.spec.ts` compare
schema properties against the actual Prisma select trees and guard
privacy redactions. GitHub Actions also exports the OpenAPI specification
and generates TypeScript definitions.

When changing Prisma select projections:

1. Update the corresponding response schema in `response-contracts.ts`.
2. Run `npm test` and fix the structural contract tests.
3. Generate OpenAPI and types, and inspect any client-visible diff.
4. For dynamic service projections, check real HTTP E2E JSON responses.

No Prisma migration or response transformation middleware is introduced.
Access control and current JSON payloads are unchanged.
