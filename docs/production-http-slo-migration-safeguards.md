# Production HTTP SLO migration safeguards (PR #141)

**Operator opt-in only.** This PR does **not** deploy Prometheus, automatically enable HTTP metrics, change NestJS runtime, grant Docker socket access, create schedules, or route alerts to production. It adds a checked and refreshable *expected target inventory* and **verified** 5-minute/30-day SLI/error-budget views. Prior unverified PR #140 recording series remain available for diagnosis and compatibility.

## Why target counts alone are unsafe

PR #140 checks discovered targets and current HTTP exporter completeness, but a replica removed entirely from Prometheus service discovery can no longer contribute an `up==0` sample. A production service can falsely appear perfectly healthy if only the surviving replica is scraped. The 30-day lookback can also yield an attractive metric after ten minutes of collection despite lacking a month's history.

A trustworthy migration needs an **independent authoritative list of expected replica identities**, a recent inventory refresh, an exact comparison of `(deployment, instance)` labels, and at least 30 days of sufficiently complete scrape/counter history. The expected list must come from the deployment/orchestration source of truth, not from Prometheus itself: comparing Prometheus to its own discovered list cannot detect a forgotten target.

## Operator-maintained expected-target inventory

Use `ops/monitoring/http-slo-inventory.example.json` only as an example. **Replace** the fake names with stable, authoritative actual replica scrape target identities. For each deployment:

- `name` must match the low-cardinality Prometheus `deployment` target label.
- `instances` must match **exactly** the `instance` labels of the protected API scrape job `gym-api-internal-http`, with one target per API process (not a load-balanced endpoint). Include each replica, even if it is currently unhealthy.
- `scrapeIntervalSeconds` is fixed to **30** because the strict 30-day coverage gate assumes 86,400 expected scrapes. Another interval needs a reviewed rule and test update.
- Never put tokens, passwords, URLs with credentials, user identity, raw query strings, business secrets or other personal information into the JSON. Treat replica hostnames as sensitive infrastructure metadata; keep real inventories in a protected operator workspace, **not** committed to the repository.

Example for a private, manually provisioned textfile collector directory:

~~~sh
node scripts/monitoring-slo-inventory.mjs \
  --input /etc/gym-api/expected-slo-targets.json \
  --output /var/lib/node_exporter/textfile_collector/gym-api-slo-inventory.prom
~~~

Run only where the destination directory exists and is readable by node_exporter; the writer needs directory permissions to atomically replace the file. It validates names, duplicate deployments/instances, number of targets, fixed scrape cadence and a strict schema. Output is written atomically with mode **0640** on Unix and prints no target identities. It refuses symlink/non-file destinations. Source JSON is never exported or committed.

The generated textfile includes:

- `gym_api_slo_inventory_expected_target{slo_deployment="production",target_instance="api-a:3000"} 1` for every expected target;
- `gym_api_slo_inventory_last_refresh_timestamp_seconds{slo_deployment="production"} <epoch>` for each deployment.

**Important:** textfile labels deliberately use `slo_deployment` and `target_instance` rather than `deployment`/`instance`. Prometheus usually attaches its own `job`/`instance` labels to node_exporter samples; the recording rules safely translate the namespaced labels into the API scraper's expected identity.

**Refresh** this file from an authoritative deployment source at least every **5 minutes**, and immediately on replica changes. The checked-in project does **not** install a timer. Configure a reliable operator-owned scheduler and protect the source; simply refreshing an outdated static JSON proves only that the writer ran, **not** that the inventory is correct. Inventory older than 15 minutes is marked stale. Confirm the private node_exporter `node_textfile_scrape_error == 0` and that Prometheus actually receives the generated series. Run this exporter only in an operator-authorized protected monitoring context.

## Opt-in Prometheus rules

Deploy `ops/monitoring/http-multi-instance.rules.yml` (PR #140) **before** the new `ops/monitoring/http-slo-migration.rules.yml` in operator-managed `rule_files`, with a one-minute evaluation cadence. Do not add the new file to public dashboards or production paging automatically.

Key new records:

| Name | How it is interpreted |
| --- | --- |
| `gym_api:migration:expected_replicas` | Number of independently supplied expected replica identities |
| `gym_api:migration:observed_replicas` | Number of currently discovered HTTP scrape targets |
| `gym_api:migration:matched_replicas` | Targets matching an *expected exact instance identity* |
| `gym_api:migration:inventory_fresh` | 1 if inventory timestamp is younger than 15 minutes; 0 stale, absent if no inventory |
| `gym_api:migration:inventory_matches` | 1 only when count **and exact identity** match; 0 mismatch, no data missing inventory |
| `gym_api:migration:http_availability_verified_5m` | Real 5m request-weighted availability **only if inventory matches and is fresh** |
| `gym_api:migration:http_scrape_coverage_30d` | Minimum across replicas of observed `up` samples / 86,400 expected samples, capped at 1 |
| `gym_api:migration:http_scrape_success_30d` | Minimum across replicas of the fraction of actual observations with `up=1` |
| `gym_api:migration:http_counter_coverage_30d` | Minimum over replicas and HTTP 2xx/3xx/5xx counters of observed samples / 86,400 |
| `gym_api:migration:historical_inventory_matches_30d` | 1 only when the exact target set seen over 30d matches the current expected set |
| `gym_api:migration:http_history_ready_30d` | 1 only when inventory is fresh/matching, source is healthy, historical target set matches, and all three 30d coverage/success checks are at least **99%** |
| `gym_api:migration:http_availability_verified_30d` | Available only after `http_history_ready_30d == 1` |
| `gym_api:migration:http_error_budget_consumed_verified_30d` | Provisional 99.9% SLO error-budget consumption, **only with verified history** |
| `gym_api:migration:http_error_budget_remaining_verified_30d` | Provisional remaining budget, also guarded |

**A missing SLI is not a successful SLO.** If the monitoring source disappears, the inventory becomes stale, the deployment scales during the month, or one target's samples are too sparse, the verified 30-day values intentionally show **No Data**. A new deployment normally needs a full month of observations before reaching the strict threshold.

The sample-count threshold uses `0.99 × 86,400 = 85,536` expected samples per process. The separate `up` success gate also requires at least 99% of **observed** scrapes to succeed. The 30-day history target-identity check is deliberately strict: adding/removing a replica resets certification until the replacement identity has sufficient 30-day history. Process restarts *under the same stable target identity* are allowed; PR #140's `increase()` per instance handles counter resets before aggregation.

This scheme cannot prove end-user availability, detect client-side failures not measured by the API, or detect an entire service that never reported to Prometheus. Scrape jobs and Prometheus itself require independent health and expected-target alerts. Even a verified 30-day request-based metric depends on the provisional HTTP 4xx exclusion policy, objective calibration, monitoring access controls, and stable scrape labels.

## Grafana and warnings

Re-import the updated **`ops/monitoring/grafana/gym-api-multi-instance.json`**. The main availability and 30-day budget panels now use verified recording rules instead of preliminary unverified lookback metrics. Ten additional diagnostics show inventory freshness, identity match, expected versus discovered counts, historical identity, scrape coverage, counter coverage, and history readiness. Every panel uses the existing **single-select deployment** variable, with no multi-select or cross-environment "All" option.

New warnings (disabled unless you explicitly install this rules file and route them):

- `GymApiSloInventoryMissing` — discovered deployment has no expected inventory;
- `GymApiSloInventoryStale` — a present inventory has not refreshed within 15 minutes;
- `GymApiSloInventoryMismatch` — discovered replica identities do not match the expected manifest, even if the counts are equal.

Each uses severity `warning` and a 5-minute hold. Route to a staging/test receiver first. These are monitoring *integrity* events, not direct confirmation of user-facing downtime. Missing historical coverage is deliberately a dashboard/readiness condition, not an automated pager during new deployment warm-up.

## Check, rollout and rollback

Run, without production credentials:

~~~sh
npm run test:monitoring
promtool check rules ops/monitoring/http-slo-migration.rules.yml
promtool test rules ops/monitoring/http-slo-migration.test.yml
~~~

CI includes negative simulations for missing/stale inventory, **equal counts with different instance identities**, incomplete 30-day data and healthy short-window inventory verification. The 30-day positive readiness path cannot realistically be represented by a tiny minutes-long `promtool` fixture; validate it using stored staging samples and operator review before promoting it to production.

Recommended rollout: validate the authoritative inventory, run the writer on the restricted monitoring host, verify private node_exporter exposition, check exact labels in Prometheus, load the multi-instance and migration rules in that order, observe metrics and No Data behavior in staging, import the updated dashboard, rehearse inventory removal/replica removal safely, verify your external scrape/job alerts, then configure only **test** warning routes. Production SLO paging requires a separate explicit approval after actual telemetry history review.

Rollback: remove the new `http-slo-migration.rules.yml` from operator-managed `rule_files`, remove its optional alert routing and inventory generation schedule, and restore the PR #140 Grafana dashboard version or remove the verified panels. Existing raw multi-instance metrics continue to work. No database migrations, API deployments or new network ports are required.
