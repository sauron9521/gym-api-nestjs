# Health checks and request logging (PR #35)

## Probes

- GET /health/live — unauthenticated liveness check; returns HTTP 200 with
  {"status":"ok"} without querying PostgreSQL.
- GET /health/ready — unauthenticated readiness; performs SELECT 1 through
  PostgreSQL and (if REDIS_URL is configured) PING through the existing
  Redis throttler connection. Returns 200 {"status":"ok"} only when all
  enabled dependencies are ready; otherwise HTTP 503 with a generic
  service-unavailable message.

Both endpoints bypass the generic IP throttler. These deliberately public
endpoints expose no sensitive internal connection details.
Prisma connects during application initialization, so a DB outage at boot
can prevent startup before readiness is available. Readiness detects
outages after the API starts.

## Request IDs

All Nest-served HTTP requests receive a fresh server-generated UUID in
X-Request-ID. Supplied X-Request-ID headers are not trusted. The error
response requestId matches the header; successful responses carry the
header only. Middleware runs before authentication guards.
Failures outside Nest middleware (e.g. the reverse proxy) are not covered.

One completion log is produced per request with event, requestId,
method, route pattern, statusCode and durationMs. Raw query strings,
URL parameters, bodies, user agents, client IPs, credentials, and
authorization headers are not included. Unmatched routes have a
constant route label.

## Structured logs

Production uses Nest 12 ConsoleLogger with JSON output. Development
uses readable text. Prisma lifecycle and bootstrap logs use Nest Logger
rather than console.log.

## Redis rate-limiting health transitions (PR #124)

The distributed throttler logs structured **state transitions** only when
`REDIS_URL` is configured:

- `RATE_LIMIT_REDIS_UNAVAILABLE` (warning) when Redis first becomes
  unavailable through a client error, failed health probe or failed counter
  operation. Subsequent failures in the same outage do **not** log again.
- `RATE_LIMIT_REDIS_RECOVERED` (informational) on the first successful
  PING or atomic counter operation **after** an outage. Normal initial
  connection and repeated healthy calls do not generate transition logs.

Each event has only fixed `event`, `component: "rate_limiting"` and
`backend: "redis"` fields. Raw errors, Redis URLs, hostnames, credentials,
identifiers, throttle keys and request content are excluded. No transition
events are emitted in memory-only mode. This avoids a log flood during
prolonged Redis failures and permits alerting on recovery.

`GET /health/ready` continues to validate Redis with a real PING and to
return a generic `503` when unhealthy, without revealing backend details.
The existing **fail-closed** policy for Redis-backed throttles is unchanged.
For runbooks, alert on unavailability plus failed readiness, and check for a
recovery event plus successful readiness before considering the backend
healthy again. Logs are not a substitute for metrics or a monitoring
backend; no new metrics endpoint is added by this PR.

## Operator monitoring report (PR #125)

The optional `npm run monitoring:report` CLI aggregates safe HTTP 429/503
and Redis outage/recovery events from a caller-filtered JSON-lines log
batch, and can probe `/health/live` plus `/health/ready`. It emits only
fixed alert codes and low-cardinality counters; it never prints raw log
lines or probe URLs. It is one-shot and does not schedule checks or send
notifications. Details: [monitoring and alert rules](production-monitoring-alerts.md).

An opt-in systemd + node_exporter textfile integration and example
Prometheus alert rules are available in
[monitoring integration](production-monitoring-integration.md). Nothing
starts or pages automatically when this repo is checked out.

The implementation adds no packages. Future multi-instance observability
can integrate Pino/OpenTelemetry, trace propagation, central log shipping,
metrics and alerting.

Never log access tokens, refresh tokens, session cookies, password hashes,
SMTP credentials, or password-reset/email-verification links.

For operator alert suggestions, backup instructions, recovery and safe
rollback, see [production operations runbook](production-operations-runbook.md).
