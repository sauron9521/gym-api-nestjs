# Real Docker Engine monitoring pipeline regression — PR #130

This test verifies the complete host-side monitoring data path created
by PRs #125–#129 using the **real Docker Engine** on GitHub Actions
`ubuntu-latest`, not a mocked Docker CLI or a running production server.

## CI scenario

The existing `Docker production build and HTTP smoke` job already
builds the actual non-root `gym-api:runtime-ci` image. After the API
health/graceful-shutdown smoke test, CI runs:

```sh
bash -n scripts/test-monitoring-docker-e2e.sh
bash scripts/test-monitoring-docker-e2e.sh
```

The test starts a disposable container based on that image with the
Docker **`local` logging driver** (explicitly verified via Docker
inspect), `max-size=1m` and `max-file=2`. The container invokes
a small Node.js log **emitter** instead of starting NestJS or connecting
to PostgreSQL. It writes synthetic Nest-compatible JSON events to
**both stdout and stderr**, with deliberately embedded fake emails,
tokens, private paths and a Redis connection string.

The existing, unmodified scripts form the real pipeline:

```text
Disposable production-image container -> Docker local logs
  -> scripts/monitoring-forward.sh
  -> scripts/monitoring-docker-forwarder.mjs
  -> timestamped, sanitized events.jsonl (0640)
  -> scripts/monitoring-collect.sh + last-5-minute reader
  -> real localhost /health/live and /health/ready probe fixture
  -> scripts/monitoring-report.mjs
  -> scripts/monitoring-textfile.mjs
  -> Prometheus-compatible .prom gauges
```

## Assertions

The initial fixture emits 20 HTTP 429 responses, 2 HTTP 503 responses,
one `RATE_LIMIT_REDIS_UNAVAILABLE` and one
`RATE_LIMIT_REDIS_RECOVERED` event. The test asserts the exact
`.prom` counters, successful health probes, critical and warning
flags, correct Docker log driver and snapshot permission `0640`.
Neither the JSONL nor the Prometheus output can contain fixture
emails, tokens, Redis connection strings, raw paths or metric labels.

Three failure paths are tested:

1. Remove the Docker container. The forwarder must fail without
   overwriting its last valid snapshot.
2. Run a new container that writes **malformed structured JSON**.
   The forwarder must fail closed and retain the last valid snapshot.
3. Artificially age the sanitized JSONL file by five minutes.
   The downstream monitor must exit with source failure and leave
   the existing `.prom` file and its last-run timestamp unchanged.

Finally, recreate a healthy Docker container and forwarder snapshot.
The downstream monitor must recover **without clearing/restarting the
host monitoring scripts**. The new `.prom` file must contain seven
requests (six 200, one 429), no 503 or Redis outage, and **no critical
or warning alerts**. All temporary containers, fixture processes and
files are removed by a shell exit trap.

## Boundaries

This CI scenario exercises **real Docker log retrieval, normalization,
atomic file publishing, active HTTP probes and Prometheus textfile
format**. It does *not* claim to test running systemd timers, the
actual NestJS request middleware, Redis outages, or a real Prometheus
scrape/alert notification. Those have separate unit/E2E checks and
deployment prerequisites documented in
[trusted log forwarder](production-trusted-log-forwarder.md).

It never uses production credentials, stops an actual service, touches
`/var/run/docker.sock` from the unprivileged monitor, or sends any
notification. It does not install or enable host services. The runner
uses Docker privileges **only inside the CI host process**, which
models the separately trusted forwarder; `gym-monitor` retains its
socket-free contract.
