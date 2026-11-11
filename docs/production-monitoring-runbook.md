# Production monitoring incident runbook (PR #131)

This is an **opt-in operator guide**, not a deployment. The CI Docker Engine test in PR #130 proves the data path on an isolated runner; it does not prove production host permissions, systemd scheduling, Prometheus scraping or Alertmanager delivery.

## Signals and expected response

| Signal | Meaning | First action |
| --- | --- | --- |
| `GymApiMonitoringSnapshotMissing` | No last-run series is scraped | Verify node_exporter textfile collector and Prometheus target |
| `GymApiMonitoringSnapshotStale` | Last published report is older than 15 minutes | Check both systemd timers and source freshness |
| `GymApiMonitoringTextfileReadError` | node_exporter cannot parse/read textfile | Check file ownership, permissions, and collector logs |
| `GymApiMonitoringCriticalSignal` | Aggregated report has a critical finding | Check liveness, readiness, and elevated 503s |
| `GymApiMonitoringWarningSignal` | Aggregated report has a warning | Check elevated 429s and Redis outage transitions |
| `GymApiLivenessFailed` / `GymApiReadinessFailed` | Health probe returned non-200 or failed | Investigate API/container and its dependencies |

Aggregate alerts intentionally overlap specific alerts. Configure Alertmanager grouping/inhibition in your deployment to avoid duplicate notifications; these repository rules **do not** configure routing.

## Read-only diagnosis

Run on the authorized host. Do not paste logs, credentials or private paths into tickets.

```sh
systemctl status gym-api-forwarder.timer gym-api-monitor.timer --no-pager
systemctl status gym-api-forwarder.service gym-api-monitor.service --no-pager
systemctl list-timers 'gym-api-*' --all
systemctl show gym-api-forwarder.service -p Result -p ExecMainStatus
systemctl show gym-api-monitor.service -p Result -p ExecMainStatus
sudo stat -c '%n %U:%G %a %y' /var/log/gym-api/events.jsonl
sudo stat -c '%n %U:%G %a %y' /var/lib/node_exporter/textfile_collector/gym_api_monitor.prom
```

The forwarder runs every minute; monitor collection runs every five minutes. A stale JSONL snapshot older than 150 seconds is rejected and the last good `.prom` timestamp must **not** advance. A healthy monitoring report can return exit status 0; a report with critical findings returns 2 and is explicitly accepted by the monitor systemd unit. Do not treat status 2 as a broken collector.

Validate the Prometheus target and alert rule configuration with your installed Prometheus `promtool check rules ops/monitoring/alerts.rules.yml` before deploying. Confirm the node_exporter textfile collector is enabled, that `node_textfile_scrape_error` is zero, and that the `gym_api_monitor_last_run_timestamp_seconds` series updates. Check `up` for the node_exporter target separately: the repository's snapshot alerts cannot fire when Prometheus itself is down or the relevant scrape target disappears.

## Controlled failure and recovery drill

Perform only in an approved maintenance window on a nonproduction or designated staging host:

1. Record current `.prom` timestamp and active alert state. Confirm alert routing reaches the intended test receiver.
2. Stop the **forwarder timer** (not Docker or the API), allow existing source data to age, and verify monitor runs stop updating the last-run timestamp.
3. After the configured stale threshold and alert `for` period, verify that the stale alert transitions to firing and reaches the test receiver. Timing includes scrape/evaluation intervals.
4. Re-enable the forwarder timer, start a one-shot forwarder run, then start a one-shot monitor run. Confirm both files refresh, the last-run timestamp increases, and the stale alert resolves after the next scrape/evaluation.
5. Verify a healthy probe and clean warning/critical gauges. Restore any overridden notification routes and record the result.

```sh
# Staging only, with change approval:
sudo systemctl stop gym-api-forwarder.timer
# Observe staleness, then recover:
sudo systemctl enable --now gym-api-forwarder.timer
sudo systemctl start gym-api-forwarder.service
sudo systemctl start gym-api-monitor.service
```

Never grant `gym-monitor` Docker socket access. Only the separate trusted forwarder uses Docker privileges. Do not inspect raw Docker logs as part of routine alert triage.

## Rollback

If the new aggregate alerts are too noisy, remove only `GymApiMonitoringCriticalSignal` and `GymApiMonitoringWarningSignal` from the operator-managed Prometheus rule installation, validate with promtool and reload Prometheus using your deployment's approved procedure. Existing specific alerts and monitoring collection remain unchanged. This PR does not change API code, dependencies, Docker Compose, host provisioning, or notification delivery.
