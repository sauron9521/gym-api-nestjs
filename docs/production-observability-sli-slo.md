# Gym API observability dashboard & provisional SLI baselines (PR #136)

**Operator opt-in only.** This PR provides recording rules and an importable Grafana dashboard. It does **not** deploy Prometheus/Grafana, expose new API endpoints, modify production Compose, reconfigure notifications or establish a contractual SLO automatically.

## Measurements and limitations

The existing textfile exporter emits **five-minute rolling-window gauges** for HTTP requests, 429 and 503, plus readiness and liveness probe values. They are **not monotonic HTTP counters**; do not use them for request-weighted SLOs. Starting with PR #137, a **separate opt-in authenticated internal HTTP endpoint** exports real monotonic request counters and response-duration histograms; see `docs/internal-http-metrics-slo.md` for enabling, true availability rules, p50/p95/p99, and their limitations.

| Recording series | Meaning |
| --- | --- |
| `gym_api:sli:monitor_snapshot_fresh` | 1 if the monitoring snapshot is younger than 15 minutes, 0 if stale; absent if exporter missing/invalid |
| `gym_api:sli:readiness_observed` | 1 healthy, 0 failed for a fresh, configured readiness probe; **absent** if unconfigured/stale |
| `gym_api:sli:readiness_observed_ratio_1h` | Successful *valid* readiness observations / valid observations in the last hour |
| `gym_api:sli:readiness_observed_ratio_24h` | Same fraction for a rolling day |
| `gym_api:sli:readiness_coverage_ratio_24h` | Share of expected one-minute rule evaluations that contained valid readiness observations over the day |
| `gym_api:sli:http_503_share_5m` | 503 count / observed requests from the most recent 5m batch, only if fresh and requests >= 20 |
| `gym_api:sli:http_429_share_5m` | Corresponding rolling 429 share, subject to the same gating |

**Never apply `rate()` or `increase()` to the HTTP 5-minute gauges or sum their overlapping windows.** Missing/under-sampled error ratios become **No Data**, not 0%. Missing readiness observations are excluded from the observed success ratio, so always consult the validity coverage and separate monitoring freshness alerts. The recording rules contain no additional high-cardinality or personally identifiable labels. They assume a **single monitored API instance** in the Prometheus context; multiple instances require reviewed scrape labels and aggregation.

## Candidate baselines, not contractual SLOs

Use these hypotheses only for initial calibration:
- *Observed* readiness probe success over 24h **at least 99.5%**, but consider the indicator interpretable only when valid-observation coverage is **at least 95%** and node_exporter/Prometheus target scraping is healthy.
- Latest qualifying 5m HTTP 503 share **below 1%** as an investigation guideline, **not** an all-5xx error budget or long-term request-weighted SLO.
- Monitor 429 separately. Legitimate rate limiting does not necessarily mean unavailability.
- **Request latency histograms now exist (PR #137)**, but this does not automatically establish contractual latency objectives or burn-rate paging. Validate traffic and latency objectives before adopting them.

Calibrate targets with real traffic and incident history before adopting automated paging.

## Prometheus and Grafana installation

Install and validate the **optional** monitoring collectors from the preceding PRs first. Confirm the authorized host's `npm run monitoring:preflight` passes; verify Prometheus has a healthy node_exporter scrape target and `node_textfile_scrape_error == 0`.

~~~sh
promtool check rules ops/monitoring/slo.rules.yml
promtool test rules ops/monitoring/slo.test.yml
promtool test rules ops/monitoring/http-metrics.slo.test.yml
~~~

On the **operator-managed Prometheus host**, add the deployed `ops/monitoring/slo.rules.yml` to the `rule_files` configuration alongside the existing alert rules. Validate and reload Prometheus under your normal change procedure; this repository does not deploy a Prometheus server. Confirm all recorded series appear after rule evaluation. A rolling 24h chart needs up to a full day to reach normal coverage after first installation.

Import `ops/monitoring/grafana/gym-api-overview.json` in Grafana's dashboard import UI, selecting the correct Prometheus datasource. The dashboard uses only built-in Stat and Time series panels, no hardcoded datasource UID, tokens, hostnames or credentials. Its one-minute refresh and no-data behavior do not replace independent scrape/alert receiver checks.

## Modern HTTP metrics alongside the original log proxy

PR #137 adds a separate authenticated HTTP scrape endpoint and true per-process counters/histograms; the new Grafana panels show request-weighted availability and p50/p95/p99. The old readiness/log-window panels remain useful as separate, limited observability indicators. See `docs/internal-http-metrics-slo.md` for the additional opt-in metric scrape configuration, request eligibility policy, retention constraints and rollback. Do not confuse the log-derived 503 share with counter-derived all-5xx request availability.

## Acceptance / rollback

Verify fresh snapshot = 1, readiness 0 on an observed failure and **No Data** when the source is stale/unconfigured. Verify HTTP share panels omit samples when traffic is below 20 requests and do not treat window gauges as counters. Compare observed readiness against the coverage panel; check Docker memory, OOM, CPU throttling, and node_exporter parse errors separately. Notification delivery still requires the operator-controlled test receiver described in `docs/production-observability-readiness.md`; no notifications are sent by this PR.

CI uses `promtool check/test rules` against both SLI and alert rules, and validates dashboard JSON structure and metric references via Node tests. No API, database migration, or Compose changes.

To roll back, remove the Grafana dashboard and the added `slo.rules.yml` reference from your Prometheus `rule_files` and reload after validation. Retain all previously configured collectors and alert rules.
