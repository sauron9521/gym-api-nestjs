# Deployment-scoped HTTP SLI/SLO for multiple Gym API instances (PR #140)

**Operator opt-in only.** This is an alternate multi-instance Prometheus recording/alert rule set with a separate Grafana dashboard. Merging does **not** deploy Prometheus, expose the HTTP metrics endpoint, enable notifications or alter the running API.

## Why a separate rule set

PRs #137–#139 introduced process-local monotonic counters and histograms, a provisional 99.9% availability error budget, and per-instance scrape status. The legacy `ops/monitoring/slo.rules.yml` and `ops/monitoring/http-slo-burn.rules.yml` compute **global** series. In one Prometheus evaluating multiple deployments they can silently aggregate production together with staging, an unrelated job or another service. A counter reset in one process must not be mistaken for a reset in the aggregate.

This PR introduces `ops/monitoring/http-multi-instance.rules.yml` using explicit `job="gym-api-internal-http"` and nonempty `deployment` target labels, with recording series named `gym_api:multi:*`. Existing global rules are unchanged for compatibility. **Never use the legacy global HTTP SLO values for a multi-deployment Prometheus**, even if the new scoped rules are installed alongside them. In a multi-instance deployment, make the new scoped dashboard/SLO your authority; remove or avoid displaying unscoped views, and migrate any previously adopted global alert routing after testing the scoped replacement.

## Required scrape topology

Each replica needs its **own stable target** (not a load-balanced URL) so Prometheus can detect independent counter resets. The protected `GET /internal/metrics` endpoint remains disabled by default and requires a separate bearer token; see `docs/internal-http-metrics-slo.md`. Do not publish it to public networks.

An illustrative *operator-managed* Prometheus scrape definition for private TLS-terminating proxies:

~~~yaml
scrape_configs:
  - job_name: gym-api-internal-http
    scrape_interval: 30s
    scheme: https
    metrics_path: /internal/metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/gym-api-metrics-token
    static_configs:
      - targets:
          - "prod-a.internal.example.test:8443"
          - "prod-b.internal.example.test:8443"
        labels:
          deployment: production
      - targets:
          - "stage-a.internal.example.test:8443"
        labels:
          deployment: staging
~~~

These are **examples**, not actual servers or DNS records. The operator supplies TLS, private routing, target discovery, authentication, secure secrets and accurate labels. Every scrape target must identify exactly one process; changing a target identity or reusing `instance` across processes can mislead `rate()` and `increase()`. Distinguish deployments with a stable, low-cardinality `deployment` label supplied by Prometheus, not by a user request or request path.

**All** relevant targets must have the same expected `job` name and a nonempty `deployment`; unlabeled targets are **excluded**, not silently merged with production. If you have several services in one Prometheus, keep the job unique per service and restrict the recording rules to that job.

## The actual multi-replica math

- `gym_api:multi:http_targets_up{deployment="production"}` is `min by(deployment) (up{job="gym-api-internal-http",deployment=~".+"})`. If any **discovered** target is down, the deployment has a 0 status. A replica removed from discovery entirely **cannot be detected** without an independent inventory of expected replicas; additionally monitor service discovery and the monitoring system.
- `gym_api:multi:http_source_complete` requires a fixed 5xx counter series from each currently discovered target, and all those targets up. `gym_api:multi:http_histogram_complete` checks each target has the `le="+Inf"` histogram bucket. A missing family or down target hides the derived SLI instead of showing fabricated 100% success.
- Request counters are aggregated as `sum by (deployment) (increase(<individual counter series>[window]))`. **Always apply `increase()` to each replica BEFORE sum** so a restart in one replica does not corrupt other replicas' counters.
- A classic latency histogram is aggregated as `histogram_quantile(0.95, sum by (deployment, le) (rate(<per-replica bucket series>[5m])))`. The `le` label is mandatory; the quantile is approximate. Apply `rate()` before aggregation, and require at least 20 completed duration observations and complete histograms.
- Eligible response policy stays 2xx+3xx+5xx, with client 4xx excluded and server 5xx counted as failures. Aborted client connections remain a separate signal (PR #139); they do **not** receive a fabricated 5xx status.

## Scoped records, error budget and optional alerts

The file records eligible traffic and 5xx failures by deployment over 5m, 30m, 1h, 6h and observed 30d, plus 5xx share, 5m availability, 30d availability, 30d error-budget consumed/remaining, and p50/p95/p99 server-side latency. Rates are suppressed on insufficient traffic, incomplete scrape data, or a currently down target.

The provisional availability target remains **99.9%**, allowing 0.1% observed failed eligible requests over a 30d window; no contractual SLO has been accepted. The 30-day budget requires at least 1000 eligible requests but **does not guarantee 30 days of continuous scrape coverage**. It is merely based on samples available in that lookback window; operator health, retention, source history and target discovery must be reviewed before interpreting the value.

Three **warning-only**, opt-in alerts are included, preserving each deployment label:
- `GymApiMultiHttpSloFastBurn`: 5m and 1h 5xx ratios both exceed 1.44%, 5m >=50 and 1h >=500 eligible requests, for 1m.
- `GymApiMultiHttpSloSlowBurn`: 30m and 6h 5xx ratios both exceed 0.6%, 30m >=200 and 6h >=1000 requests, for 2m.
- `GymApiMultiHttpMetricsIncomplete`: known deployment has a down target or a missing HTTP counter/histogram family for 5m.

The separate `http-telemetry.rules.yml` from #139 still provides per-instance `up==0` alerts. A missing entire scrape job also needs the preexisting job-missing alert. No rule can detect a completely failed monitoring server by itself; monitor Prometheus independently. These warnings are **not** automatically routed to production on-call, and low traffic deliberately produces No Data rather than a false successful SLO.

## Grafana and validation

Import **`ops/monitoring/grafana/gym-api-multi-instance.json`** manually as a **separate** dashboard. On import select the authorized Prometheus datasource. A **single-select deployment variable** filters every panel, including raw per-instance scrape status; there is intentionally no "All" option combining environments. Stat panels query the latest instant metric rather than historical last-not-null samples to avoid pretending a stale success is current. No URLs, credentials or tokens are stored in the dashboard.

Before loading optional rules into a real Prometheus:

~~~sh
promtool check rules ops/monitoring/http-multi-instance.rules.yml
promtool test rules ops/monitoring/http-multi-instance.test.yml
npm run test:monitoring
~~~

CI runs synthetic numerical cases for **two production replicas and one staging replica**, an unrelated metrics job, independent per-replica counter/histogram resets, a known down replica, and missing deployment labels. The tests check request-weighted availability, histogram quantiles, budget, and deployment-isolated warning alerts. This PR does not change NestJS runtime behavior, auth, databases, Docker network bindings or dependencies.

**Staging activation sequence:** configure private target access for each replica, verify `up==1` per target, ensure all replicas have mandatory `deployment` labels, validate the 5xx and `+Inf` bucket series for each target, enable this new rules file under `rule_files`, import the dedicated dashboard, review live restart behavior, and route warning alerts only to an approved test receiver. Promote to production only after independent review, SLO calibration and rollback rehearsal.

**Rollback:** remove this rules file from the operator-managed Prometheus `rule_files` and remove the separate dashboard/test routing. Reload Prometheus after validation. Original single-service SLI and other collectors remain unchanged.
