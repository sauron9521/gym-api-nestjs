# HTTP telemetry integrity, aborted requests and multi-instance scrape readiness (PR #139)

PR #137 introduced process-local HTTP request counters and a protected Prometheus scrape. This PR extends that lifecycle instrumentation without adding user- or route-specific labels, and without changing the provisional SLO target or automatically enabling monitoring.

## Request lifecycle and exported metrics

The global request-context middleware observes a request **before guards**, then exactly one terminal event:

- `finish`: a complete HTTP response. It increments the existing `gym_api_http_requests_total{status_class="..."}` and the duration histogram; it does **not** count as an abort even if Node subsequently emits `close`.
- `close` **before** `finish`: a prematurely closed response (client disconnect, terminated socket, or other incomplete response). It increments `gym_api_http_requests_aborted_total` without inventing an HTTP status class or histogram sample.
- Requests with no terminal event are counted in the current `gym_api_http_requests_in_flight` gauge.

The newly exported unlabeled metrics are:

| Series | Type | Meaning |
| --- | --- | --- |
| `gym_api_http_requests_started_total` | counter | Requests entering the instrumented middleware |
| `gym_api_http_requests_aborted_total` | counter | Responses closed before normal `finish` |
| `gym_api_http_requests_in_flight` | gauge | Requests that started but have not yet finished or aborted |

On a healthy single process, over its lifetime: **started = completed + aborted + in-flight**, where `completed` is the existing histogram `_count` (assuming valid standard HTTP response codes). Scraping does not enter these counters and histogram; Express's case-insensitive and optional-trailing-slash versions of `/internal/metrics` are excluded too. HTTP 4xx, including authentication failures, remain completed responses rather than aborts. No individual URL, request method, auth header, token, user ID, request ID or IP is published in any Prometheus label.

Aborted responses are **not classified as 5xx**. They are not included in the previous eligible-request SLO denominator; therefore the legacy completed-response availability SLO does not represent disconnects, TCP failures, external proxy timeouts, or client-side success. Watch both the request-based availability and abort-rate signals. The log records a fixed `http.request.aborted` event without raw URL/header values. The counters reset when the Node process restarts; Prometheus `increase()` handles normal counter resets.

## Optional integrity recording/alert rules

The new file `ops/monitoring/http-telemetry.rules.yml` is separate from production `alerts.rules.yml` and will **not** be automatically enabled by merging.

It produces five-minute starts, aborts, abort fraction (only when 20+ requests were started) and current in-flight gauges. It also defines three warnings, suitable only for staging/test receivers until calibrated:

| Alert | Condition | Why |
| --- | --- | --- |
| `GymApiHttpAbortedResponsesElevated` | Abort share exceeds 5% with at least 100 starts in 5m, held for 2m | Excessively interrupted responses |
| `GymApiHttpMetricsTargetDown` | `up{job="gym-api-internal-http"} == 0` for 2m **per target** | One unavailable replica must not be masked by healthy replicas |
| `GymApiHttpMetricsJobMissing` | The entire scrape job disappears for 5m | A missing scrape definition must not silently signal healthy API |

`GymApiHttpMetricsJobMissing` is a **global** missing-job warning; `TargetDown` retains the operator-provided Prometheus `job` and `instance` target labels so that the specific replica can be identified. These are infrastructure labels, not request or user labels. Neither alert can fire if Prometheus itself is offline; independently monitor the monitoring platform.

An abort spike can reflect legitimate client cancellations, expired proxies, slow upstream dependencies or resource contention; it is an investigation signal, not proof of server error. Do not automatically page production from its initial 5% threshold.

## Safe multi-instance scrape design

**Do not publish `/internal/metrics` to the internet.** It remains disabled unless the API has `HTTP_METRICS_ENABLED=true` plus a high-entropy `HTTP_METRICS_TOKEN`, and requires a matching `Authorization: Bearer` token. Reverse proxies and network controls must restrict access to authorized Prometheus processes. See `docs/internal-http-metrics-slo.md`.

For multiple replicas, configure one stable, distinct scrape target **per process** under the fixed Prometheus job name `gym-api-internal-http`; do not load balance a single `/internal/metrics` scrape across replicas. Scraping through a load balancer randomly switches process-local counters and produces incorrect `increase()` and `histogram_quantile()` values.

An illustrative *operator-managed* Prometheus scrape for two **private TLS-terminating reverse proxies** (not directly exposed Nest HTTP ports) looks like:

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
          - "api-a.internal.example.test:8443"
          - "api-b.internal.example.test:8443"
        labels:
          deployment: production
~~~

This is not auto-installed. Every endpoint must map **directly to one replica**, use a private network, and keep the bearer header hidden from logging. The example assumes operator-provisioned TLS termination and DNS; the Nest application does not configure TLS for you. If replicas have **different bearer secrets**, use separate scrape configurations or target-specific secret management; do not copy a common credential into a public repository.

The existing `slo.rules.yml` and `http-slo-burn.rules.yml` aggregate HTTP counters **globally** (without `by (instance)` or `by (deployment)`). This is only correct if their Prometheus evaluation context contains **one intended Gym API service and environment**. Never mix staging, production, unrelated jobs or versions in the same SLO calculation. Do not blindly reuse a single dashboard/recording rule across multiple deployments until recording rules are explicitly scoped and validated. The new target-down alert detects missing replicas independently, even when aggregation hides their impact on HTTP error ratios.

## Validate and roll back

Run the usual required CI (unit, integration/E2E, type check, Docker smoke). It now tests a real TCP client disconnect against the instrumented middleware, finish-then-close ordering, secret-free abort logs, alternate metrics-scrape paths and constant-cardinality counters.

The Prometheus simulation is offline and sends **no** notifications:

~~~sh
promtool check rules ops/monitoring/http-telemetry.rules.yml
promtool test rules ops/monitoring/http-telemetry.test.yml
npm run test:monitoring
~~~

If deploying in staging, verify the authenticated Prometheus target for **each** replica shows `up == 1`, conduct an approved abort test, validate the observed metric increases, and monitor the alert's resolution. The existing Grafana dashboard adds four new panels for starts, aborts, abort share and in-flight requests (34 panels total).

Rollback requires removing the optional `http-telemetry.rules.yml` from your operator-managed Prometheus `rule_files` and related test routes, then reloading Prometheus. The HTTP counter/histogram and API behavior remain backward compatible. No database migrations, dependency changes, new API ports or automatic alert receiver configuration are included.
