# Opt-in internal HTTP metrics and request-weighted SLIs (PR #137)

This change introduces constant-cardinality process-local HTTP response metrics. The registry observes **completed** HTTP responses, including authentication/validation errors, and exports only five fixed status classes plus response-duration histogram buckets. URLs, method, route parameters, identities, headers, tokens, IP addresses and request IDs are never used as labels.

## Secure scrape endpoint

The endpoint is `GET /internal/metrics`. It is disabled by default and deliberately omitted from OpenAPI. To enable it, operators set both:

- `HTTP_METRICS_ENABLED=true`, otherwise it returns 404
- `HTTP_METRICS_TOKEN`, a separate base64url-encoded random token of **at least 32 bytes** (43+ encoded characters)

Every scrape requires the header `Authorization: Bearer TOKEN`. Incorrect/missing credentials return 404. The comparison uses SHA-256 and a constant-time digest comparison. Because the route opts out of ordinary API user authentication and throttling, the dedicated token and network isolation are mandatory.

Generate a new random secret privately (never commit it):

~~~sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
~~~

The existing production Compose publishes the API port on **host loopback only**, not 0.0.0.0. Preserve that binding, block `/internal/metrics` at any public reverse proxy, and do not expose the scrape token or token-bearing requests in access logs. A secret does **not** replace a firewall. Docker admins can read process environment values. For a containerized Prometheus, 127.0.0.1 refers to the Prometheus container, not the host; use an explicitly isolated host/network or an authenticated private scrape proxy rather than opening the API publicly.

A host-local Prometheus configuration sketch (customize securely for your topology):

~~~yaml
scrape_configs:
  - job_name: gym-api-internal-http
    scheme: http
    metrics_path: /internal/metrics
    scrape_interval: 30s
    static_configs:
      - targets: ["127.0.0.1:3000"]
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/gym-api-metrics-token
~~~

The credential file contains only the raw token and must be readable only by the Prometheus service account. The repository does **not** provision this file, expose the HTTP route externally, deploy Prometheus, or enable metrics by itself.

## Exported metrics

- `gym_api_http_requests_total{status_class="2xx"}` and four other fixed status-class series: monotonic per-process counters.
- `gym_api_http_request_duration_seconds_bucket{le="..."}`, `_sum`, `_count`: a Prometheus classic cumulative response-time histogram in **seconds**. Buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, and +Inf.

The middleware observes response `finish`, not aborted socket connections, and excludes its own scrape endpoint to avoid feedback. The registry has fixed-size memory and resets when the Node.js process restarts. Prometheus handles counter resets via `rate()` and `increase()`; latency quantiles use bucket interpolation and approximate **server-side** duration only.

## Real request-weighted recording rules

The existing `ops/monitoring/slo.rules.yml` has additional records:

| Recording metric | Semantics |
| --- | --- |
| `gym_api:sli:http_eligible_requests_5m` | Increase of successful 2xx/3xx and failed 5xx responses in 5m |
| `gym_api:sli:http_5xx_ratio_5m` | 5xx / eligible, only if >=20 eligible requests |
| `gym_api:sli:http_availability_5m` | 1 minus the 5xx ratio |
| `gym_api:sli:http_availability_30d` | Provisional 30d availability, only if >=1000 eligible requests |
| `gym_api:sli:http_duration_p50_seconds_5m` | Approximate p50 from histogram; >=20 observations |
| `gym_api:sli:http_duration_p95_seconds_5m` | Approximate p95 from histogram; >=20 observations |
| `gym_api:sli:http_duration_p99_seconds_5m` | Approximate p99 from histogram; >=20 observations |

Here 4xx are excluded as *client faults* from the eligibility denominator, while 5xx count as service failures. This is a **provisional eligibility policy**, not a contractual SLO. Insufficient traffic, unavailable metrics or insufficient Prometheus retention produces **No Data**, never a fabricated 100% availability. The older 5m log gauges continue to have their own monitoring value but must **not** be passed through `rate()` or `increase()`.

The Grafana overview dashboard includes the real availability/p50/p95/p99 panels alongside resource metrics and source freshness. Adopt actual SLO objectives only after traffic calibration, deployment validation and error-budget policy review.

## Tests and rollback

CI runs unit tests of the histogram, fixed labels, opt-in token access and config, plus real Nest HTTP E2E tests for 200/4xx responses and absence of scrape feedback. It validates numeric Prometheus recording-rule scenarios using `promtool`. There is **no automatic notification delivery** and no Prisma migration.

In staging, verify public clients cannot access the route, that known HTTP responses increment the correct status-class counter, the histogram count equals total completions, and the secure Prometheus target is successfully scraped. Do not paste credentials into CI logs or PR comments.

For rollback disable `HTTP_METRICS_ENABLED`, remove the new optional HTTP recording rules and dashboard panels from your Prometheus/Grafana deployment, then reload them. Prior logging-based monitoring remains operational.
