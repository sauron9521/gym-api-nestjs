# Exercises module refactor (PR #53)

## Responsibility boundaries

- `repositories/`: Prisma queries, pagination, public and minimal workout projections. Preserve SQL access filters supplied by the service.
- `services/`: create/read/update/archive orchestration; relation validation and nested Prisma writes.
- `selects/`: authoritative Prisma projections using `satisfies Prisma.ExerciseSelect`, including archive and workout references.
- `types/`: stable actor, DTO-compatible input, query/context and Prisma-derived payload types.
- `policies/`: pure permission filters, role/source resolution, visibility rules and ownership predicates.
- `dto/`: existing input Zod validation; `controllers/`: HTTP transport, Zod decorators, authentication, throttling and OpenAPI metadata; `test/controllers/`: HTTP controller contract and delegation tests; `test/`: service/repository and other regressions.

A response mapper is not used: the Prisma selected shape already matches the current JSON API contract, and sensitive visibility must be enforced *before* querying the database. Do not introduce a post-query redaction mechanism.

## Preserved invariants

- Guests only see non-archived `GLOBAL` exercises. Admins retain existing global-management semantics.
- Athletes see global and own exercises and trainer exercises from active relationships; trainers only see eligible athlete exercises with explicit, unrevoked grants.
- Ownership and `isArchived: false` are checked again within update/archive predicates to protect against races; Prisma P2025 is translated to NotFound.
- Switching athlete exercise visibility to `PRIVATE` revokes access grants in the same nested update.
- `findAvailableForTrainingProgram` stays trainer-only; `findAvailableForWorkout` filters by current role and relationship-based visibility.
- No API paths, response fields, SQL schema, migrations, dependencies, auth decorators or OpenAPI response contracts are changed.

## CI verification

Require Prisma validation/generation, type-aware lint, build, ESM import smoke, unit/E2E, PostgreSQL integration tests, OpenAPI contract checks, coverage, Docker production smoke and security audit before merge.

## Controller layout (PR #97)

- `controllers/exercises.controller.ts` keeps the existing anonymous/public read endpoints and authenticated write endpoints, including throttling and trainer-athlete access-context forwarding.
- `controllers/exercise-trainer-access.controller.ts` keeps owner-mediated grant/list/revoke operations with the existing HTTP 200 grant / 204 revoke statuses.
- `exercises.module.ts` registers the same two controllers in the same order. All same-feature imports use relative `.js` specifiers; cross-module imports keep native `#src/*` aliases.
- Unit suites for both controllers are grouped in `test/controllers/`. The registry test ensures exactly eight unique HTTP verb/path pairs, without replacing E2E/OpenAPI checks.
- No API route, Zod schema, response contract, authentication, database query, or business rule changes are included.
