# HTTP SLO error budgets and multi-window burn alerts — PR #138

**Opt-in only:** these rules are NOT included in the existing active `alerts.rules.yml` or automatically deployed by the repository. This is a calibration-ready template for a **provisional 99.9% request availability objective** with a 30-day evaluation period, not a contractual production paging policy. Review the eligibility policy, volume gates, labels, scrape coverage and receivers before enabling.

## Inputs and objective

PR #137 added fixed-cardinality process-local HTTP request counters exported only through authenticated `GET /internal/metrics`. The optional SLO rules use the same policy as PR #137:

- **Eligible completed requests:** HTTP 2xx + 3xx + 5xx. Client 4xx (including 429) and 1xx do not count toward the SLO denominator. Revisit whether this is right for the product before adopting an SLO.
- **Service errors:** HTTP 5xx among eligible requests.
- **Provisional SLO:** 99.9% availability; error allowance = 0.1% (0.001).
- **Budget consumed:** (observed 5xx / observed eligible) / 0.001. A value of 1.0 means 100% of the provisional allowance used; values can exceed 1.0. Remaining budget = max(0, 1 - consumed).

These are **request-weighted**, not downtime percentages; do not translate 0.1% directly to a fixed outage duration without assuming a traffic profile. The budget series is computed over **available samples within the last 30 days**, only with at least 1,000 eligible requests. The presence of a value does **NOT** prove full 30-day data coverage. When onboarding, after scrapes are missing, or after Prometheus retention changes, treat the budget and 30-day availability as provisional until the observation window and collector availability have been validated. Scrapes of restarted processes require normal Prometheus `increase()` counter-reset handling.

## Files

- `ops/monitoring/http-slo-burn.rules.yml` — opt-in records and alerts, entirely separate from the existing `alerts.rules.yml`.
- `ops/monitoring/http-slo-burn.test.yml` — deterministic Prometheus simulations for sustained incident, healthy traffic, sparse traffic and absent scrape.
- `ops/monitoring/grafana/gym-api-overview.json` — five new panels for budget consumed/remaining and 1h/30m/6h 5xx shares, shown beside readiness, actual request availability and latency.
- `scripts/monitoring-error-budget-config.test.mjs` — static CI guard against unsafe changes.

The existing `slo.rules.yml` is still required, because it computes the five-minute 5xx and eligible-request records that gate the fast alert.

## Alert behavior

| Alert | Short / long windows | Normalized burn rate | Minimum traffic and hold |
| --- | --- | --- | --- |
| `GymApiHttpSloFastBurn` | 5m + 1h | Both error ratios > 1.44% = **14.4x** 0.1% allowance | 5m >=50 eligible; 1h >=500 eligible; `for: 1m` |
| `GymApiHttpSloSlowBurn` | 30m + 6h | Both error ratios > 0.6% = **6x** allowance | 30m >=200 eligible; 6h >=1,000 eligible; `for: 2m` |
| `GymApiHttpSloMetricsMissing` | No 5xx-class counter series | Separate telemetry-failure warning, not an availability success | `for: 10m` |

All are `severity: warning` until validated in staging. They emit only fixed labels (`severity` and `slo`), never request IDs, URLs, user identities, emails, tokens or client IPs. A short-lived spike, sparse traffic or an absent counter does not become an invented burn-rate metric. **A missing series is not equivalent to zero errors.**

For the current single-instance deployment, the recording rules aggregate all HTTP counter series with `sum`. Multiple instances, jobs or environments in one Prometheus **must be separated in target labels or evaluation scopes before enabling**: global aggregation can hide a broken instance and merge unrelated environments.

## Safe operator activation

1. In a **staging** environment, opt in to the secure HTTP scrape and check the real Prometheus target reports `up == 1`. Verify the token never appears in logs, dashboards or the repository. Ensure port and reverse proxy restrictions from `docs/internal-http-metrics-slo.md` are maintained.
2. Deploy `ops/monitoring/slo.rules.yml` and this new file to the operator-managed Prometheus host, but initially route the new alerts exclusively to a dedicated **test receiver**. No routing or real notifications are automatically configured.
3. Validate with a compatible `promtool` version before reloading Prometheus:

~~~sh
promtool check rules ops/monitoring/slo.rules.yml
promtool check rules ops/monitoring/http-slo-burn.rules.yml
promtool test rules ops/monitoring/http-slo-burn.test.yml
~~~

4. Add the new rules file to the Prometheus `rule_files` list **only after reviewing routing**. Observe the budget and burn charts, compare with traffic and incidents, and confirm the missing-scrape rule detects a disabled scrape without a spurious "100% healthy" SLO.
5. Use the separate authorized Alertmanager test-receiver procedure in `docs/production-observability-readiness.md` to check delivery and recovery. Do not automatically page the production on-call from these candidate thresholds.

**Important:** Normal Prometheus recording/alert rule evaluation is not a substitute for external synthetic availability, proxy-level metrics, reliable scraping or end-user monitoring. Since only completed HTTP responses are counted, disconnected clients and complete API/network outages may not generate 5xx counters at all. Independently alert on scrape/health failures and ensure the monitoring system itself is healthy.

## Tuning and rollback

The traffic gates are conservative starter values; a low-volume application may frequently see **No Data** and no burn-rate alerts. This is intentional. Calibrate with real traffic volume, reliability requirements, incident severity, business hours, and the chosen on-call policy. Do not lower sample thresholds merely to force alerts to fire. Document objective changes and test every alert scenario in CI before deploying.

Rollback is to remove only `http-slo-burn.rules.yml` from the operator-managed `rule_files` list and remove corresponding test-receiver routing, then validate/reload Prometheus. The existing HTTP registry, secured scrape, older SLI records, Grafana panels, API, databases and Docker services remain functional without these optional burn-rate rules.
