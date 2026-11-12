# Production readiness: verified release evidence and human-authorized host approval (PR #166)

Production deployment is **never triggered by merging, CI, a green GitHub
Actions review, or generating this report**. We separate what can be
independently verified in GitHub from what must be established on a real
operator-controlled production host.

## 1. Read-only GitHub release review

Use **Actions → Review signed release evidence for production readiness →
Run workflow**, choose `main`, and enter:

| Field | Value for the currently tested pair |
| --- | --- |
| `publisher_run_id` | `43280626086` |
| `staging_run_id` | `43285235000` |
| `confirm_review` | `REVIEW_RELEASE_EVIDENCE` |

Workflow: `[.github/workflows/production-readiness.yml](../.github/workflows/production-readiness.yml)`

The workflow has read-only GitHub permissions and **does not access
production**. It automatically checks:

1. Both run IDs refer to successful **manual** runs from this repository
   and trusted main-branch workflows, not a failed, skipped, PR or
   arbitrary workflow.
2. The exact OCI runtime/migration digests in the successful publisher's
   artifact `ghcr-digests.json` equal the **target** digests in the
   successful staging run's `upgrade-evidence.json`.
3. All four GitHub CI checks on the **target source commit** succeeded
   (required gate, lint/build/test, dependency audit and Docker smoke).
4. The staging receipt has exactly seven ordered successful checkpoints,
   including old API against the new schema and runtime-only rollback.
   It must explicitly state that this did **not** contact production,
   downgrade a schema, or approve a production release.
5. The two target OCI digests have valid **SLSA v1** and **SPDX v2.3**
   attestations bound to this repo's `publish-ghcr.yml` signer, the
   `main` ref and its publisher commit SHA.

Output: `release-readiness-<run-id>-<attempt>` artifact containing
`release-evidence.json`, with **releaseEvidence=VERIFIED** and
**decision=NO-GO** for production. A green review means only that
the release chain is verified; it **never** grants production access.

The artifact retains digests, workflow IDs, and safe summaries only —
no secrets, user data, database snapshots or host configuration.
The host gate requires this report to have been reviewed **within
seven days**; run another read-only review to renew it.

## 2. Separate operator-controlled GO/NO-GO

Only an authorized human operator on the **actual production host**
may obtain a **GO for a manual single-host apply**, after establishing
the following **independent and privately archived** evidence:

- PostgreSQL **and avatars** off-host backup, SHA-256/file-format checks
  and successful **isolated restore** of both, verified before the
  maintenance window. `production-digest-deploy.sh apply` rechecks
  local backup archives, but does **not** itself perform an off-host
  restore drill.
- Real TLS reverse proxy and trusted forwarding configuration checks.
- Active monitoring and tested alert delivery, with on-call ownership.
- Reviewed Prisma **forward-only schema compatibility** and a tested
  **runtime-only** rollback plan; never plan to downgrade migrations.
- Operator-host `production-digest-deploy.sh preflight` showing exact
  current runtime digest and valid trusted OCI attestations. This
  preflight is read-only apart from pulling digests into Docker cache.
- Approved maintenance window (at most eight hours), named change
  ticket, human release approver and **different** operator/on-call
  actor. Explicit separate local confirmation for deployment.

The release review artifact must be copied into a **restricted private
directory outside the repository** (e.g. `/srv/private/gym-api/approvals`).
The operator maintains a private JSON approval record there. **Do
not commit it, attach it to a GitHub PR or upload it to Actions.**

The private approval record has the following *structure* (replace
every illustrative value, person, path and evidence ID):

```json
{
  "schemaVersion": 1,
  "kind": "private-production-change-approval",
  "changeTicket": "CHANGE-2026-000245",
  "approvedBy": "release-manager-01",
  "operatorOnCall": "oncall-secondary-02",
  "approvedAt": "2026-11-12T18:55:00Z",
  "maintenanceWindowStart": "2026-11-12T18:50:00Z",
  "maintenanceWindowEnd": "2026-11-12T20:00:00Z",
  "expectedCurrentImage": "ghcr.io/sauron9521/gym-api-nestjs@sha256:REPLACE_64_HEX",
  "backupDirectory": "/srv/private/backups/REPLACE_WITH_VERIFIED_BACKUP",
  "release": {
    "publisherRunId": "43280626086",
    "stagingRunId": "43285235000",
    "sourceSha": "fc355286347181e0498fd7709417de7b8ff600b5",
    "publisherSha": "fc355286347181e0498fd7709417de7b8ff600b5",
    "runtime": "ghcr.io/sauron9521/gym-api-nestjs@sha256:6be056ec7499001bc17fc1060dd1c86f65e8dd9ce2cdb7f2253d0e4ddd6c6dc9",
    "migrate": "ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:4c340e22360085d8c507c17abf06c061d31e3ab5615a2bc5d6b2c6ad86e58227"
  },
  "evidence": {
    "restoredBackupEvidenceId": "restore-postgres-456",
    "avatarRestoreEvidenceId": "restore-avatars-456",
    "tlsProxyEvidenceId": "tls-proxy-verified-456",
    "monitoringAlertEvidenceId": "alert-routing-drill-456",
    "schemaCompatibilityReviewId": "migration-review-456",
    "rollbackPlanEvidenceId": "rollback-approval-456",
    "hostPreflightEvidenceId": "host-preflight-456",
    "onCallAcknowledgementId": "oncall-confirm-456"
  }
}
```

For a **first deployment** with no existing runtime container, use
`expectedCurrentImage: "none"` and `EXPECTED_CURRENT_IMAGE=none`;
do not falsely claim an existing image. First deployments still need
a reviewed failure-recovery plan with its own evidence ID. For a
subsequent deployment the field must be the actual existing signed
runtime digest, confirmed by the host preflight.

The following environment values are required for an operator to
authorize `apply` in addition to those already documented under
[manual production deployment](production-digest-deployment.md):

```bash
export PRODUCTION_RELEASE_REPORT=/srv/private/gym-api/approvals/release-evidence.json
export PRODUCTION_OPERATOR_APPROVAL_FILE=/srv/private/gym-api/approvals/change-approval.json
export BACKUP_DIR=/srv/private/backups/VERIFIED_BACKUP_DIRECTORY
export RUN_DB_MIGRATIONS=yes    # or no, consciously selected
export CONFIRM_DEPLOY=DEPLOY_VERIFIED_DIGEST
bash scripts/production-digest-deploy.sh apply
```

The existing `apply` flow **first** verifies the private backup
hashes and archive formats, **then** evaluates this approval against
the exact `DEPLOY_RUNTIME_IMAGE`, `DEPLOY_MIGRATE_IMAGE`,
`SOURCE_SHA`, `PUBLISH_SHA`, `EXPECTED_CURRENT_IMAGE` and
`BACKUP_DIR`. It rejects a missing or mismatched receipt,
out-of-window / old (>24h) signoff, old (>7d) release review, missing
required evidence IDs and missing manual confirmation **before
running any migrations or restarting API**.

### What GO actually means

- **NO-GO (default):** required release proof, private evidence,
  signoffs or operational safeguards missing. No deploy.
- **GO (local operator gate):** release identities and *human-attested*
  host evidence are structurally complete, match this change and are
  within the approved maintenance window. It authorizes consideration
  of the **existing explicitly confirmed** single-host `apply`
  script, which rechecks OCI attestations, current digest and real
  backup files. It **does not** execute or automatically approve a
  remote deploy.
- **The validator cannot independently prove that a human-provided
  TLS test, real restore or alert check occurred.** Evidence IDs are
  references to real private operational records, not independent
  GitHub verifications. Approvers must inspect them; supplying
  invented IDs is an invalid operational approval, even if JSON
  format checks pass.

A successful host gate does not mean an actual production deployment
is healthy. After an **explicit manual apply**, verify external
endpoints/auth, logs, metrics and backup freshness, retain an operator
change record and exercise the published rollback procedure as needed.

## 3. Recovery is not blocked by the new apply gate

`production-digest-deploy.sh preflight` remains read-only and does
not require a signoff (so operators can diagnose deployment readiness).
`production-digest-deploy.sh rollback` retains its existing explicit
`ROLLBACK_RUNTIME_ONLY` confirmation and cryptographic OCI checks;
the fresh-release **apply** approval gate is deliberately not imposed
on emergency recovery. Rollback never performs Prisma down migrations.

There is no production server or verified production backup associated
with the current GitHub Actions runs in this repository. Until one is
provisioned and its evidence is reviewed, **the actual deployment
decision remains NO-GO**.
