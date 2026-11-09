# Health checks and request logging (PR #35)

## Probes

- GET /health/live — unauthenticated liveness check; returns HTTP 200 with
  {"status":"ok"} without querying PostgreSQL.
- GET /health/ready — unauthenticated readiness; performs SELECT 1 through
  Prisma's PostgreSQL connection. Returns 200 {"status":"ok"} on success,
  otherwise HTTP 503 with a generic service-unavailable message.

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

The implementation adds no packages. Future multi-instance observability
can integrate Pino/OpenTelemetry, trace propagation, central log shipping,
metrics and alerting.

Never log access tokens, refresh tokens, session cookies, password hashes,
SMTP credentials, or password-reset/email-verification links.
\nFor operator alert suggestions, backup instructions, recovery and safe\nrollback, see [production operations runbook](production-operations-runbook.md).\n