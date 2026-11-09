# Training Programs architecture alignment — PR #55

## Purpose

Finish the established module convention without altering business logic or HTTP contracts. The `TrainingProgramsService` public façade now lives alongside its delegate services in `services/`, while the controller and module stay at the module root.

## Boundaries

- `repositories/`: Prisma persistence, conditional writes and transactional state transitions. `training-program-repository.types.ts` holds shared list query parameter types, not exported by repository implementation files.
- `services/`: façade plus CRUD, access, draft versioning, workouts, exercises, sets and assignments.
- `selects/`: version summary and minimal draft order selections are typed with `satisfies Prisma.*Select`, alongside existing full version, assignment and access projections.
- `types/`: actor/input/query types, repository pagination types and `Prisma.*GetPayload` response payloads for full, summary, draft access and historical results.
- `policies/`: publication-specific rules; `dto/`: Zod validation; `test/`: contract and regression tests.

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
