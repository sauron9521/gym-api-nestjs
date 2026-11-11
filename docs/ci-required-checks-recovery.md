# GitHub Actions CI: required checks and queue recovery

The branch-protection check for `main` is **`CI / required gates`**. It succeeds only when the security audit, lint/build/tests (including integration/E2E and coverage), and Docker production smoke jobs succeed.

The workflow is triggered by `pull_request` against `main`, `push` to `main`, and operator-only `workflow_dispatch`. A **manual dispatch does not necessarily report a required check on the pull request's merge SHA**. Always inspect the PR **Checks** and **merge box**; do not assume that a green manually dispatched run satisfies branch protection.

## Routine checks

- Run `npm run lint` locally; CI now uses **`oxlint --type-aware --deny-warnings`**. Any new lint warning, including type-aware warnings in test files, fails the required quality gate. Do not disable rules simply to obtain a green CI.
- Verify every PR check is linked to the current **PR head SHA**, and all `CI / required gates` checks are successful before merging.
- A successful job may contain informational GitHub runner notices (e.g., a future `ubuntu-latest` image migration). These are not Oxlint rule warnings, but still require an independent compatibility assessment before changing runner images.

## If a PR's checks are stuck at "Expected — Waiting for status to be reported"

1. Inspect the PR's current branch/head SHA and `.github/workflows/ci.yml`. Confirm that `pull_request` targeting `main` is configured and Actions are permitted in **Settings → Actions → General**.
2. Open the corresponding GitHub Actions run. Distinguish **queued with no jobs** (scheduler/trigger issue) from a running job, a cancelled run, or an actual red test.
3. Avoid guessing the cause. GitHub's queue/concurrency, repository policies and hosted-runner availability are separate concerns. Inspect the run and repo settings rather than silently changing the pipeline or creating a duplicate PR.
4. A manually dispatched `workflow_dispatch` run can validate the code but may **not** satisfy the protected PR check. In PR #146, an old PR-triggered run remained queued while manual dispatch passed; **closing and reopening the same PR** caused a fresh PR-triggered run with jobs and a green required gate. This is a **documented recovery that worked once**, not a guarantee for every incident.
5. If Actions is available and a run has been stuck without jobs, the operator may close and reopen **the same PR** (preserving the branch, comments and commit history) to trigger a fresh `pull_request` event. Inspect the newly created run and its `CI / required gates` conclusion before merging. Do not merge while a required check remains pending.
6. If the issue persists, check repository permissions, GitHub status, runner quotas/billing, concurrency and ruleset settings. Keep an audit trail of affected run IDs; do not bypass branch protection as the first response.

## Safety boundaries

All CI jobs use repository read-only permissions and synthetic development/test credentials. A green CI is not authorization to enable production Alertmanager routing, deploy a production SLO, or alter signing keys. Such actions require separately approved operator workflows.

This runbook only documents observations and safe recovery steps. It does **not** claim to have diagnosed a GitHub-side outage or an underlying scheduler defect.
