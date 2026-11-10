# Trainer–Athletes module refactor (PR #52)

## Boundaries

- `repositories/`: Prisma queries and pagination; preserve ownership predicates and redacted lookups.
- `services/`: role/status validation, relationship transitions, transactional termination, and exercise copying.
- `selects/`: explicit Prisma projections for full and historical trainer responses.
- `types/`: actor/input types, query parameters and Prisma-derived selected payloads.
- `dto/`: existing request validation; `controllers/`: HTTP transport and route declarations; `test/controllers/`: controller delegation and route contract tests; `test/`: service and repository regressions.

No mapper layer is needed for this module: Prisma selects already produce the current HTTP response shape. Do not introduce a mapper that fetches sensitive data and redacts it afterward.

## Privacy and compatibility

- The historical projection for terminated/declined/cancelled trainer relationships must never select related users' `email` fields. Active/pending trainer relationships and the athlete's own history retain the current full projection.
- `findManyForTrainer` first loads the historical projection and only fetches full details for *currently* open relationships under the same participant scope. `findOne` similarly restricts trainer history.
- The termination service must keep the relationship transition, training-program assignment termination, private exercise copies and access revocation in the **same database transaction**.
- Preserve existing routes, OpenAPI response schemas, auth decorators, response fields, and Prisma schema; no migrations or dependency changes.

## Verification

Run lint, build, native ESM alias smoke, unit and full PostgreSQL integration/E2E suite (especially trainer relationship and copy tests), OpenAPI contract validation, coverage, vulnerability audit and production Docker smoke in CI.

## Controller layout (PR #98)

- The relationship HTTP controller resides in `controllers/trainer-athletes.controller.ts` and is registered by `trainer-athletes.module.ts` without changing provider boundaries or registration order.
- Its unit test suite resides in `test/controllers/trainer-athletes.controller.spec.ts`, with relative `.js` imports in accordance with the native NodeNext ESM convention.
- The separate `trainer-athletes-controller-registry.spec.ts` guards all seven HTTP methods, their paths, four explicit 200 status overrides, the original route prefix and single controller registration.
- The `@Authenticate()` class policy and Swagger response schemas remain unchanged. Runtime HTTP/E2E and OpenAPI tests remain required in CI.
