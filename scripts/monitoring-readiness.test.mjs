import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync,
  utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assessReadiness, parseArgs, parseTimestamp, SOURCES } from './monitoring-readiness.mjs';

const NOW = 1_800_000_000;
const script = fileURLToPath(new URL('./monitoring-readiness.mjs', import.meta.url));
const clock = (file, timestamp = NOW) =>
  utimesSync(file, timestamp, timestamp);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gym-monitor-readiness-'));
  const logs = join(root, 'logs');
  const metrics = join(root, 'metrics');
  mkdirSync(logs, { mode: 0o750 });
  mkdirSync(metrics, { mode: 0o750 });
  const logFile = join(logs, 'events.jsonl');
  writeFileSync(logFile, '', { mode: 0o640 });
  clock(logFile);
  for (const source of SOURCES.filter(entry => entry.metric)) {
    const file = join(metrics, source.filename);
    writeFileSync(file, [
      '# TYPE ' + source.metric + ' gauge',
      source.metric + ' ' + NOW,
      '# test-only untrusted field: PRIVATE_TOKEN=never-export-me',
      '',
    ].join('\n'), { mode: 0o640 });
    clock(file);
  }
  return { root, metrics, logFile, clean: () => rmSync(root, { recursive: true, force: true }) };
}

const healthyProbe = async () => true;

test('args accept only fixed absolute locations and hide invalid configuration', () => {
  assert.deepEqual(parseArgs([]), {
    logFile: '/var/log/gym-api/events.jsonl',
    textfileDir: '/var/lib/node_exporter/textfile_collector',
  });
  assert.deepEqual(parseArgs(['--textfile-dir', '/var/lib/collector',
    '--log-file', '/var/log/events.jsonl']), {
    logFile: '/var/log/events.jsonl',
    textfileDir: '/var/lib/collector',
  });
  for (const args of [['--log-file', 'relative/events.jsonl'],
    ['--log-file', '/var/log/secret.txt'],
    ['--textfile-dir', 'relative'], ['--log-file', '/x/events.jsonl',
      '--log-file', '/y/events.jsonl'], ['--unknown', '/tmp'], ['--log-file']]) {
    assert.throws(() => parseArgs(args));
  }
  const cli = spawnSync(process.execPath, [script,
    '--log-file', '/tmp/secret-token.txt'], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(cli.status, 1);
  assert.doesNotMatch(cli.stdout + cli.stderr, /secret-token|tmp/);
});

test('metric parser rejects duplicate, malformed and excessive timestamps', () => {
  assert.equal(parseTimestamp('sample_timestamp_seconds 123\n', 'sample_timestamp_seconds'), 123);
  assert.equal(parseTimestamp('sample_timestamp_seconds 123\nsample_timestamp_seconds 124\n',
    'sample_timestamp_seconds'), null);
  assert.equal(parseTimestamp('sample_timestamp_seconds NaN\n', 'sample_timestamp_seconds'), null);
  assert.equal(parseTimestamp('sample_timestamp_seconds 1.2\n', 'sample_timestamp_seconds'), null);
  assert.equal(parseTimestamp('sample_timestamp_seconds 9e4\n', 'sample_timestamp_seconds'), null);
  assert.equal(parseTimestamp('sample_timestamp_seconds 999999999999999999999999\n',
    'sample_timestamp_seconds'), null);
  assert.equal(parseTimestamp('x'.repeat(65537), 'sample_timestamp_seconds'), null);
});

test('healthy authorized host fixtures satisfy all four collectors', async () => {
  const dir = fixture();
  try {
    const result = await assessReadiness({
      logFile: dir.logFile, textfileDir: dir.metrics, nowSeconds: NOW,
      probe: healthyProbe,
    });
    assert.equal(result.ready, true);
    assert.deepEqual(result.items.map(item => item.component),
      ['forwarder', 'monitor', 'resources', 'signals']);
    assert.ok(result.items.every(item => item.issues.length === 0));
  } finally { dir.clean(); }
});

test('inactive timers, stale files and stale metrics fail closed', async () => {
  const dir = fixture();
  try {
    const resource = join(dir.metrics, 'gym_api_docker.prom');
    const signals = join(dir.metrics, 'gym_api_docker_signals.prom');
    clock(resource, NOW - 190);
    writeFileSync(signals, 'gym_api_docker_signals_last_sample_timestamp_seconds ' +
      (NOW - 190) + '\n', { mode: 0o640 });
    const result = await assessReadiness({
      logFile: dir.logFile, textfileDir: dir.metrics, nowSeconds: NOW,
      probe: async (timer, state) =>
        !(timer === 'gym-api-monitor.timer' && state === 'is-active') &&
        !(timer === 'gym-api-forwarder.timer' && state === 'is-enabled'),
    });
    assert.equal(result.ready, false);
    assert.ok(result.items.find(item => item.component === 'forwarder')
      .issues.includes('TIMER_DISABLED'));
    assert.ok(result.items.find(item => item.component === 'monitor')
      .issues.includes('TIMER_INACTIVE'));
    assert.ok(result.items.find(item => item.component === 'resources')
      .issues.includes('FILE_STALE'));
    assert.ok(result.items.find(item => item.component === 'signals')
      .issues.includes('METRIC_STALE'));
  } finally { dir.clean(); }
});

test('missing files, unsafe modes and symlinks never claim healthy', async () => {
  const dir = fixture();
  try {
    const resource = join(dir.metrics, 'gym_api_docker.prom');
    const signals = join(dir.metrics, 'gym_api_docker_signals.prom');
    rmSync(resource);
    rmSync(signals);
    symlinkSync('/tmp/private-token-file', signals);
    chmodSync(dir.logFile, 0o666);
    const result = await assessReadiness({
      logFile: dir.logFile, textfileDir: dir.metrics, nowSeconds: NOW,
      probe: healthyProbe,
    });
    assert.equal(result.ready, false);
    assert.ok(result.items.find(item => item.component === 'forwarder')
      .issues.includes('FILE_UNSAFE'));
    assert.ok(result.items.find(item => item.component === 'resources')
      .issues.includes('SOURCE_UNAVAILABLE'));
    assert.ok(result.items.find(item => item.component === 'signals')
      .issues.includes('FILE_UNSAFE'));
    assert.doesNotMatch(JSON.stringify(result), /private-token-file|tmp|logs|metrics/);
  } finally { dir.clean(); }
});

test('clock skew, malformed metrics and systemd probe exceptions expose only safe codes', async () => {
  const dir = fixture();
  try {
    const monitor = join(dir.metrics, 'gym_api_monitor.prom');
    writeFileSync(monitor, 'gym_api_monitor_last_run_timestamp_seconds 9999999999999\n');
    clock(monitor);
    clock(dir.logFile, NOW + 120);
    const result = await assessReadiness({
      logFile: dir.logFile, textfileDir: dir.metrics, nowSeconds: NOW,
      probe: async () => { throw new Error('private client password'); },
    });
    assert.equal(result.ready, false);
    assert.ok(result.items.every(item => item.issues.includes('TIMER_INACTIVE')));
    assert.ok(result.items.find(item => item.component === 'monitor')
      .issues.includes('METRIC_CLOCK_SKEW'));
    assert.ok(result.items.find(item => item.component === 'forwarder')
      .issues.includes('FILE_CLOCK_SKEW'));
    assert.doesNotMatch(JSON.stringify(result), /password|private|client/);
  } finally { dir.clean(); }
});
