# Optional monitoring integration — PR #126

This is an **opt-in, host-side** integration for the existing
[monitoring report](production-monitoring-alerts.md) from PR #125.
It does not install, deploy, enable or connect any monitoring service
by itself.

The components are:

- one-shot Docker log collection for a **five-minute window**,
  combined with external GET probes to /health/live and /health/ready;
- a privacy-safe, label-free **Prometheus textfile snapshot** written
  by an atomic rename, suitable for an already installed
  node_exporter textfile collector;
- optional systemd service and timer templates (five-minute cadence);
- optional Prometheus alerting rule templates (readiness, liveness,
  Redis outage, elevated 429/503 and missing/stale reports).

There is no new API /metrics route, dependency, secret, persistent
database table, CI credential, message-sending service or deployment
change for the NestJS application.

## 1. Security requirements and prerequisites

Install Node.js 22+, bash, the Docker CLI, and an existing
node_exporter configured to read **textfile snapshots**. You must
separately configure Prometheus to scrape node_exporter and a
notification service to receive Prometheus alert notifications.

For the included systemd example, install the repository or a
versioned checkout under /opt/gym-api. Provision a dedicated
gym-monitor system user and a textfile directory readable by
the node_exporter group. The following are **example commands only**;
verify actual local usernames/group names before using them:

```sh
sudo install -d -o gym-monitor -g node_exporter -m 0750 \
  /var/lib/node_exporter/textfile_collector
sudo install -d -o root -g root -m 0750 /etc/gym-api
sudo install -o root -g root -m 0640 \
  ops/monitoring/monitoring.env.example \
  /etc/gym-api/monitoring.env
```

The generated .prom snapshot has **0640** permissions and the service
runs with primary group node_exporter; the source JSON report uses
mktemp and is removed after each run. The snapshot contains only
aggregates and fixed metric names, never email addresses, token values,
user IDs, IPs, API URLs or Redis URLs.

**Docker socket access is equivalent to root privileges.**
The example service uses a supplemental docker group solely to read
container logs. Only trusted operators should use this approach.
For stronger separation, replace the Docker command in the runner with
a restricted, read-only log collector: do not give arbitrary users access
to the Docker socket. Never expose the textfile directory over HTTP.

## 2. Set up the opt-in host timer

Edit /etc/gym-api/monitoring.env to supply the actual Docker
container name, the operator-reachable API origin, and the absolute
output .prom file path. The three variables are:

- API_CONTAINER — one exact Docker name (no spaces or shell flags)
- MONITOR_API_ORIGIN — HTTP(S) origin only, no path or credentials
- MONITOR_TEXTFILE_PATH — an existing textfile directory and .prom filename

Keep the environment file private even though it should contain no
secrets. Prefer HTTPS if monitoring across a network.

Copy the templates explicitly and verify them before enabling:

```sh
sudo install -m 0644 ops/monitoring/gym-api-monitor.service \
  /etc/systemd/system/gym-api-monitor.service
sudo install -m 0644 ops/monitoring/gym-api-monitor.timer \
  /etc/systemd/system/gym-api-monitor.timer
sudo systemctl daemon-reload
sudo systemd-analyze verify \
  /etc/systemd/system/gym-api-monitor.service \
  /etc/systemd/system/gym-api-monitor.timer
sudo systemctl start gym-api-monitor.service
sudo systemctl enable --now gym-api-monitor.timer
systemctl list-timers gym-api-monitor.timer
```

The timer triggers every five minutes. Each execution reads only
the last five minutes of Docker logs **as selected by Docker**, and
runs both health probes. The producer exit code is checked before
publishing so Docker failures cannot silently become an apparently
healthy zero-request report.

The monitoring report's exit code **2** means critical signal(s)
were detected, not a publishing error. The example systemd service
treats 2 as a successful publication; the critical gauges remain
visible for external alert rules. Exit 1 means collector/report failure
and leaves the last complete .prom snapshot untouched. The stale
timestamp alert will eventually detect a missed publication.

For a manual dry run, export the same three environment variables
in a trusted shell, then run:

```sh
bash scripts/monitoring-collect.sh
npm run test:monitoring
```

The runner writes no raw Docker logs or tokens to stdout.
It does not issue notifications, and it is not automatically
scheduled until the operator enables the systemd timer.

## 3. Scrape and alert with an existing Prometheus installation

Enable node_exporter with a textfile directory setting that matches
MONITOR_TEXTFILE_PATH's parent directory:

```text
--collector.textfile.directory=/var/lib/node_exporter/textfile_collector
```

In an **existing** Prometheus configuration, scrape that node_exporter
target (example only; replace host/IP with your secured network):

```yaml
scrape_configs:
  - job_name: gym-api-node-exporter
    static_configs:
      - targets: ["127.0.0.1:9100"]
rule_files:
  - /etc/prometheus/rules/gym-api-monitoring.yml
```

Install the included ops/monitoring/alerts.rules.yml into the path
referenced by your Prometheus configuration, and run:

```sh
promtool check rules ops/monitoring/alerts.rules.yml
```

These rules alert on absent/stale snapshots, failed liveness/readiness,
unconfigured readiness probes, elevated 429/503 proportions, a Redis
outage observed in the last window, and node_exporter textfile parsing
errors. **They do not send alerts by themselves**: configure and test
your own Prometheus/Alertmanager notification pipeline separately.

The snapshot gauges have no labels and represent the last completed
five-minute interval, **not cumulative Prometheus counters**. The
metric gym_api_monitor_last_run_timestamp_seconds detects a stopped
collector; it is intentionally refreshed only after successful
collection and publication. A probe value of -1 means not checked,
0 means failed, and 1 means healthy. The 429/503 gauges use the same
minimum sample size (20 completed requests) and thresholds as PR #125.

A single-host sample is not a high-availability monitoring topology.
For multiple API replicas, either collect and label them separately
at the monitoring system level or aggregate from a trusted collector;
do not add user IDs, emails or raw request labels to metric names.
A rolling five-minute log window is not exactly-once event ingestion;
window boundaries and scheduling delays can overlap or omit events.
Validate the baseline and alert thresholds in staging before using
them for operational paging.

## CI validation and alert regression tests (PR #127)

The required CI pipeline validates the optional templates before any operator
installs them. It runs:

- `npm run test:monitoring` including `monitoring-config.test.mjs`: checks
  Prometheus alert metric names against actual label-free exporter output,
  service/timer security properties, five-minute window and unchanged
  last-run timestamp semantics, and rejects accidental credential fields;
- `systemd-analyze verify` for both service and timer and
  `systemd-analyze calendar '*:0/5'` for schedule syntax;
- the official immutable Prometheus `promtool` image with
  `check rules` and `test rules`, using
  `ops/monitoring/alerts.test.yml`.

Rule fixtures cover a missing snapshot after the grace period, a stale
timestamp even if the old textfile remains available, healthy samples,
small-sample threshold exclusions, sustained HTTP 429/503, failed and
unconfigured readiness, Redis outage and node_exporter textfile errors.
A malformed PromQL expression or a rule that stops firing as expected
now blocks the PR in CI. No Redis, Prometheus server, alert receiver or
production credentials are required for these **config tests**.

These tests do **not** validate your target host's actual systemd user,
permissions, Docker socket access, network reachability or notification
routing. After installing, repeat the host-side verification and a
controlled alert drill. Do not enable the optional timer automatically
as part of CI.

## 4. Verification and rollback

Check that node_exporter can read the textfile, and that Prometheus
scrapes it successfully. Test a controlled readiness failure and
a deliberately missing report, confirming that external alerts fire.
Recheck the log source and timer if the last-run timestamp becomes stale.

To stop the optional integration, disable the timer and service:

```sh
sudo systemctl disable --now gym-api-monitor.timer
sudo systemctl stop gym-api-monitor.service
```

Then remove the optional Prometheus alert rules and textfile snapshot
if they are no longer used. **No application rollback or database
migration is necessary.** All production API behavior remains
unchanged.
