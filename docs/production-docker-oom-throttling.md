# Docker OOM event window and cgroup v2 CPU throttling — PR #134

This **opt-in** trusted host adapter extends the existing Docker resource monitoring (#133) with two signals that ordinary one-minute `docker stats` sampling can miss: recent Docker OOM events, and actual CPU throttling counter data from Linux cgroup v2. No application or database changes are made.

## Trust and data flow

Docker Engine event history + host /proc/PID/cgroup + /sys/fs/cgroup/<scope>/cpu.stat
  -> **root-only systemd oneshot** gym-api-signals.service (one minute)
  -> atomically replaced gym_api_docker_signals.prom (0640, root:node_exporter)
  -> existing node_exporter textfile collector
  -> operator-managed Prometheus / Alertmanager

**Do not give gym-monitor, the API, or the node_exporter process access to /var/run/docker.sock.** Only the separately trusted host one-shot accesses Docker, which grants root-equivalent privileges. The script requests the exact container's numeric ID/PID/running status, a bounded 10-minute Docker `event=oom` window, and only that container's cgroup v2 `cpu.stat` counters. Container identity must be present in the cgroup pathname. The sample is fixed, label-free numeric text; no names, raw events, IPs, tokens, raw inspection details or cgroup paths are published.

The output file is named exactly `gym_api_docker_signals.prom` in a non-group-writable directory. A CLI parse error, missing container, unsupported cgroup or failed file publish leaves the **previous file and old timestamp** unchanged so stale alerts can fire. When stopped, recent OOM event count may still be exported; CPU counters are omitted instead of reporting zero.

## Exported series

| Metric | Meaning |
| --- | --- |
| gym_api_docker_signals_last_sample_timestamp_seconds | Last successfully published sample |
| gym_api_docker_signals_running | 1 running, 0 stopped |
| gym_api_docker_oom_events_window_10m | Count of available Docker `oom` event records in the last ten minutes |
| gym_api_docker_cpu_periods_total | cgroup v2 `nr_periods` |
| gym_api_docker_cpu_throttled_periods_total | cgroup v2 `nr_throttled` |
| gym_api_docker_cpu_throttled_seconds_total | cgroup v2 `throttled_usec` / 1e6 |

The CPU throttling alert checks whether the ratio of **throttled periods to all periods** over five minutes is at least 20% for two minutes. This measures real cgroup throttling rather than inferring throttling from Docker CPU usage.

**Limitations:** Docker's event replay buffer is finite (and may be truncated under heavy activity). The 10-minute query is a **bounded rolling window, not a complete or durable OOM event history**. Docker daemon downtime/restarts can lose events. It does not deduplicate events that Docker itself repeats, and it does not invent zero when the Docker query fails. This does not persist cross-container-generation incidents; if the API container is recreated, a new container ID has a new window. Cgroup CPU counters reset when the cgroup is recreated; Prometheus `increase` handles ordinary counter resets but monitoring requires careful validation around frequent recreation. Only host cgroup v2 is supported: no cgroup v1 fallback, root host cgroup substitution, or silent fake counters.

## Host installation

Requires Linux with **unified cgroup v2** and Docker Engine, Node 22+, existing node_exporter textfile collector, and an already authorized operator-managed Prometheus installation. Install only after reviewing the Docker-root trust boundary.

~~~sh
sudo install -o root -g root -m 0600 \
  ops/monitoring/signals.env.example /etc/gym-api/signals.env
sudo install -o root -g root -m 0644 \
  ops/monitoring/gym-api-signals.service /etc/systemd/system/gym-api-signals.service
sudo install -o root -g root -m 0644 \
  ops/monitoring/gym-api-signals.timer /etc/systemd/system/gym-api-signals.timer
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/gym-api-signals.service \
  /etc/systemd/system/gym-api-signals.timer
sudo systemctl start gym-api-signals.service
sudo systemctl enable --now gym-api-signals.timer
~~~

Set `SIGNALS_CONTAINER` to the exact Docker container name visible in `docker compose -f compose.prod.yml ps`. The destination directory must be pre-created, owned by trusted system accounts, not group/world writable, with read access for node_exporter. Confirm `/sys/fs/cgroup/cgroup.controllers` exists and the current API process cgroup resolves to that container's ID. The example unit assumes node_exporter's group is `node_exporter`.

**Prometheus alert rules must be deployed together with the opted-in collector.** If you install the rules but not the collector, `GymApiDockerSignalsSnapshotMissing` correctly fires. Validate the rule syntax and alert routing, then confirm the last-sample timestamp updates and that `node_textfile_scrape_error == 0`.

## Test and incident drill

Run `npm run test:monitoring` for unit/security checks. CI runs `promtool check rules`, `promtool test rules`, systemd verification and a **real Docker Engine** test using a disposable non-root runtime-image container (running, missing and stopped). It does not intentionally OOM-kill a container, so OOM detection itself is validated with synthetic event fixtures, **not** a real OOM event.

For a staging drill, stop the *signals timer*, verify its .prom timestamp does not advance, verify the stale alert after its configured delay, then restart it and confirm recovery. Review `GymApiDockerRecentOomEvents` and `GymApiDockerCpuThrottling` separately; do not assume that a healthy current API container means no OOM occurred in the recent event window.

## Rollback

First disable the new alerts in the operator-managed Prometheus rule deployment, then disable and stop `gym-api-signals.timer` and `gym-api-signals.service`. Remove only the standalone `gym_api_docker_signals.prom`. Leave existing `gym-api-resources`, the log forwarder, `gym-monitor`, database and API intact. No migration or production Compose change is necessary.
