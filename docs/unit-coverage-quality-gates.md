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
| Training Programs | **95** | **90** | **95** | **95** |

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


## Training Programs threshold increase after PR #167

The earlier Training Programs minimum (61% statements, 50% branches,
60% functions, 62% lines) was set against the November 11 baseline.
Following the focused test work in PRs #164, #165 and #167,
[successful PR #167 CI run 43289865381](https://github.com/sauron9521/gym-api-nestjs/actions/runs/43289865381)
measured the following **unit-only** coverage for the Training Programs module:

| Scope | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Training Programs, verified PR #167 | 97.53 | 92.45 | 97.92 | 97.48 |
| New enforced floor | **95** | **90** | **95** | **95** |

The floor leaves approximately two percentage points for small changes,
while preventing regression to the old baseline. Coverage thresholds apply
only to **instrumented** source files imported by unit tests, not the entire
production source tree. This PR does not add `coverage.include`, alter
existing global/auth/workouts floors or change production behavior.

The new repository edge-case tests focus on draft creation defaults, custom
ordering and pagination, and the locked versus unlocked paths of version
duration updates. CI remains the authority for confirming all thresholds.

## Inventorying source files not covered by the unit run

CI now also runs `node scripts/coverage-inventory.mjs` **after** the existing
`npm run test:cov` step. The script compares the source tree against
`coverage/coverage-summary.json` and produces:

- A per-feature table in the GitHub Actions step summary counting eligible
  production source files, files present in the V8 unit coverage report, and
  files absent from that report.
- A list of up to 40 absent paths in the step summary.
- The full machine-readable `coverage/source-inventory.json` in the already
  uploaded `coverage-report` artifact.

The inventory excludes generated files, index barrels, test fixtures/specs,
declaration files and explicitly type-only directories/files. The same source
filter is tested independently with Node's built-in test runner:

    node --test scripts/coverage-inventory.test.mjs

**Important distinctions:** "absent" means there is no entry for that file
in the unit V8 summary. It does **not** mean the file has a measured 0%
coverage score: it could be a bootstrap entrypoint, unused source, or a
runtime-empty DTO. Unit coverage does not include E2E execution, and neither
the file counts nor the numbers in the inventory are line-coverage percentages.

This is a **measurement-only** first step toward explicit `coverage.include`.
It does not change any coverage thresholds, unit-test instrumentation or
production code. The next stage is to choose a small set of genuinely
executable absent files, add corresponding unit tests or justified exclusions,
then adopt explicit `coverage.include` in a separately measured change without
concealing regressions in existing critical modules.
