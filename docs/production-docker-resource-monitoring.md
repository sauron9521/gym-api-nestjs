# Production Docker container resource monitoring (PR #133)

This is an **optional host-side monitoring adapter**, not a new API feature or an automatic deployment. PR #132 introduced API resource ceilings (1 GiB RAM, 2 CPUs, 256 PIDs) and restart-policy tests; this PR adds a narrowly scoped resource sampler and Prometheus alerts.

## Security architecture

~~~text
Docker Engine / API container
  -> TRUSTED, root-operated gym-api-resources.service (Docker CLI)
  -> fixed, sanitized /var/lib/node_exporter/textfile_collector/gym_api_docker.prom
  -> unprivileged node_exporter textfile collector
  -> operator-managed Prometheus / Alertmanager
~~~

**The existing unprivileged gym-monitor does not invoke Docker and is not granted the Docker socket.** The new root service uses the Docker API, which is host-root-equivalent. Do not move it into the API container or grant Docker access to gym-monitor. The collector invokes Docker only for two queries: fixed numeric status fields via `docker inspect --format`, and a single-container `docker stats --no-stream --format '{{json .}}'`. It never requests full inspect data, environment variables, container labels, arbitrary logs, or network identifiers for publication.

The output contains seven **fixed-name, label-free numeric gauges**. No hostnames, container names, URLs, paths, raw stats JSON or credentials are written. The output is atomically replaced with `0640`, and unsafe destinations or parent directories are rejected. Failure preserves the last successfully published file and its old timestamp.

## Metrics and limitations

| Metric | Meaning |
| --- | --- |
| gym_api_docker_last_sample_timestamp_seconds | Unix timestamp of last successful sample |
| gym_api_docker_running | 1 running, 0 stopped |
| gym_api_docker_cpu_percent | Docker CPU percentage, potentially up to 200% for this 2-CPU configuration |
| gym_api_docker_memory_percent | Percentage of the configured memory limit |
| gym_api_docker_pids | Current Docker-reported process count |
| gym_api_docker_restart_count | Docker restart counter for the current container instance |
| gym_api_docker_oom_killed | 1 if Docker reports OOMKilled for the current inspected state |

For a stopped container, CPU, memory and PID gauges are **-1 (unknown)**, not fake zeros. An unknown/missing container or Docker CLI failure does not advance the published timestamp. Missing and stale metrics have their own alerts, so the collector cannot silently report false health.

**Detection caveats:** Docker's `OOMKilled` flag describes inspected container state and can reset when the container restarts; a one-minute sampler **can miss short-lived OOM incidents**. `RestartCount` resets when the container is recreated, so the restart-loop rule using a positive 10-minute delta can miss resets or events between samples. This adapter does not read kernel cgroup CPU throttling counters and does not claim to measure CPU throttling: high Docker CPU percentage is a *saturation proxy*, not throttled time. Full historical OOM and CPU-throttling event coverage requires a separate host events/cgroup integration.

## Installation (operator opt-in)

Requires an authorized Linux/systemd Docker host, Node.js 22+, existing node_exporter with the textfile collector enabled, and an operator-managed Prometheus/Alertmanager. Inspect the service and file permissions before installation.

~~~sh
sudo install -o root -g root -m 0600 \
  ops/monitoring/resources.env.example /etc/gym-api/resources.env
sudo install -o root -g root -m 0644 \
  ops/monitoring/gym-api-resources.service /etc/systemd/system/gym-api-resources.service
sudo install -o root -g root -m 0644 \
  ops/monitoring/gym-api-resources.timer /etc/systemd/system/gym-api-resources.timer
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/gym-api-resources.service \
  /etc/systemd/system/gym-api-resources.timer
~~~

Set `RESOURCE_CONTAINER` to the exact production API container name from `docker compose -f compose.prod.yml ps`, and `RESOURCE_TEXTFILE_PATH` to an existing trusted textfile collector directory with the fixed filename `gym_api_docker.prom`. The example expects `/var/lib/node_exporter/textfile_collector` with node_exporter read access; the collector service writes as `root:node_exporter`. Ensure the directory is **not group- or world-writable**. Confirm that the Docker Engine and Prometheus textfile collector are configured before enabling the timer.

~~~sh
sudo systemctl start gym-api-resources.service
sudo systemctl enable --now gym-api-resources.timer
sudo systemctl status gym-api-resources.service gym-api-resources.timer --no-pager
sudo stat -c '%U:%G %a %y' \
  /var/lib/node_exporter/textfile_collector/gym_api_docker.prom
~~~

Do not inspect or print raw Docker inspect output in public CI logs. The collector displays only generic failure messages, and a failed sampling run does not overwrite the last good `.prom` file.

## Alerts and drills

`ops/monitoring/alerts.rules.yml` provides alerts for missing/stale resource snapshots, stopped containers, observed OOM kill state, sustained memory >=90%, CPU >=180% (for the 2-CPU ceiling), PID count >=230 (of 256), and at least three restart-count increments within ten minutes. The resource alerts are meaningful only **after this optional collector has been installed**. Deploy them together; otherwise the `Missing` alert will deliberately fire.

Verify Prometheus scrape status, node_exporter textfile parse errors, and alert delivery as part of commissioning. For staging failure drills, stop the timer (not the API), verify the last-sample timestamp stays old, confirm stale alert delivery, restart the timer and one-shot service, and verify the alert resolves. To test OOM behavior, prefer a disposable dedicated test container rather than intentionally OOM-killing the production API.

## Validation and rollback

`npm run test:monitoring` verifies parsing, non-leakage, atomic publishing, and service isolation. Required CI runs `promtool check rules`, `promtool test rules` and systemd validation. The existing production Docker smoke job now exercises the sampler with a **real disposable Docker container** (running, stopped, and missing), without touching the production API or causing an OOM.

For rollback, remove/disable the matching resource alert rules in the operator-managed Prometheus configuration **first**, then stop/disable the resource timer/service and delete the standalone `gym_api_docker.prom` file. Leave the existing API log forwarder and unprivileged monitoring pipeline intact. This PR needs no Prisma migration and introduces no service in production Compose.
