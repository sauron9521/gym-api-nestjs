# Required GitHub Actions gate

The CI workflow runs three independent jobs:

- `dependency-security`: blocking npm audits for production high/critical and all critical advisories
- `quality-and-tests`: environment/Prisma validation, native ESM build, OpenAPI, unit, PostgreSQL E2E and coverage
- `docker-production-smoke`: migration and non-root runtime image build plus production HTTP and SIGTERM smoke

The `CI / required gates` job is the single roll-up check. It runs even when
one upstream job fails or is skipped, writes the three individual job results
to the GitHub Actions step summary, and succeeds **only** when all three are
`success`. Configure branch protection to require this named check as well
as any additional organization-mandated checks. This is a repository-settings
action; the workflow cannot enable protection automatically.

Unnecessary in-progress runs for the same feature branch and **same event
type** are cancelled. `push` and `pull_request` runs have different concurrency
groups, so a PR run never cancels its own branch-push run. A push to `main`
is never cancelled automatically, because its completed result is the release
verification baseline.

### Follow-up: red PR status despite green PR jobs

The initial implementation used the same concurrency group for `push` and
`pull_request` events. For commit `9f4cd12`, PR workflow run `42677114880`
passed all four jobs, but the PR launch cancelled branch-push run
`42677024318`, causing that run's aggregate gate to fail and leaving red
check runs on the same commit. The follow-up CI fix scopes concurrency by
event type plus PR number or branch ref. New commits receive fresh checks;
previously cancelled runs remain as historical records.

## Investigation: main push after PR #70

On November 9, 2026, run
[42674240478](https://github.com/sauron9521/gym-api-nestjs/actions/runs/42674240478)
was reported by the GitHub workflow API as `failure`, while its accessible
`Lint, build and tests` job 129351710473 reported `success`, including
Prisma generation, lint, TypeScript build, unit, integration/E2E and coverage.

The retrieved job logs do **not** establish the root cause of this
workflow-level discrepancy. In particular, do not infer a unit-test failure
from the workflow-level status. The explicit required-gates roll-up will make
future discrepancies easier to isolate, but does not retroactively repair that
historical workflow result.

## Verification checklist

1. Verify workflow YAML syntax.
2. On the PR, check that the three prerequisite jobs run independently.
3. Verify `CI / required gates` succeeds only when **all three** succeeded.
4. Confirm the job summary prints all three results, including on failure.
5. On merge, verify a fresh push-to-main run; do not declare green based
   solely on the previous PR workflow.


## Signed release candidates (PR #154)

`.github/workflows/release-artifacts.yml` is a **separate manual**
`workflow_dispatch` workflow, not a required pull-request check or
a production deploy. It refuses non-`main` refs and requires that
the exact source SHA already has a successful `CI / required gates`
check on `main` before building/attesting images. PR CI verifies the
release manifest/safety logic offline; actual signing and the
cross-job archive reload are exercised only when an operator starts a
release-candidate run from the checked `main` commit. See
[release-artifacts.md](release-artifacts.md).


## Explicit registry promotion (PR #155)

Promotion of a completed and attested release archive is handled by
`.github/workflows/publish-ghcr.yml`, a **manual-only** workflow on
protected `main`. CI runs mock regression tests of GHCR run validation,
tag preflight and post-push digest verification, but never authenticates
to GHCR or pushes images. The promotion run itself rechecks that the
source commit passed `CI / required gates` and that the signed release
candidate's separate verification job completed successfully.
See [GHCR promotion](ghcr-promotion.md).


## Manual GHCR vulnerability scan and OCI attestations (PR #156)

The operator-authorized registry workflow uses Syft SPDX inventories,
blocking Grype **critical** vulnerability scans before publication,
and signing/verification of exact registry digests and their SBOMs.
PR CI runs **offline tests only** for schemas, source-digest identity,
workflow gates and a read-only 90-day retention candidate planner.
No PR job has GHCR publish/sign/delete privileges. See
[ghcr-supply-chain.md](ghcr-supply-chain.md).
