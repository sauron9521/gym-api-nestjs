# Exercises module refactor (PR #53)

## Responsibility boundaries

- `repositories/`: Prisma queries, pagination, public and minimal workout projections. Preserve SQL access filters supplied by the service.
- `services/`: create/read/update/archive orchestration; relation validation and nested Prisma writes.
- `selects/`: authoritative Prisma projections using `satisfies Prisma.ExerciseSelect`, including archive and workout references.
- `types/`: stable actor, DTO-compatible input, query/context and Prisma-derived payload types.
- `policies/`: pure permission filters, role/source resolution, visibility rules and ownership predicates.
- `dto/`: existing input Zod validation; `test/`: unchanged and added regression tests.

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
