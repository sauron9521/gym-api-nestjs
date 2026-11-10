# Training Programs regression coverage audit (PR #108)

## Baseline inventory

The repository currently has **eight feature modules** and the following
source/test inventory. These counts are based on file paths, not executed
statement or branch coverage:

| Feature | Non-test TypeScript files | Unit spec files in feature |
| --- | ---: | ---: |
| Auth | 28 | 15 |
| Body Measurements | 13 | 10 |
| Exercises | 15 | 10 |
| Trainer–Athletes | 12 | 7 |
| Training Programs | 46 | 12 |
| Users | 14 | 12 |
| Workout Analytics | 8 | 5 |
| Workouts | 19 | 10 |
| **Total** | **155** | **81** |

Additionally, the root `test/` contains **36** TypeScript files, including
E2E, integration and shared test utilities. A count of spec files is **not**
a test coverage percentage. Only Vitest's instrumented `test:cov` report
measures executed line, branch and function coverage.

## Identified gaps and mitigations

The Training Programs module is the largest feature by source-file count.
Its existing tests cover repositories, CRUD facade and HTTP controllers, but
two high-value rules were only exercised indirectly:

1. **Publication eligibility** — the pure publication policy rejects empty
   programs, workouts without exercises, exercises without sets and workouts
   past the configured duration.
2. **Editing access control** — trainer role checks, scoped program ownership,
   archived/published-version immutability, and nested workout/exercise lookup
   should fail closed before exposing any unrelated resource.
3. **Read projections and privacy** — summary assignment queries must not
   load workout histories, historical assignment views must not select
   personal contact fields, and draft access reads must stay minimal.

PR #108 adds isolated Vitest suites for these boundaries without changing
runtime implementation or Prisma queries. Individual tests include positive
boundary cases as well as unauthorized and malformed-state regressions.

## Recommended follow-up

Use the full CI `npm run test:cov` report and its uploaded coverage artifact
to prioritize **uncovered branches**, rather than assuming modules with fewer
test files necessarily have worse measured coverage. Relevant next targets are
nested workout/assignment transactions, avatar storage failure paths and
trainer–athlete termination concurrency. These need dedicated regression
fixtures and often database-backed integration tests.

## Verification

- `npm test` (new spec files are picked up by Vitest under `src/**/test`)
- `npm run test:cov`
- `npm run test:e2e` with the dedicated test database
- `npm run lint`, `npm run build` and all GitHub required CI gates

No database migration, HTTP route, permission change, dependency update or
test coverage threshold modification is introduced by this PR.
