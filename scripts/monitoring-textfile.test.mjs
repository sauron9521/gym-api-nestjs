import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { buildReport, emptySummary } from './monitoring-report.mjs';
import {
  metricsFromReport,
  parseOutputArg,
  writeMetricsFile,
} from './monitoring-textfile.mjs';

const cli = fileURLToPath(new URL('./monitoring-textfile.mjs', import.meta.url));
const collect = fileURLToPath(new URL('./monitoring-collect.sh', import.meta.url));

function fixture() {
  const summary = emptySummary();
  summary.httpRequests = 20;
  summary.http429 = 4;
  summary.http503 = 1;
  summary.redisOutages = 1;
  summary.redisRecoveries = 1;
  const report = buildReport(summary, {
    live: { status: 'ok', httpStatus: 200 },
    ready: { status: 'failed', httpStatus: 503 },
  });
  return report;
}

test('converts a validated report to label-free, timestamp-free Prometheus gauges', () => {
  const report = fixture();
  report.email = 'sensitive@example.test';
  report.redisUrl = 'redis://private-password@internal';
  const output = metricsFromReport(report, 1_800_000_000);
  assert.match(output, /gym_api_monitor_last_run_timestamp_seconds 1800000000/);
  assert.match(output, /gym_api_monitor_http_requests_window_5m 20/);
  assert.match(output, /gym_api_monitor_http_429_window_5m 4/);
  assert.match(output, /gym_api_monitor_http_503_window_5m 1/);
  assert.match(output, /gym_api_monitor_ready_probe_success 0/);
  assert.match(output, /gym_api_monitor_critical_alert 1/);
  assert.match(output, /gym_api_monitor_warning_alert 1/);
  assert.doesNotMatch(output, /sensitive@example.test|private-password|redis:\/\//);
  assert.doesNotMatch(output, /\{[^\n]*=/);
  assert.ok(output.split('\n').filter((line) => /^gym_api_monitor_/.test(line))
    .every((line) => /^gym_api_monitor_[a-z0-9_]+ -?\d+$/.test(line)));
});

test('unknown probe is minus one, distinct from healthy 1 and failed 0', () => {
  const text = metricsFromReport(buildReport(emptySummary()), 100);
  assert.match(text, /gym_api_monitor_live_probe_success -1/);
  assert.match(text, /gym_api_monitor_ready_probe_success -1/);
  assert.match(text, /gym_api_monitor_http_requests_window_5m 0/);
});

test('rejects malformed counters and unauthenticated destinations without echoing data', () => {
  const bad = fixture();
  bad.counters.httpRequests = 0;
  assert.throws(() => metricsFromReport(bad), /Invalid report/);
  bad.counters.httpRequests = 20;
  bad.counters.http503 = 21;
  assert.throws(() => metricsFromReport(bad));
  assert.throws(() => parseOutputArg(['--output', 'relative.prom']));
  assert.throws(() => parseOutputArg(['--output', '/tmp/metrics.txt']));
  assert.throws(() => parseOutputArg(['--bad', '/tmp/metrics.prom']));
});

test('publishes atomically with restrictive permissions and preserves old report on failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-monitor-metrics-'));
  try {
    const target = join(dir, 'gym_api_monitor.prom');
    await writeMetricsFile(target, metricsFromReport(fixture(), 123));
    assert.match(readFileSync(target, 'utf8'),
      /gym_api_monitor_last_run_timestamp_seconds 123/);
    assert.equal(statSync(target).mode & 0o777, 0o640);
    const first = readFileSync(target, 'utf8');
    await assert.rejects(writeMetricsFile(join(dir, 'missing', 'monitor.prom'), 'bad'));
    assert.equal(readFileSync(target, 'utf8'), first);
    await writeMetricsFile(target, metricsFromReport(fixture(), 124));
    assert.match(readFileSync(target, 'utf8'), /last_run_timestamp_seconds 124/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI accepts sanitized report, ignores extra secret fields, and rejects malformed JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-monitor-cli-'));
  try {
    const dest = join(dir, 'report.prom');
    const data = fixture();
    data.secret = 'recovery@example.test';
    const ok = spawnSync(process.execPath, [cli, '--output', dest], {
      input: JSON.stringify(data), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, '');
    assert.equal(readFileSync(dest, 'utf8').includes(data.secret), false);

    const failed = spawnSync(process.execPath, [cli, '--output', dest], {
      input: '{ "secret": "tok@unsafe" ', encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(failed.status, 1);
    assert.equal(failed.stderr.includes('tok@unsafe'), false);
    assert.equal(readFileSync(dest, 'utf8').includes('last_run_timestamp'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('five-minute collection publishes real gauges even on critical health probe status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-monitor-runner-'));
  try {
    const bin = join(dir, 'docker');
    const dest = join(dir, 'metric.prom');
    writeFileSync(bin,
      '#!/bin/sh\n' +
      'test "$1" = logs || exit 9\n' +
      'i=0\nwhile [ "$i" -lt 20 ]; do\n' +
      '  printf \'{"event":"http.request.completed","statusCode":429,"secret":"private@example.test"}\\n\'\n' +
      '  i=$((i + 1))\ndone\n');
    chmodSync(bin, 0o755);

    const run = spawnSync('bash', [collect], {
      encoding: 'utf8', timeout: 20_000,
      env: {
        ...process.env,
        PATH: dir + ':' + process.env.PATH,
        API_CONTAINER: 'gym-api-test',
        MONITOR_API_ORIGIN: 'http://127.0.0.1:1',
        MONITOR_TEXTFILE_PATH: dest,
      },
    });
    assert.equal(run.status, 2, run.stderr);
    assert.equal(run.stdout, '');
    const output = readFileSync(dest, 'utf8');
    assert.match(output, /gym_api_monitor_http_429_window_5m 20/);
    assert.match(output, /gym_api_monitor_critical_alert 1/);
    assert.match(output, /gym_api_monitor_live_probe_success 0/);
    assert.equal(output.includes('private@example.test'), false);

    // A failed Docker log command must leave the last good file untouched.
    writeFileSync(bin, '#!/bin/sh\nexit 17\n');
    chmodSync(bin, 0o755);
    const rejected = spawnSync('bash', [collect], {
      encoding: 'utf8', timeout: 20_000,
      env: {
        ...process.env,
        PATH: dir + ':' + process.env.PATH,
        API_CONTAINER: 'gym-api-test',
        MONITOR_API_ORIGIN: 'http://127.0.0.1:1',
        MONITOR_TEXTFILE_PATH: dest,
      },
    });
    assert.equal(rejected.status, 1);
    assert.equal(readFileSync(dest, 'utf8'), output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
