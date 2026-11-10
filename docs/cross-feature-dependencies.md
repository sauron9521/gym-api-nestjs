# Cross-feature dependency guard (PR #106)

The application already has a consistent feature-controller and domain layout
(PR #96–#105). This complementary, non-mutating guard checks module
boundaries and catches dependency cycles before code review.

## Commands

```sh
npm run architecture:deps
npm run test:architecture:deps
```

Both are included in the existing **Lint, build and tests** required CI
job alongside `architecture:check` and its tests. They use Node
core modules only: no database, Prisma generation, Docker, or new dependency.

## What is checked

1. Discover feature modules from `src/modules/<feature>/<feature>.module.ts`
   without a hard-coded list. Walk their TypeScript sources, excluding
   `test/` files, which are allowed to inspect internal details.
2. Build a Nest module import graph and a **source runtime feature import**
   graph. Detect and report cycles in both, including the cycle path.
3. Exclude `import type` and named type-only bindings such as
   `import { type X }` from runtime edges. A type-only cycle is not
   a runtime cycle; it remains allowed where the imported contract is public.
4. External feature imports should use native `#src/modules/<feature>/...`
   paths rather than traversing sibling directories through `../`.
   Unknown feature names are rejected.
5. Other feature's `<feature>.module`, `services/*` and `types/*` are
   permitted contracts. Imports of another feature's controllers, DTOs,
   mappers, repositories, selects, policies, stores, mailers, providers and
   other implementation folders are private unless **explicitly reviewed**
   in the allowlist below.
6. If a feature imports a foreign service or repository **at runtime**,
   its own Nest module must import the provider's feature module as well.
   Type-only imports do not require Nest registration.

## Audited existing contracts

Cross-feature paths retained by a small allowlist in
`scripts/check-feature-dependencies.mjs`:

| Imported path | Allowed importers | Reason |
|---|---|---|
| `users/repositories/users.repository` | auth, trainer-athletes | UsersModule deliberately exports UsersRepository as a DI contract |
| `exercises/policies/exercise-access.policy` | workouts | Shared SQL authorization predicate for workout creation |
| `exercises/selects/exercise.select` | workouts | Shared exercise reference projection for transactional creation |
| `workouts/policies/workout-access.policy` | workout-analytics | Shared athlete authorization rule for analytics |

These exceptions are restricted to exact paths *and* requesting features.
They do not grant general access to repositories, selectors or policies.

The initial audit covered **155** non-test TypeScript files across eight
modules. The runtime Nest graph is acyclic. The type-only link from
`trainer-athletes` to `exercises/types/exercise.types` must not be
mistaken for a runtime circular dependency with the Exercises module.

The guard is intentionally protective, not a refactor of those existing
contracts. Future refactors could extract stable, exported facades from
the four allowlisted implementation paths.

## Limitations

The scanner handles project-standard static imports/re-exports, side-effect
imports, and string-literal dynamic imports. It does not execute modules or
interpret computed import expressions. TypeScript compilation and existing
integration tests remain required. A source-level runtime edge may be a
conservative approximation of actual runtime use, so value imports that
are only for typing should be changed to `import type` rather
than broadly excluding the dependency.
