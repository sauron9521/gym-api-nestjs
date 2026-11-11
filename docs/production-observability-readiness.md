# Production observability readiness and notification drill (PR #135)

This optional operator workflow checks local monitoring setup and documents an explicit Alertmanager receiver drill. Nothing is deployed, changed or notified automatically.

## Read-only host preflight

Run on an authorized Linux host after provisioning the optional collectors. The operator account needs read access to the sanitized metrics but **not** the Docker socket.

| Component | Timer | File | Maximum age |
| --- | --- | --- | --- |
| Forwarder | gym-api-forwarder.timer | events.jsonl | 150 seconds |
| Monitor | gym-api-monitor.timer | gym_api_monitor.prom | 900 seconds |
| Docker resources | gym-api-resources.timer | gym_api_docker.prom | 180 seconds |
| Docker OOM/cgroup | gym-api-signals.timer | gym_api_docker_signals.prom | 180 seconds |

~~~sh
npm run monitoring:preflight

# Override default absolute locations if deployment paths differ:
npm run monitoring:preflight -- \
  --log-file /var/log/gym-api/events.jsonl \
  --textfile-dir /var/lib/node_exporter/textfile_collector
~~~

The preflight checks each timer is active and enabled, file/directory security and freshness, and the exported last-success timestamps (not just the filesystem mtime). It rejects symlinks, missing data and malformed timestamps. Output contains only static component names and failure codes: no raw logs, paths, credentials or Docker inspection. Exit code **0** means local checks pass; **1** means at least one failure.

**Local preflight does NOT prove end-to-end readiness.** Separately verify in Prometheus that the appropriate node_exporter target is up, `node_textfile_scrape_error == 0`, exported metrics are present, and alert rules are loaded. Check API `/health/live` and `/health/ready`. If Prometheus itself is offline, its missing-series alerts cannot run.

~~~sh
promtool check rules ops/monitoring/alerts.rules.yml
promtool test rules ops/monitoring/alerts.test.yml
~~~

CI validates PromQL behavior, **not** delivery to real recipients.

## Supervised synthetic Alertmanager notification drill

First configure a **dedicated test receiver** and confirm the Alertmanager route matches BOTH `alertname=GymApiMonitoringDeliveryDrill` and `drill=true`. Ensure this route **cannot page the production on-call**. No Alertmanager route or receiver is created by this repository.

A dry run only prints a synthetic warning alert and makes no HTTP request:

~~~sh
npm run monitoring:alert-drill
~~~

After confirming the test-only route, an authorized operator can explicitly submit it:

~~~sh
npm run monitoring:alert-drill -- \
  --origin http://127.0.0.1:9093 \
  --send --acknowledge-test-route
~~~

The script makes one POST to `/api/v2/alerts`, sends only fixed labels, uses a three-minute expiry, rejects URL credentials, redirects and insecure remote HTTP, and has a five-second timeout. **HTTP 200/202 confirms API acceptance only**, not delivery. Output states `notificationConfirmed: false`. The operator must independently confirm receipt in the test destination and that the alert expires, then record results and remove temporary routing. CI never sends the alert.

## Stale metrics and recovery rehearsal

Perform only in staging or an authorized maintenance window. Confirm test receiver routing and fresh metrics; stop the `gym-api-signals.timer` without stopping the API or Docker. Check that its exported timestamp does not advance. After the stale threshold and Prometheus evaluation delay, confirm the alert appears and reaches the test receiver. Restore the timer and oneshot; verify metrics refresh, node_exporter scrapes successfully and the alert resolves.

~~~sh
# Approved staging drill only:
sudo systemctl stop gym-api-signals.timer
# Restore after observation:
sudo systemctl enable --now gym-api-signals.timer
sudo systemctl start gym-api-signals.service
~~~

Lack of an alert is NOT evidence of health when Prometheus itself or its scrape target is down. Never share raw Docker logs or private Alertmanager routes.

## Rollback and boundaries

Remove test-only receiver routing and disable the drill. New preflight and drill scripts are optional: they do not enable services, grant gym-monitor Docker access, alter Prisma, change the API, or modify Compose. The existing privileged collectors remain separate.
