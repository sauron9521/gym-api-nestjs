# Post-rollout HTTP SLO drift review (PR #144)

**Read-only and entirely offline.** The CLI compares a PR #143 archived rollout evidence bundle, its separately archived authoritative replica inventory, a *fresh* PR #142 preflight report and inventory, and a locally exported change-management record. It never calls Prometheus, GitHub, Docker or Alertmanager, changes infrastructure, sends alerts, deploys software or grants production permissions.

The report is an **operator investigation aid**, not proof that a production rollout was approved, that change tickets are authentic, or that SLO degradation was caused by the rollout. No reports or authentic operator inventory snapshots are bundled with this repository.

## Preserve a trustworthy baseline

At the original manually reviewed staging handoff, archive both:
- The validated `*.slo-evidence.json` bundle from `docs/production-slo-rollout-evidence.md`. It contains the pre-rollout verified SLO metrics, operator review and SHA-256 hashes.
- A separate **authoritative** `baseline-inventory.json` snapshot from the deployment platform at that time, matching the original expected per-replica HTTP scrape identities. The PR #143 bundle intentionally does not contain hostnames, so it **cannot reconstruct or authenticate** an archived inventory by itself.

Keep these under operator-restricted storage, outside the repository. A current scraped-target list is **not** an independent baseline: it cannot detect a replica removed from service discovery. Never include bearer credentials, email addresses, personally identifying information or internal URLs with tokens in the inventories.

The tool validates the evidence's internal SHA-256 hashes and requires the archived inventory's **exact replica count** to match the evidence. It then creates a *canonical per-deployment SHA-256 fingerprint* from the sorted instance names. This checks that the archived inventory corresponds to the independently recorded digest, provided that the digest was **actually approved and stored externally**.

## Export an independently reviewed change record

Take `ops/monitoring/http-slo-postrollout-change-record.example.json` as a **deliberately unapproved** template. Use a restricted change ticket from your organization (for example, a change-management service), confirm its actual approval and copy only the allowed fields:

- `version` = 1;
- `changeRef` = the same safe ticket identifier in the PR #143 evidence, such as `CHG-12345` (not a URL);
- `evidenceSha256` = the previously independently recorded full evidence-bundle SHA-256;
- `inventorySha256` = the independently recorded canonical baseline-inventory SHA-256;
- `recordedAt` = the actual operator-recorded UTC time the change was reviewed, **after** evidence packaging and **before** the current post-rollout preflight;
- `decision` = `STAGING_ROLLOUT_REVIEWED`;
- `operatorVerifiedExternally` = `true` **only after** you manually verify the change ticket and digests using the separate, access-controlled system.

The repository does **not** connect to or verify a ticket vendor, digital signature or approver identity. A malicious person who can replace the source JSON and evidence hashes can forge the record. Thus the output ALWAYS declares `externallyAuthenticatedApproval:false`. Use real independent approval controls and approved identity systems for authorization; **this script cannot provide them**.

Use the shipped commands to compute the two reference digests (neither prints hostnames):

~~~sh
# Existing PR #143 offline validator
npm run monitoring:slo-evidence -- --verify \
  /var/lib/gym-api-slo/archive/CHG-12345.slo-evidence.json

# New PR #144 safe canonical fingerprint (selected deployment only)
npm run monitoring:slo-postrollout -- \
  --fingerprint-inventory /var/lib/gym-api-slo/archive/baseline-inventory.json \
  --deployment production
~~~

These commands output the full 64-character hex digest. Have the operator compare them with **previously approved values** in the ticket; generating and accepting a new hash at review time does not prove the baseline is authentic.

## Collect a fresh current reading

Generate a fresh, private PR #142 preflight report from the authorized Prometheus API using the procedure in `docs/production-slo-preflight.md`. Archive a **current authoritative inventory** of expected replicas from the deployment source of truth, not copied from Prometheus discovered targets. The preflight report must be no more than **10 minutes old**, use the same deployment as baseline and be evaluated **after** the change record timestamp. Even if the current preflight is `BLOCKED`, the drift tool will create a **blocked diagnostic report** rather than silently claiming SLO health. Keep all files out of Git.

## Run the offline drift check

~~~sh
npm run monitoring:slo-postrollout -- \
  --baseline /var/lib/gym-api-slo/archive/CHG-12345.slo-evidence.json \
  --baseline-inventory /var/lib/gym-api-slo/archive/baseline-inventory.json \
  --current-inventory /var/lib/gym-api-slo/current/expected-targets.json \
  --current-report /var/lib/gym-api-slo/current/preflight.slo-preflight.json \
  --change-record /var/lib/gym-api-slo/archive/CHG-12345.slo-change-record.json
~~~

All input paths must be distinct, absolute and refer to local regular files. Files are size-bounded at 64 KiB. Symlinks, unexpected schemas and invalid timestamps are rejected. The program uses only local files and has no network capabilities.

### JSON output

A successful check prints `NO_DRIFT_FOR_MANUAL_REVIEW` and exits **0**. A detected mismatch, unavailable/stale input, missing approval reference or significant SLO regression prints `BLOCKED` with stable reason codes and exits **2**. The output never contains bearer tokens, raw target identities, Prometheus origins, full inventory lists, or raw server replies.

| Finding | Evidence / rule |
| --- | --- |
| `REPLICA_MEMBERSHIP_DRIFT` | Exact old/new instance identities differ; reports only added and removed counts, even when total count stays the same |
| `CURRENT_REPLICA_COUNT_MISMATCH` | Fresh `READY_FOR_REVIEW` report's expected/observed counts disagree with current authoritative inventory |
| `CURRENT_PREFLIGHT_BLOCKED` | The latest PR #142 report does not have a healthy, verified 30-day data source |
| `AVAILABILITY_DEGRADED` | Verified 30-day availability fell by at least **0.001** (0.1 percentage point) from baseline |
| `ERROR_BUDGET_CONSUMPTION_INCREASED` | Verified 30-day provisional budget consumption rose by at least **0.5** (50% of the allowed 0.1% budget) |
| `CHANGE_RECORD_MISMATCH_OR_UNVERIFIED` | Referenced change ticket, evidence SHA, inventory SHA, operator flag or schema did not match |
| `CURRENT_REPORT_STALE` | Current preflight is older than ten minutes or too far in the future |
| `CURRENT_REPORT_PREDATES_CHANGE` | Current evidence was collected before the referenced review |

Output `status: NO_DRIFT_FOR_MANUAL_REVIEW` is **not** a production release approval, authenticated signature, guarantee that the service works or proof of continuous monitoring. It means the specified checks found no problem in **these supplied snapshots**. Other issues may exist.

These thresholds are initial **investigation triggers**, not externally approved SLO policy. The 30-day lookback is rolling: increased budget consumption may reflect earlier incidents rather than this rollout. Conversely, constant 30-day metrics do not rule out short-lived new failures. Operators should also inspect the PR #140/#141 short-window burn/telemetry dashboards and independently controlled health checks.

## Tests, data protection and rollback

CI includes `scripts/monitoring-slo-postrollout.test.mjs` in the required `test:monitoring` suite. Tests exercise replay/staleness, archived bundle digest integrity, inventory mismatches with equal replica counts, missing current data, budget/availability regressions, fake change tickets and direct CLI execution with synthetic local files. No real production credentials, network requests, alert routing or deployments are used in CI.

Redirect reports only to operator-private storage if persistence is needed. File name patterns for actual `*.slo-change-record.json` and `*.slo-postrollout.json` are excluded by `.gitignore`; the checked-in example is not an authorization record.

Rollback requires only stopping use of the optional CLI and discontinuing its review process. It does not modify any running component, previous SLO rules or alert routes.
