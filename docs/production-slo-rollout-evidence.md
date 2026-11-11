# SLO rollout evidence and manual operator review (PR #143)

**Offline, opt-in, fail closed.** This tool packages a *recent, successful* PR #142 SLO preflight result with an explicit operator checklist into a small, private evidence JSON file. It **does not** talk to Prometheus or Alertmanager, change Docker or the NestJS API, start a deployment, configure alert routes, or page anyone. The output is for **human staging/production-change review**, not an automatic production approval.

## Prerequisites

First follow `docs/production-slo-preflight.md`: configure the protected Prometheus read-only API, independently maintained expected replica inventory and PR #141 verified 30-day scrape-history rules. Run the preflight against the intended deployment; it must return `READY_FOR_REVIEW`, exit 0, with every expected metric present and complete. The evidence packager will **independently revalidate** its values; merely changing `status` to `READY_FOR_REVIEW` cannot bypass the checks.

Save the private preflight report under an operator-managed directory **outside the repository**:

~~~sh
npm run monitoring:slo-preflight -- \
  --origin https://prometheus.internal.example.test \
  --inventory /etc/gym-api/expected-slo-targets.json \
  --token-file /etc/gym-api/prometheus-readonly-token \
  --deployment production \
  > /var/lib/gym-api-slo/preflight.slo-preflight.json
~~~

The Prometheus host shown is a placeholder. Inspect the report first; if the preflight returned exit code 2, fix the underlying issue rather than changing the file to claim success. Do not share the Prometheus credential, internal scrape target addresses, or personal information in review tickets.

The preflight may be **at most 10 minutes old** at the time the evidence file is created. Evidence packaging uses the UTC timestamp inside the report and compares it to the actual clock. All 12 required checks from PR #142 must be present, finite and valid, including target/source/histogram completeness, exact current/historical inventory matching, 99% scrape and HTTP counter coverage, and a valid verified availability/error-budget measurement. The measured availability is **not required** to be 99.9%: evidence can accurately describe an active reliability incident, while separate policy determines whether rollout is appropriate.

## The operator-owned review checklist

Copy `ops/monitoring/http-slo-rollout-checklist.example.json` into a **private** operator directory. Its five confirmations deliberately default to **false** so a copied template cannot be used as an approval. Complete the following reviews yourself and only then set the corresponding value to `true`:

- `independentInventoryReviewed`: compare expected replica IDs to the authoritative deployment system, not Prometheus discovery alone.
- `perReplicaScrapeAndHistoryReviewed`: check each target, 30-day membership, history coverage and any unverified time periods.
- `secretsAndAccessReviewed`: confirm private scrape/token access and no public Prometheus, Grafana, endpoint or credentials exposed.
- `testAlertRoutingReviewed`: independently validate an authorized **test receiver**; do not enable production paging.
- `rollbackProcedureReviewed`: document an executable, approved rollback and escalation path outside the bundle.

Set `deployment` to the exact report deployment; `reviewer` to a short **operator alias** (letters, digits, dots, dashes or underscores, not an email), `changeRef` to a safe ticket ID such as `CHG-12345` (not a URL), and `reviewedAt` to the actual current UTC timestamp in `2026-11-11T15:00:00.000Z` format. The review must occur **after** the preflight and be no more than 10 minutes old. `decision` must remain `REVIEWED_FOR_STAGING`. This records the operator's **manual attestation of review**, not a permission to activate production alerts.

The script does not claim to validate the reality of these human checklist statements. They must be corroborated by your change-management process.

## Generate a private evidence file

~~~sh
npm run monitoring:slo-evidence -- \
  --report /var/lib/gym-api-slo/preflight.slo-preflight.json \
  --checklist /var/lib/gym-api-slo/operator.slo-review.json \
  --output /var/lib/gym-api-slo/CHG-12345.slo-evidence.json
~~~

The output directory must already exist, be restricted to approved operators and reside on a filesystem supporting hard links. The tool creates a new file with Unix mode **0600**, fsyncs it and publishes it atomically with an exclusive hard link. It **never overwrites an existing evidence file**, rejects symlink inputs, oversized JSON, unknown fields, incomplete reports and missing checklist confirmations. No temporary file is left on successful creation.

The output JSON contains only validated data: a timestamp, one deployment, expected/observed **counts** (not hostnames), exactly the known numeric SLO checks, sanitized operator alias/change reference, explicit confirmations, SHA-256 digests of the normalized preflight and checklist, and flags that deployment/notification/network actions were **not** performed.

The command emits one small stdout JSON status:

- `EVIDENCE_READY_FOR_HUMAN_REVIEW`, exit **0** — file created, but **production is not approved**.
- `BLOCKED` with a reason code, exit **2** — no evidence file created. Invalid/stale inputs do not become approved artifacts.

Do not run this as part of an unattended deployment trigger. This is deliberately manual; approval of any real rollout belongs to the separately controlled change-management workflow.

## Offline integrity re-check

~~~sh
npm run monitoring:slo-evidence -- \
  --verify /var/lib/gym-api-slo/CHG-12345.slo-evidence.json
~~~

This re-checks schemas, operator confirmations, relative timestamps at the moment of packaging, and the **embedded SHA-256 content digests**. Successful output is `EVIDENCE_VALID` with the bundle digest and `authenticatedSignature:false`.

**Security limitation:** SHA-256 detects accidental or uncoordinated changes to the included report and checklist, but the bundle is **not cryptographically signed**. Anyone who can rewrite both the contents and digests can forge it. The CLI cannot prove the operator identity or the truth of the external deployment. For auditable approvals, archive the digest in an **independently protected** change ticket or sign the bundle using your existing organization-approved signing service. Do not present the built-in hashes as non-repudiation or authenticated sign-off.

## Negative tests and rollback

Required CI runs `scripts/monitoring-slo-rollout-evidence.test.mjs` via `npm run test:monitoring`. It tests stale/blocked/fabricated preflight reports, invalid or unreviewed checklists, corrupted evidence hashes, duplicate/untrusted fields, symlink and overwrite protection, restrictive file mode and safe CLI failure output. Every test is **offline** with synthetic data and cannot send a real alert.

Rollback is to stop invoking this optional command and remove any unneeded local evidence files following your retention policy. **No** API, Prisma, Docker, monitoring rule, Grafana dashboard or production Alertmanager configuration is modified by this PR.
