# Workouts module structure (PR #54)

## Architectural boundaries

- `repositories/` owns Prisma persistence, idempotency lookup and the original PostgreSQL transaction/row-lock sequences.
- `services/` coordinates training access, workout state transitions, program-derived workout creation and responses.
- `selects/` contains Prisma-checked full workout, set, idempotency-only and minimal state projections.
- `types/` provides request/actor/input types and Prisma-derived public response types independent of repository method signatures.
- `policies/` contains pure role/pagination guards without infrastructure dependencies.
- `utils/` contains canonical Idempotency-Key hashing/validation, preserving byte-for-byte behavior.
- `dto/` retains Zod validation; `controllers/` owns HTTP contracts; `test/controllers/` covers route metadata and service delegation; `test/` covers domain, repository and schema regressions.

## Invariants

1. Every personal workout request is athlete-scoped; no unauthorized read, update, completion, cancellation or replay may reveal another athlete's data.
2. Fingerprints and Idempotency-Key never appear in public workout projections. The existing SHA-256 canonicalization, concurrency P2002 replay behavior, and conflicting-replay 409 remain unchanged.
3. The parent workout's `FOR UPDATE` lock serializes set updates and completion. Set completion requires no pending sets and at least one completed set.
4. Program-based creation locks an active assignment and clones immutable exercise/set snapshots, while starting it locks the assignment and preserves `startedAt` on first start.
5. Status-conditioned updates and Prisma P2025 conflicts preserve their current HTTP exception mapping.
6. No routes, OpenAPI contracts, DTOs, DB schemas/migrations, dependencies or transaction semantics change.

## CI verification

Prisma validate/generate, lint, TS build, native ESM aliases, OpenAPI generation/schema contracts, unit tests, PostgreSQL integration/E2E (especially concurrent set completion, program assignments, idempotency), coverage, dependency audit and production Docker smoke all must pass before merge.

## Controller organization (PR #99)

- `controllers/workouts.controller.ts` retains all nine existing HTTP endpoints, Zod request contracts, authentication, throttling, the optional Idempotency-Key and OpenAPI schemas.
- `workouts.module.ts` registers this controller from `controllers/` without changing its providers or exports.
- `test/controllers/` contains regression coverage of the nine method/path pairs, three explicit lifecycle HTTP 200 overrides, delegation and idempotency key forwarding.
- The endpoint throttling policy test imports the new native `#src` location; imports within this feature module remain relative with `.js` suffixes.
- API paths, service behavior, concurrency/transaction policies, database schema and dependency versions are unchanged.
