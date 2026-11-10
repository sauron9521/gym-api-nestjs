# Training Programs architecture alignment — PR #55

## Purpose

Finish the established module convention without altering business logic or HTTP contracts. The `TrainingProgramsService` public façade now lives alongside its delegate services in `services/`, while the Nest module stays at the module root. Following the controller split in PRs #91–#95, HTTP controllers live in `controllers/` and their unit tests in `test/controllers/`.

## Boundaries

- `repositories/`: Prisma persistence, conditional writes and transactional state transitions. `training-program-repository.types.ts` holds shared list query parameter types, not exported by repository implementation files.
- `services/`: façade plus CRUD, access, draft versioning, workouts, exercises, sets and assignments.
- `selects/`: version summary and minimal draft order selections are typed with `satisfies Prisma.*Select`, alongside existing full version, assignment and access projections.
- `types/`: actor/input/query types, repository pagination types and `Prisma.*GetPayload` response payloads for full, summary, draft access and historical results.
- `controllers/`: program CRUD, assignments, versions, workouts, exercises and sets; each controller uses the shared facade without implementing business rules.
- `policies/`: publication-specific rules; `dto/`: Zod validation; `test/`: service/repository regressions; `test/controllers/`: controller route/delegation contracts.

Small one-off `{ id: true }` existence probes and SQL locks remain close to the query in repositories; extracting every trivial field selection would add indirection with no reusable contract.

## Unchanged invariants

1. Published versions cannot be edited and draft publication validates the existing completeness rules.
2. Trainer ownership, active trainer–athlete relationships and assignment state are enforced in the original services and database predicates.
3. Historical trainer assignment views use the restricted Prisma projection, never a post-query email filter.
4. Draft reorder operations retain their existing transaction and conditional update semantics. Their order lookups still select only `id` and ordering fields.
5. The façade continues to delegate every public method without modifying arguments or returned results. Its unused duplicate pagination method was removed; the CRUD service remains the sole validation point.
6. No HTTP route, OpenAPI response shape, Prisma migration/schema, dependency or operation semantics change.

## Verification

Run Prisma validate/generate, oxlint, TS build, native ESM smoke, unit tests including select regressions, full PostgreSQL integration and E2E, OpenAPI contract checks, coverage, security audit and production Docker smoke.

## Controller structure and imports (PR #96)

- `training-programs.module.ts` imports six controllers from `controllers/`, preserving their registration order; literal `assignments` routes precede `:programId`.
- Same-module imports remain relative with native `.js` suffixes; from `controllers/` use `../services`, `../dto` and `../types`, not TS-only `@src` aliases.
- Controller tests live in `test/controllers/`; Vitest still discovers them through `src/**/*.spec.ts`.
- The controller registry test guards the complete registration list and ensures all 25 HTTP method/path pairs remain unique.
- No HTTP paths, authentication, Zod validation, Swagger contracts, service signatures or database code change as part of the move.
