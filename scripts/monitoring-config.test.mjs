import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildReport, emptySummary } from './monitoring-report.mjs';
import { metricsFromReport } from './monitoring-textfile.mjs';

const root = new URL('../', import.meta.url);
function read(relative) {
  return readFileSync(new URL(relative, root), 'utf8');
}

const service = read('ops/monitoring/gym-api-monitor.service');
const timer = read('ops/monitoring/gym-api-monitor.timer');
const alerts = read('ops/monitoring/alerts.rules.yml');
const exampleEnv = read('ops/monitoring/monitoring.env.example');
const runner = read('scripts/monitoring-collect.sh');
const forwarder = read('scripts/monitoring-forward.sh');
const forwarderService = read('ops/monitoring/gym-api-forwarder.service');
const forwarderTimer = read('ops/monitoring/gym-api-forwarder.timer');
const forwarderEnv = read('ops/monitoring/forwarder.env.example');

test('every referenced exported monitoring gauge exists and has no labels', () => {
  const report = buildReport(emptySummary(), {
    live: { status: 'ok', httpStatus: 200 },
    ready: { status: 'ok', httpStatus: 200 },
  });
  const sample = metricsFromReport(report, 1_700_000_000);
  const names = new Set(
    [...sample.matchAll(/^# TYPE (gym_api_monitor_[a-z0-9_]+) gauge$/gm)]
      .map((m) => m[1]),
  );
  assert.ok(names.size >= 10);
  const referenced = new Set(alerts.match(/gym_api_monitor_[a-z0-9_]+/g) ?? []);
  for (const metric of referenced) {
    assert.ok(names.has(metric), 'Unknown exporter metric referenced by alert rule: ' + metric);
  }
  assert.doesNotMatch(sample, /\{[^\n]*\}|private@example|token|redis:\/\//);
  assert.ok([...names].every((name) => !name.includes('email') && !name.includes('user')));
});

test('stale snapshot retains old timestamp even when the collector cannot write', () => {
  const report = buildReport(emptySummary());
  const previous = metricsFromReport(report, 1_700_000_000);
  const match = previous.match(/^gym_api_monitor_last_run_timestamp_seconds (\d+)$/m);
  assert.ok(match);
  const previousTime = Number(match[1]);

  // Prometheus alert: time() - last_run > 900, followed by for: 2m.
  assert.match(alerts, /time\(\) - gym_api_monitor_last_run_timestamp_seconds > 900/);
  assert.match(alerts, /GymApiMonitoringSnapshotMissing[\s\S]*?absent\(gym_api_monitor_last_run_timestamp_seconds\)/);
  const staleRule = alerts.match(/- alert: GymApiMonitoringSnapshotStale([\s\S]*?)(?=\n\s+- alert:|$)/);
  assert.ok(staleRule);
  assert.match(staleRule[1], /for: 2m/);
  assert.equal(1_700_000_899 - previousTime > 900, false);
  assert.equal(1_700_000_901 - previousTime > 900, true);
});

test('systemd timer is opt-in and points to a one-shot service every five minutes', () => {
  assert.match(timer, /^OnCalendar=\*:0\/5$/m);
  assert.match(timer, /^Unit=gym-api-monitor\.service$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^ExecStart=\/usr\/bin\/bash \/opt\/gym-api\/scripts\/monitoring-collect\.sh$/m);
  assert.match(service, /^SuccessExitStatus=2$/m);
  assert.match(service, /^User=gym-monitor$/m);
  assert.match(service, /^Group=node_exporter$/m);
  assert.match(service, /^SupplementaryGroups=gym-api-logs$/m);
  assert.match(service, /^ReadOnlyPaths=\/var\/log\/gym-api$/m);
  assert.doesNotMatch(service, /^SupplementaryGroups=docker$/m);
  assert.match(service, /^PrivateDevices=true$/m);
  assert.match(service, /^RestrictSUIDSGID=true$/m);
  assert.match(service, /^UMask=0027$/m);
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.match(service, /^ProtectSystem=strict$/m);
  assert.doesNotMatch(service, /ExecStartPost=|ExecStartPre=.*curl|\/bin\/sh -c/);
  assert.doesNotMatch(service + timer, /systemctl enable|systemctl start/);
});

test('runner only consumes read-only JSONL and preserves old metrics on source errors', () => {
  assert.match(runner, /monitoring-log-window\.mjs/);
  assert.match(runner, /--file "\$MONITOR_LOG_FILE"/);
  assert.doesNotMatch(runner + service, /docker logs|\/var\/run\/docker\.sock|SupplementaryGroups=docker/);
  assert.match(runner, /PIPESTATUS\[@\]/);
  assert.match(runner, /statuses\[0\]/);
  assert.match(runner, /statuses\[1\]/);
  assert.match(runner, /monitoring-textfile\.mjs/);
  assert.match(runner, /exit "\$\{statuses\[1\]\}"/);
});

test('example environment does not include secrets or arbitrary log destination options', () => {
  const entries = exampleEnv.split('\n')
    .filter((line) => line && !line.trimStart().startsWith('#'));
  const keys = entries.map((line) => line.split('=')[0]);
  assert.deepEqual(keys, [
    'MONITOR_LOG_FILE',
    'MONITOR_API_ORIGIN',
    'MONITOR_TEXTFILE_PATH',
  ]);
  assert.doesNotMatch(entries.join('\n'), /bearer|password|jwt|token|secret|api_key/i);
  assert.ok(entries.every((line) => line.split('=', 2).length === 2));
  assert.match(exampleEnv, /textfile_collector\/gym_api_monitor\.prom/);
  assert.match(exampleEnv, /^MONITOR_LOG_FILE=\/var\/log\/gym-api\/events\.jsonl$/m);
  assert.doesNotMatch(exampleEnv, /API_CONTAINER|docker\.sock/);
});

test('trusted forwarder is isolated from the unprivileged monitor and refreshes a bounded window', () => {
  assert.match(forwarderTimer, /^OnCalendar=\*:0\/1$/m);
  assert.match(forwarderTimer, /^Unit=gym-api-forwarder\.service$/m);
  assert.match(forwarderService, /^User=root$/m);
  assert.match(forwarderService, /^Group=gym-api-logs$/m);
  assert.match(forwarderService, /^ReadWritePaths=\/var\/log\/gym-api$/m);
  assert.match(forwarderService, /^ProtectSystem=strict$/m);
  assert.match(forwarderService, /^NoNewPrivileges=true$/m);
  assert.match(forwarder, /docker logs --since 10m --timestamps/);
  assert.match(forwarder, /monitoring-docker-forwarder\.mjs" normalize/);
  assert.match(forwarder, /monitoring-docker-forwarder\.mjs"/);
  assert.match(forwarder, /publish --output "\$FORWARD_LOG_FILE"/);
  assert.match(forwarder, /PIPESTATUS\[@\]/);
  assert.match(forwarderEnv, /^FORWARD_CONTAINER=/m);
  assert.match(forwarderEnv, /^FORWARD_LOG_FILE=\/var\/log\/gym-api\/events\.jsonl$/m);

  // The safe monitoring process must never invoke or have access to Docker.
  assert.doesNotMatch(service + runner, /docker logs|SupplementaryGroups=docker|docker\.sock/);
  assert.match(service, /^SupplementaryGroups=gym-api-logs$/m);
  assert.match(runner, /monitoring-log-window\.mjs/);
});

test('production Docker stdout storage is bounded while remaining docker-logs readable', () => {
  const compose = read('compose.prod.yml');
  assert.match(compose, /logging:\s*\n\s+driver: local/);
  assert.match(compose, /max-size: "10m"/);
  assert.match(compose, /max-file: "3"/);
});


test('aggregate severity rules use exported gauges and bounded alert durations', () => {
  for (const [name, metric, severity] of [
    ['GymApiMonitoringCriticalSignal', 'gym_api_monitor_critical_alert', 'critical'],
    ['GymApiMonitoringWarningSignal', 'gym_api_monitor_warning_alert', 'warning'],
  ]) {
    const rule = alerts.match(new RegExp('- alert: ' + name + '([\\s\\S]*?)(?=\\n\\s+- alert:|$)'));
    assert.ok(rule, 'Missing aggregate alert: ' + name);
    assert.match(rule[1], new RegExp('expr: ' + metric + ' == 1'));
    assert.match(rule[1], /for: 2m/);
    assert.match(rule[1], new RegExp('severity: ' + severity));
    assert.doesNotMatch(rule[1], /email|token|password|url:|path:/i);
  }

  const healthy = metricsFromReport(buildReport(emptySummary(), {
    live: { status: 'ok' }, ready: { status: 'ok' },
  }), 1_700_000_000);
  assert.match(healthy, /^gym_api_monitor_critical_alert 0$/m);
  assert.match(healthy, /^gym_api_monitor_warning_alert 0$/m);

  const failed = metricsFromReport(buildReport(emptySummary(), {
    live: { status: 'failed' }, ready: { status: 'ok' },
  }), 1_700_000_000);
  assert.match(failed, /^gym_api_monitor_critical_alert 1$/m);

  const warningSummary = { ...emptySummary(), redisOutages: 1 };
  const warning = metricsFromReport(buildReport(warningSummary, {
    live: { status: 'ok' }, ready: { status: 'ok' },
  }), 1_700_000_000);
  assert.match(warning, /^gym_api_monitor_warning_alert 1$/m);
});

test('trusted Docker resource sampler has an opt-in isolated systemd identity', () => {
  const resourceService = read('ops/monitoring/gym-api-resources.service');
  const resourceTimer = read('ops/monitoring/gym-api-resources.timer');
  const resourceEnv = read('ops/monitoring/resources.env.example');
  const sampler = read('scripts/monitoring-docker-resources.mjs');
  assert.match(resourceTimer, /^OnCalendar=\*:0\/1$/m);
  assert.match(resourceTimer, /^Unit=gym-api-resources\.service$/m);
  assert.match(resourceService, /^Type=oneshot$/m);
  assert.match(resourceService, /^User=root$/m);
  assert.match(resourceService, /^Group=node_exporter$/m);
  assert.match(resourceService, /^ProtectSystem=strict$/m);
  assert.match(resourceService, /^ReadWritePaths=\/var\/lib\/node_exporter\/textfile_collector$/m);
  assert.match(resourceService, /^NoNewPrivileges=true$/m);
  assert.match(resourceService, /^ExecStart=\/usr\/bin\/env node \/opt\/gym-api\/scripts\/monitoring-docker-resources\.mjs$/m);
  assert.match(resourceEnv, /^RESOURCE_CONTAINER=gym-api-api-1$/m);
  assert.match(resourceEnv, /^RESOURCE_TEXTFILE_PATH=\/var\/lib\/node_exporter\/textfile_collector\/gym_api_docker\.prom$/m);
  assert.match(sampler, /'inspect', '--format'/);
  assert.match(sampler, /'stats', '--no-stream'/);
  assert.doesNotMatch(resourceService + resourceTimer, /systemctl enable|systemctl start/);
  // No privileges or Docker socket are added to the old gym-monitor reader.
  assert.doesNotMatch(service + runner, /docker stats|docker inspect|docker\.sock/);
  assert.doesNotMatch(service, /^SupplementaryGroups=docker$/m);
  for (const metric of [
    'gym_api_docker_last_sample_timestamp_seconds',
    'gym_api_docker_running',
    'gym_api_docker_cpu_percent',
    'gym_api_docker_memory_percent',
    'gym_api_docker_pids',
    'gym_api_docker_restart_count',
    'gym_api_docker_oom_killed',
  ]) {
    assert.match(sampler, new RegExp(metric));
    assert.match(alerts, new RegExp(metric));
  }
});

test('Docker events and cgroup signals stay in opt-in trusted host unit', () => {
  const signalsService = read('ops/monitoring/gym-api-signals.service');
  const signalsTimer = read('ops/monitoring/gym-api-signals.timer');
  const signalsEnv = read('ops/monitoring/signals.env.example');
  const signalsScript = read('scripts/monitoring-docker-signals.mjs');
  assert.match(signalsTimer, /^OnCalendar=\*:0\/1$/m);
  assert.match(signalsTimer, /^Unit=gym-api-signals\.service$/m);
  assert.match(signalsService, /^User=root$/m);
  assert.match(signalsService, /^Group=node_exporter$/m);
  assert.match(signalsService, /^NoNewPrivileges=true$/m);
  assert.match(signalsService, /^ProtectSystem=strict$/m);
  assert.match(signalsService, /^ReadWritePaths=\/var\/lib\/node_exporter\/textfile_collector$/m);
  assert.match(signalsService, /^ExecStart=\/usr\/bin\/env node \/opt\/gym-api\/scripts\/monitoring-docker-signals\.mjs$/m);
  assert.match(signalsEnv, /^SIGNALS_CONTAINER=gym-api-api-1$/m);
  assert.match(signalsEnv, /^SIGNALS_TEXTFILE_PATH=\/var\/lib\/node_exporter\/textfile_collector\/gym_api_docker_signals\.prom$/m);
  assert.match(signalsScript, /'events', '--since'/);
  assert.match(signalsScript, /'--filter', 'event=oom'/);
  assert.match(signalsScript, /'\/proc\/' \+ identity\.pid \+ '\/cgroup'/);
  assert.match(signalsScript, /cgroupCpuStatPath/);
  assert.doesNotMatch(service + runner, /docker events|docker inspect|docker stats|docker\.sock/);
  assert.doesNotMatch(signalsService + signalsTimer, /systemctl enable|systemctl start/);
  assert.match(alerts, /GymApiDockerRecentOomEvents/);
  assert.match(alerts, /GymApiDockerCpuThrottling/);
});
