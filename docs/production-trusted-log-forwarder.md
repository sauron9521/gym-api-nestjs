# Trusted log forwarder (PR #129): API stdout to safe Prometheus input

This optional deployment adapter closes the missing integration step between
Nest JSON stdout and the **socket-free** `gym-monitor` service from PR #128.
It does **not** install, enable, or deploy anything automatically.

## Architecture and privileges

~~~text
Production Nest API (JSON stdout/stderr)
  -> Docker local logging driver (10 MB per file, up to 3 files)
  -> TRUSTED root-owned forwarder (reads Docker API, every 1 minute)
  -> /var/log/gym-api/events.jsonl (root:gym-api-logs, 0640)
  -> UNPRIVILEGED gym-monitor (reads JSONL every 5 minutes)
  -> node_exporter textfile gauges (.prom)
  -> operator-managed Prometheus + Alertmanager
~~~

**Security boundary:** Only the *separate trusted forwarder* has Docker API
access, which is effectively **root-equivalent host access**. The
`gym-monitor` account remains outside the `docker` group; it reads only
the sanitized file. This does not eliminate Docker privilege from the
overall monitoring pipeline. If even the trusted forwarder must avoid
Docker access, use a separately designed remote logging-driver or
journald integration instead; do not grant `gym-monitor` Docker access.

The forwarder is a standalone root-owned `systemd` service that performs a
one-shot `docker logs --since 10m --timestamps` query for one explicitly
configured container. Docker adds RFC3339Nano timestamps. Nest's
`ConsoleLogger({ json: true })` emits JSON in production, which is
normalized by `scripts/monitoring-docker-forwarder.mjs`. Both Docker
stdout and stderr are captured to include warning/error logs.

**No raw Docker logs are written to disk by the forwarder.** The normalizer
discards unrecognized text and all fields except:

- ISO timestamp of the Docker log entry;
- HTTP request completion event and numeric HTTP status;
- Redis unavailable/recovered event.

Private emails, sessions, tokens, IPs, paths and free-text error messages
never reach the snapshot. A malformed structured log or invalid Docker
timestamp fails the run before publication.

## Bounded storage, atomic replacement and freshness

The API service in `compose.prod.yml` now uses Docker's `local` logging
driver with `max-size: "10m"`, `max-file: "3"`. Docker handles disk
rotation, and Docker CLI can still read the logs. On upgrading an
existing deployment, **recreate the API container** for the new logging
settings to take effect. At very high log volume, older entries might
be rotated out before collection; verify capacity and alert thresholds.

The forwarder publishes a bounded **last-10-minute rolling JSONL
snapshot** every minute, overwriting the previous file by atomic rename.
It is not an unbounded append-only log or a forensic retention store.
The snapshot is limited to 16 MiB and each input line to 64 KiB;
excessive volume fails the run instead of silently dropping events.
The temporary file contains only sanitized data and is protected by
restrictive permissions. The forwarder validates target path and parent
directory permissions, then writes `0640` with its primary
`gym-api-logs` group.

A failed Docker command, malformed source, parser error or publish error
leaves the previous file and its **old modification time** unchanged.
The existing `monitoring-log-window.mjs` rejects a snapshot older than
**150 seconds** or with a future modification time. Thus a broken
forwarder cannot keep refreshing Prometheus timestamps by re-reading
stale events. The existing absent/stale metrics alert then detects
missing good reports.

A valid idle application can still produce an empty sanitized snapshot.
Use external `/health/live` and `/health/ready` probes to distinguish
zero traffic from an outage.

## Example host installation (not automated)

Use Linux/systemd, an operator-managed Docker daemon, Node.js 22+,
node_exporter and an existing Prometheus deployment. Your host users
and group names may vary.

~~~sh
# Review before creating if these accounts already exist.
sudo groupadd --system gym-api-logs
sudo useradd --system --no-create-home --shell /usr/sbin/nologin gym-monitor
sudo install -d -o root -g gym-api-logs -m 0750 /var/log/gym-api
sudo install -d -o gym-monitor -g node_exporter -m 0750 \
  /var/lib/node_exporter/textfile_collector
sudo install -d -o root -g root -m 0750 /etc/gym-api

sudo install -o root -g root -m 0600 \
  ops/monitoring/forwarder.env.example /etc/gym-api/forwarder.env
sudo install -o root -g root -m 0640 \
  ops/monitoring/monitoring.env.example /etc/gym-api/monitoring.env
~~~

Set `FORWARD_CONTAINER` to the exact container name visible through
`docker ps` and `FORWARD_LOG_FILE` to the path used by
`MONITOR_LOG_FILE` in the unprivileged monitor. Neither filename nor
Docker socket location should be under a world-writable path. Run the
root-owned forwarder with primary group `gym-api-logs`, never run it
as `gym-monitor`, and never grant the monitor Docker privileges.

Install **both** optional forwarder units, validate them, then enable
the forwarder timer. Only afterward enable the existing monitor timer.

~~~sh
sudo install -m 0644 ops/monitoring/gym-api-forwarder.service \
  /etc/systemd/system/gym-api-forwarder.service
sudo install -m 0644 ops/monitoring/gym-api-forwarder.timer \
  /etc/systemd/system/gym-api-forwarder.timer

sudo install -m 0644 ops/monitoring/gym-api-monitor.service \
  /etc/systemd/system/gym-api-monitor.service
sudo install -m 0644 ops/monitoring/gym-api-monitor.timer \
  /etc/systemd/system/gym-api-monitor.timer

sudo systemctl daemon-reload
sudo systemd-analyze verify \
  /etc/systemd/system/gym-api-forwarder.service \
  /etc/systemd/system/gym-api-forwarder.timer \
  /etc/systemd/system/gym-api-monitor.service \
  /etc/systemd/system/gym-api-monitor.timer

sudo systemctl start gym-api-forwarder.service
sudo systemctl enable --now gym-api-forwarder.timer
sudo systemctl start gym-api-monitor.service
sudo systemctl enable --now gym-api-monitor.timer
~~~

Inspect the **sanitized** snapshot only with authorized access, then
confirm that node_exporter can scrape the generated textfile, and the
Prometheus rules in `ops/monitoring/alerts.rules.yml` detect a stopped
forwarder via stale snapshot signals. Avoid exporting raw Docker logs to
untrusted services.

## CI regressions and rollback

`npm run test:monitoring` now includes the forwarder unit suite:
Docker RFC3339Nano and Nest JSON normalization, stderr events,
secret stripping, malformed-input fail-closed behavior, atomic
replacements, strict file permissions, and failed Docker collection.
The unit tests use a fake Docker CLI so they never require a daemon.
Starting in PR #130, the **separate Docker production smoke CI job**
also runs a [real Docker Engine end-to-end test](monitoring-real-docker-e2e.md)
using the actual `local` logging driver, stdout/stderr, forwarder,
JSONL, HTTP probes and Prometheus gauges, including outage/recovery
scenarios. CI also verifies the forwarder shell and systemd units/calendar.

The Docker Engine test does not establish that your **production host**
is provisioned correctly: actual users/groups, on-host file access,
systemd timers and downstream notifications still require deployment checks.
Check these on the real host, and run a controlled drill: force a
forwarder failure, verify the snapshot mtime stays old, and confirm
that the monitor stops publishing fresh gauges and your external alerts
eventually fire.

To disable:

~~~sh
sudo systemctl disable --now gym-api-forwarder.timer
sudo systemctl stop gym-api-forwarder.service
sudo systemctl disable --now gym-api-monitor.timer
sudo systemctl stop gym-api-monitor.service
~~~

Remove optional units, snapshots and alert rules if no longer used.
No Nest API restart or Prisma migration is required for the optional
forwarder, although Docker logging-driver changes require **container
recreation** to apply.
