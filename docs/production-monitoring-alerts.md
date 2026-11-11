# Production monitoring and alerting starter — PR #125

The API already emits privacy-safe request completion logs, Redis
availability transition events, and public liveness/readiness probes.
PR #125 adds a **one-shot operator report** that aggregates a bounded
JSON-lines export and optionally checks both live health endpoints.
It does **not** install Grafana, Loki, Prometheus, cron, a paging service
or any background monitoring. No external alert is configured by default.

## Signals

| Signal | Source | Notes |
| --- | --- | --- |
| HTTP requests, 429 and 503 | `http.request.completed` with numeric `statusCode` | Counts per provided log batch |
| Redis outage frequency | `RATE_LIMIT_REDIS_UNAVAILABLE` | One event per state transition **per process** |
| Redis recovery frequency | `RATE_LIMIT_REDIS_RECOVERED` | Logged upon successful PING or counter use following outage |
| Liveness | GET `/health/live` | HTTP 200 indicates app process is serving requests |
| Readiness | GET `/health/ready` | HTTP 200 means DB and configured Redis responded |

The report recognizes flattened events and common nested Nest JSON
metadata shapes (`message`, `context`, `metadata` and `data`).
Invalid or unrecognized lines increment `ignoredLines` and never appear
in output. Collector-specific log wrappers may require transforming
the input; do so **without printing raw request data**.

## One-shot usage

Run from the repository on an authorized operator host with Node.js 22+
and logs restricted to a **known input time window**, e.g. five minutes:

```sh
# Replace the example Docker name and operator-reachable URL.
node scripts/monitoring-log-window.mjs \
  --file /var/log/gym-api/events.jsonl \
  | npm run --silent monitoring:report -- \
      --base-url http://127.0.0.1:3000

# Analyze an already time-filtered JSON-lines export:
cat ./logs/last-5-minutes.jsonl \
  | npm run --silent monitoring:report -- \
      --base-url https://api.example.test

# Check active health probes without logs:
printf '' | npm run --silent monitoring:report -- \
  --base-url https://api.example.test

# Run isolated regressions (no live Redis/DB required):
npm run test:monitoring
```

The report checks only `/health/live` and `/health/ready` using GET,
with three-second timeouts and no redirects or response-body logging.
The `--base-url` must be an HTTP(S) **origin without credentials,
query or path**. Use HTTPS for remote hosts, never pass tokens or
passwords in a URL, and ideally probe from outside the API host.

Output is a single JSON object with `counters`, `ratios`, `probes`
and fixed-code `alerts`. It does not contain raw log lines, user IDs,
email addresses, token values, route parameters, IPs, or Redis URLs.
No `/metrics` endpoint is exposed by this PR.

## Initial warning and alert thresholds

| Code | Suggested condition for bounded log sample | Severity |
| --- | --- | --- |
| `HIGH_HTTP_429_RATE` | At least 20 requests; >=20% completed requests returned 429 | Warning |
| `HIGH_HTTP_503_RATE` | At least 20 requests; >=5% completed requests returned 503 | Critical |
| `REDIS_OUTAGE_OBSERVED` | At least one Redis unavailable event | Warning |
| `LIVENESS_PROBE_FAILED` | Active GET live fails or does not return HTTP 200 | Critical |
| `READINESS_PROBE_FAILED` | Active GET ready fails or does not return HTTP 200 | Critical |

**Exit codes:** 0 for successful reporting (including warnings), 2
for one or more critical signals, 1 for invalid arguments or report
failure. Exit code 2 can feed an **external** scheduler/alert service;
this tool does not schedule itself or send messages. Alert rules are
starter thresholds, not an established SLO.

A single failed live/ready probe is not the same as a prolonged outage.
Configure external monitoring to require e.g. **three failed readiness
probes within two minutes**, detect missing samples, and tune rate
thresholds to actual traffic after observing baseline patterns.

If the batch contains no HTTP events, percentage fields are **null**
(unknown), not 0% healthy. An absence of Redis outage events also does
**not** establish that Redis is ready. In multi-replica aggregation,
Redis transition counts are not an authoritative current-state gauge:
different processes can emit interleaved recovery/outage events.
Monitor each replica and use live readiness independently.

## Deployment checklist

1. Ship JSON logs centrally with appropriate access controls and a
   limited retention policy. Filter the time window **upstream**:
   the report does not read or interpret timestamps.
2. Schedule the report at the same interval on a trusted operator host.
   Use collector-provided instance labels rather than request-derived
   high-cardinality identifiers.
3. Configure external probes to the two health endpoints so complete
   host or ingress failure is detectable even without application logs.
4. Wire process exit code 2 and missing scheduled reports to your
   notification provider. Validate paging and recovery procedures in
   staging before considering monitoring operational.
5. Test Redis outage/recovery, DB unavailability, API downtime and
   repeated 429s. Confirm no sensitive information reaches the report
   or alert destinations.

HTTP 503 may be caused by Redis, PostgreSQL or another dependency.
HTTP 429 may reflect expected abuse prevention rather than service
failure. Correlate with readiness and release history; never disable
the fail-closed throttler merely to silence alerts.

See [health and observability](observability-health.md) and the
[production operations runbook](production-operations-runbook.md).

## Optional recurring exporter and alert rules (PR #126)

For a provider-independent host deployment, PR #126 added a five-minute
systemd runner and sanitized node_exporter textfile metrics. PR #128 makes
the runner read a dedicated **read-only timestamped JSONL source** without
Docker socket access; a trusted external log forwarder is required.
plus Prometheus alert templates for missing or stale collection,
readiness/liveness, 429/503 and Redis outages. No service is deployed
or enabled automatically. See [monitoring integration](production-monitoring-integration.md)
for the operator setup, least-privilege limitations and rollback steps.

## Security and limitations

Do not export raw logs to untrusted services or commit log files.
The report parses and discards unknown input without echoing it, but
source logs must still be protected. The one-shot CLI is not an
always-on monitoring agent or a substitute for provider-level Redis
latency, memory, availability, and PostgreSQL metrics.

No production API behavior, Prisma schema, migrations or dependencies
are changed. CI gains only a zero-dependency Node.js test step.
