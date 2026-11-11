# Optional production monitoring — read-only, socket-free collection (PR #128)

This remains an **opt-in host-side integration**, not a deployed service.
PR #129 adds an [optional trusted Docker log forwarder](production-trusted-log-forwarder.md)
with atomic ten-minute JSONL snapshots refreshed every minute. The
forwarder (and only the forwarder) has privileged Docker API access;
`gym-monitor` retains read-only JSONL permissions.
PR #128 removes the Docker socket requirement and replaces the privileged
`docker logs` command with a strict reader of a **dedicated, timestamped
JSONL file**. Application code, API behavior and Prometheus alert rules
are unchanged.

## Trust boundaries

1. A **separate trusted log forwarder** (not installed by this repo)
   collects the API's structured events and writes a restricted JSONL
   file. Its design, ownership, rotation and retention require an
   operator's review; it must not accept untrusted writers.
2. `gym-monitor` reads only that file. The source reader selects the
   last five minutes and forwards **only whitelisted events**:
   `http.request.completed` with integer `statusCode`,
   `RATE_LIMIT_REDIS_UNAVAILABLE` and `RATE_LIMIT_REDIS_RECOVERED`.
   All arbitrary fields (URLs, email, tokens, IDs, headers) are discarded
   **before** the monitoring report receives the data.
3. The existing monitoring-report probes `/health/live` and
   `/health/ready`; the existing textfile exporter atomically writes
   fixed unlabeled Prometheus gauges. The optional systemd timer runs
   every five minutes **only after explicit installation**.
4. A separately deployed node_exporter/Prometheus/alert receiver can
   read snapshots and fire the tested alert rules. None is installed
   or connected by this PR.

The monitor user is **not in the Docker group**, and the unit never
contacts `/var/run/docker.sock`. Docker socket access is effectively
privileged access to the host; do not grant it to this collector.

## Source file contract

For example, a trusted forwarder writes `/var/log/gym-api/events.jsonl`
as a regular file owned by the forwarder, group `gym-api-logs`, mode
`0640`. Parent directory permissions must also prevent unauthorized
replacement or traversal. The monitor opens the file read-only with
`O_NOFOLLOW` and rejects symlinks, FIFOs, directories, group-writable or
world-accessible files. Use independent log rotation; the reader
rejects sources over **64 MiB** or lines over **64 KiB** rather than
silently truncating data.

Each line must be a complete JSON object with an ISO 8601 `timestamp`
or `time` (timezone Z or an explicit UTC offset), for example:

~~~json
{"timestamp":"2026-11-11T06:30:00Z","event":"http.request.completed","statusCode":429}
{"timestamp":"2026-11-11T06:31:00Z","event":"RATE_LIMIT_REDIS_UNAVAILABLE"}
~~~

Nested event metadata under `message`, `context`, `metadata` or `data`
is supported. The trusted forwarder must normalize any other log
wrappers. Missing/malformed timestamps are **hard errors**. Future
timestamps more than five seconds ahead are rejected; older entries
outside the five-minute window are ignored. Keep clocks synchronized.
Well-formed unknown events are discarded without logging their payload.

Do not point the monitor at Docker's internal container data or grant
access to broad journald groups. The log-forwarder process and its
least-privilege collection method are a **deployment prerequisite**,
not supplied by this code change.

## Host permissions and optional timer

Provision an appropriate dedicated user and groups separately, then
review local host ownership. Example commands for a Linux host with
`node_exporter` and a trusted log forwarder already installed:

~~~sh
sudo groupadd --system gym-api-logs
sudo useradd --system --no-create-home --shell /usr/sbin/nologin gym-monitor
sudo install -d -o root -g gym-api-logs -m 0750 /var/log/gym-api
sudo install -d -o gym-monitor -g node_exporter -m 0750 \
  /var/lib/node_exporter/textfile_collector
sudo install -d -o root -g root -m 0750 /etc/gym-api
sudo install -o root -g root -m 0640 \
  ops/monitoring/monitoring.env.example /etc/gym-api/monitoring.env
~~~

The trusted forwarder must create/rotate `events.jsonl`, e.g. as
`root:gym-api-logs` with mode `0640`. The monitoring user should **not**
own or write source logs. It uses primary `Group=node_exporter` for the
sanitized output and `SupplementaryGroups=gym-api-logs` for read-only
access to the source.

Set the three non-secret variables in `/etc/gym-api/monitoring.env`:

- `MONITOR_LOG_FILE=/var/log/gym-api/events.jsonl`
- `MONITOR_API_ORIGIN=http://127.0.0.1:3000` (sample origin only)
- `MONITOR_TEXTFILE_PATH=/var/lib/node_exporter/textfile_collector/gym_api_monitor.prom`

Use HTTPS for remote health probes and never put passwords, tokens,
paths or queries in the API origin. The service has `NoNewPrivileges`,
`ProtectSystem=strict`, `PrivateTmp`, `PrivateDevices` and a single
writable textfile directory.

Install/enable the templates **only after** verifying the source file
and permissions:

~~~sh
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
~~~

## Failure handling, observability and rollback

The runner checks the source reader and report statuses independently.
Missing, unreadable, oversized, untrusted, malformed or clock-skewed
input exits **1** and leaves the previous complete `.prom` snapshot
**unchanged**, including its timestamp. A valid report exit **2**
means a critical health signal, not a publication failure. The optional
systemd service treats 2 as successful publication for Prometheus.

Snapshots have mode `0640` and contain only numeric gauges and fixed
metric names. The last-run timestamp advances **only after a successful
publication**, so missing/stale-snapshot Prometheus alerts are essential.
A valid but empty file can produce zero requests; independently probe
liveness/readiness to distinguish idle traffic from an outage.

Run the regression suite:

~~~sh
npm run test:monitoring
~~~

CI also validates shell syntax, systemd units and alert rules with
`promtool check rules` and `promtool test rules`. These tests do not
verify your actual log-forwarder provisioning, host permissions, remote
network access or notification pipeline. Test the alerts in staging.

Configure an existing node_exporter to read:

~~~text
--collector.textfile.directory=/var/lib/node_exporter/textfile_collector
~~~

Load `ops/monitoring/alerts.rules.yml` in your independently configured
Prometheus. Alert notification delivery requires a separate provider.
Five-minute file reads are not exactly-once ingestion: clock skew,
rotation or delayed log delivery may overlap or miss records, so tune
thresholds to observed production behavior.

Disable the optional integration without changing the API:

~~~sh
sudo systemctl disable --now gym-api-monitor.timer
sudo systemctl stop gym-api-monitor.service
~~~

You may then remove the optional metrics snapshot and rules. No Prisma
migration or application rollback is necessary.
