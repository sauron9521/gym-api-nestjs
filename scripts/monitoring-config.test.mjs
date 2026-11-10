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
  assert.match(service, /^UMask=0027$/m);
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.match(service, /^ProtectSystem=strict$/m);
  assert.doesNotMatch(service, /ExecStartPost=|ExecStartPre=.*curl|\/bin\/sh -c/);
  assert.doesNotMatch(service + timer, /systemctl enable|systemctl start/);
});

test('runner rejects unsafe container identifiers and preserves previous metrics after source errors', () => {
  assert.match(runner, /\^\[a-zA-Z0-9\]/);
  assert.match(runner, /docker logs --since 5m -- "\$API_CONTAINER"/);
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
    'API_CONTAINER',
    'MONITOR_API_ORIGIN',
    'MONITOR_TEXTFILE_PATH',
  ]);
  assert.doesNotMatch(entries.join('\n'), /bearer|password|jwt|token|secret|api_key/i);
  assert.ok(entries.every((line) => line.split('=', 2).length === 2));
  assert.match(exampleEnv, /textfile_collector\/gym_api_monitor\.prom/);
});
