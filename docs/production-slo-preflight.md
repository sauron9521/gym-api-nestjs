# Production SLO preflight — read-only Prometheus verification (PR #142)

**No deployment or alert activation is performed.** This is an operator-triggered, read-only preflight report for the Gym API HTTP SLO migration from PRs #137–#141. It never changes Prometheus, calls Alertmanager, modifies Docker containers, alters the API, installs timers, or sends notifications. `READY_FOR_REVIEW` is evidence for **human review**, not permission to page production.

## Requirements

Before running, privately scrape **each Gym API replica** with stable `job="gym-api-internal-http"`, unique `instance` and correct `deployment` labels. Load the opt-in Prometheus recording rules `ops/monitoring/http-multi-instance.rules.yml` followed by `ops/monitoring/http-slo-migration.rules.yml`. Maintain an **independent authoritative** inventory of expected replicas, including replicas currently unavailable. See `docs/production-http-slo-migration-safeguards.md`.

Each actual HTTP metrics target must use the documented 30-second scrape interval. The strict 30-day check needs enough actual historic observations. Keep the Prometheus API behind a private HTTPS endpoint. Provision a separate **read-only Prometheus HTTP API bearer token** in a local regular file outside the Git repository, with restricted filesystem permissions.

## Run

~~~sh
npm run monitoring:slo-preflight -- \
  --origin https://prometheus.internal.example.test \
  --inventory /etc/gym-api/expected-slo-targets.json \
  --token-file /etc/gym-api/prometheus-readonly-token \
  --deployment production
~~~

The Prometheus name above is a **placeholder**, not a real server. Do not place secrets in URLs, command arguments or committed configuration. For an explicitly authorized **loopback test origin only**, add `--allow-local-http` and use `http://127.0.0.1:9090`. Remote HTTP, URL userinfo, path segments, queries and fragments are rejected.

The script uses only `GET /api/v1/targets?state=active` and `GET /api/v1/query` with **fixed PromQL metric names and one validated deployment**. It verifies exact expected-versus-discovered replica identities, per-target scrape health and freshness, 30s interval, inventory age, per-deployment recording-rule readiness, history membership, 30-day scrape/counter coverage, verified 30d availability and consumed error budget.

Requests have a 5-second timeout, **no redirects** and a 1 MiB response limit. The token is read from a local regular file and only sent as an Authorization bearer header to the selected origin. Neither Docker nor the shell is invoked. Raw Prometheus responses and server-generated errors are never printed.

## Output and exit codes

The CLI prints one machine-readable JSON report containing `status`, `deployment`, `checkedAt`, expected and observed replica counts, numeric `checks`, and a sorted list of `reasons`.

- `READY_FOR_REVIEW`, exit code **0**: target inventory, live scraping and required recording-rule evidence passed. This is **not** an automatic production approval.
- `BLOCKED`, exit code **2**: one or more requirements missing, inconsistent, stale, invalid or inaccessible; fail closed and fix the listed code(s) before rechecking.

No report includes the Prometheus URL, raw response body, bearer token, target hostname or instance label. If you archive the JSON, use operator-restricted storage.

| Check | Typical blocking reason |
| --- | --- |
| Wrong replica identity (even if expected counts match) | `TARGET_INVENTORY_MISMATCH` |
| Replica unhealthy, scrape stale or interval not 30 seconds | `TARGET_UNHEALTHY`, `TARGET_SCRAPE_STALE`, `SCRAPE_INTERVAL_MISMATCH` |
| Missing or stale inventory, incomplete source, target or histogram | `MISSING_OR_STALE_*`, `NOT_READY_*` |
| Fewer than 99% required scrape/counter samples over 30d | `INSUFFICIENT_*` |
| Invalid, stale or absent verified 30d availability/budget | `MISSING_OR_STALE_*`, `INVALID_*` |
| Bad credentials, unreachable Prometheus or malformed response | `PROMETHEUS_*` |

A freshly evaluated Prometheus metric **alone** does not prove the source is fresh. This preflight cross-checks the live target list, inventory and coverage gates. A new deployment may remain BLOCKED during the month-long warm-up. An availability measurement below the provisional 99.9% target can still be **observable** and pass data-readiness verification; actual objective attainment and burn-rate policy require a separate human decision.

The tool cannot prove end-user availability, external network reachability or completeness of a source-of-truth inventory that was itself incorrect. It does not test production alert routing, receivers or escalation, and does not adopt a contractual SLO.

## Tests and rollback

CI includes `scripts/monitoring-slo-preflight.test.mjs` in `test:monitoring`. Tests run an ephemeral local fake Prometheus API with synthetic bearer credentials, cover healthy inputs, wrong target identity with matching count, missing history, absent metrics, stale data, authorization errors, invalid origins and unreachable API. **No real production endpoint is queried in CI.**

Before using this in production, rehearse against an approved private staging Prometheus. Confirm blocked reports return exit code 2 and contain no secrets. The tool is read-only; rollback is to stop invoking it. No database, API or Prometheus configuration rollback is necessary.
