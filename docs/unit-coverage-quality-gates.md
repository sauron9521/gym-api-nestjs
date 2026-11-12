# Unit coverage quality gates

Vitest V8 coverage is checked in CI with `npm run test:cov`. The GitHub Actions
quality job runs unit, integration, and E2E suites, then uploads the HTML/JSON
coverage artifact and publishes a small module-level table in its job summary.

## Verified baseline and enforced thresholds

Baseline: successful `main` workflow
[run 43107255423](https://github.com/sauron9521/gym-api-nestjs/actions/runs/43107255423)
on 2026-11-11 (before PR #148). All figures below are percentages.

| Scope | Baseline statements | Baseline branches | Baseline functions | Baseline lines |
| --- | ---: | ---: | ---: | ---: |
| Entire measured source | 79.11 | 69.96 | 77.05 | 79.53 |
| Auth | 76.75 | 65.22 | 64.94 | 76.65 |
| Workouts | 80.22 | 69.80 | 84.95 | 81.07 |
| Training Programs | 64.71 | 53.91 | 63.54 | 65.46 |

| Enforced minimum | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Entire measured source | 77 | 68 | 75 | 77 |
| Auth | 73 | 61 | 61 | 73 |
| Workouts | 77 | 66 | 80 | 78 |
| Training Programs | 61 | 50 | 60 | 62 |

Vitest enforces both the global minimum and each scoped minimum via
`vitest.config.ts`, so raising coverage elsewhere cannot entirely mask
a regression in one of these critical modules. A small buffer below the
measured baseline avoids false failures from minor refactoring.

## Interpreting the report

* `npm run test:cov` checks the thresholds and creates
  `coverage/coverage-summary.json` plus HTML and other reports.
* `node scripts/coverage-report.mjs` prints the global and scoped percentages
  calculated from **covered/total** counts, not averages of file percentages.
* `node --test scripts/coverage-report.test.mjs` checks the reporting logic.
* The CI upload retains the detailed `coverage-report` artifact for review.

**Important:** Vitest currently measures files imported by the unit-test suite,
not every source file in the repository. A successful percentage does not
guarantee coverage of unimported implementations, nor does it include
integration/E2E execution. An explicit `coverage.include` policy covering all
production files should be introduced in a separate PR, after measuring the
new baseline and adding tests for previously uninstrumented files.

When refactoring critical modules, inspect the per-module table and raise
scoped thresholds when a sustained improvement has been verified in CI.
