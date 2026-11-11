import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cgroupCpuStatPath, collectSignals, metricsFromSignals,
  parseCpuStat, parseIdentity, parseOomEvents, publishSignals,
} from './monitoring-docker-signals.mjs';

const id = 'a'.repeat(64);
const now = 1_700_001_000;
const since = now - 600;
const event = (time = now - 10) => JSON.stringify({
  Type: 'container', Action: 'oom', Actor: {
    ID: id, Attributes: { private: 'ACCESS-TOKEN', name: 'private.example' },
  }, time, timeNano: 1700000990000000000,
});
const cpuStat = [
  'usage_usec 5000000', 'user_usec 3000000', 'system_usec 2000000',
  'nr_periods 100', 'nr_throttled 25', 'throttled_usec 500000',
].join('\n') + '\n';

test('strictly validate Docker identity, cgroup mapping and actual CPU counters', () => {
  assert.deepEqual(parseIdentity(id + ' 110 true\n'), { id, pid: 110, running: true });
  assert.deepEqual(parseIdentity(id + ' 0 false\n'), { id, pid: 0, running: false });
  for (const value of [
    'token 110 true', id + ' 0 true', id + ' 110 false', id + ' -1 true',
    id + ' 10 what', '',
  ]) assert.throws(() => parseIdentity(value));
  assert.equal(cgroupCpuStatPath('0::/system.slice/docker-' + id + '.scope\n'),
    '/sys/fs/cgroup/system.slice/docker-' + id + '.scope/cpu.stat');
  for (const value of ['', '4:cpu:/parent', '0::/../../etc', '0::/valid\n0::/other',
    '0::/bad path', '0::/x/./z']) {
    assert.throws(() => cgroupCpuStatPath(value));
  }
  assert.deepEqual(parseCpuStat(cpuStat), {
    periods: 100, throttledPeriods: 25, throttledSeconds: 0.5,
  });
  for (const value of [
    'nr_periods 0\nnr_throttled 1\nthrottled_usec 0',
    'nr_periods 10\nnr_throttled 2',
    'nr_periods nope\nnr_throttled 0\nthrottled_usec 0',
    'nr_periods 1\nnr_periods 2\nnr_throttled 0\nthrottled_usec 0',
  ]) assert.throws(() => parseCpuStat(value));
});

test('bounded Docker OOM events include historical records without leaking metadata', () => {
  assert.equal(parseOomEvents('', id, since, now), 0);
  assert.equal(parseOomEvents(event() + '\n' + event(now - 20) + '\n',
    id, since, now), 2);
  for (const value of [
    'not JSON', event().replace('"oom"', '"die"'),
    event().replace(id, 'b'.repeat(64)), event(now - 601),
    event(now + 1), event() + '\n' + 'x'.repeat(16 * 1024),
  ]) assert.throws(() => parseOomEvents(value, id, since, now));
});

test('Docker CLI commands stay fixed and export only numeric aggregates', async () => {
  const calls = [];
  const reads = [];
  const sample = await collectSignals('gym-api-api-1', now,
    async (args) => {
      calls.push(args);
      return args[0] === 'inspect'
        ? id + ' 55 true\n'
        : event(now - 50) + '\n';
    },
    async path => {
      reads.push(path);
      return path === '/proc/55/cgroup' ? '0::/docker/' + id : cpuStat;
    });
  assert.deepEqual(calls, [
    ['inspect', '--format', '{{.Id}} {{.State.Pid}} {{.State.Running}}', 'gym-api-api-1'],
    ['events', '--since', String(since), '--until', String(now),
      '--filter', 'container=' + id, '--filter', 'event=oom',
      '--format', '{{json .}}'],
  ]);
  assert.deepEqual(reads, ['/proc/55/cgroup',
    '/sys/fs/cgroup/docker/' + id + '/cpu.stat']);
  assert.deepEqual(sample, {
    running: true, oomEvents: 1,
    cpu: { periods: 100, throttledPeriods: 25, throttledSeconds: 0.5 },
  });
  const metrics = metricsFromSignals(sample, now);
  for (const expected of [
    'gym_api_docker_signals_running 1',
    'gym_api_docker_oom_events_window_10m 1',
    'gym_api_docker_cpu_periods_total 100',
    'gym_api_docker_cpu_throttled_periods_total 25',
    'gym_api_docker_cpu_throttled_seconds_total 0.5',
  ]) assert.ok(metrics.includes('\n' + expected + '\n'));
  assert.doesNotMatch(metrics, /ACCESS-TOKEN|private.example|docker\/|[{}]/);
  await assert.rejects(collectSignals('--all', now, async () => ''));
});

test('stopped container has event history but no fake zero CPU counters', async () => {
  const sample = await collectSignals('gym-api-api-1', now,
    async args => args[0] === 'inspect' ? id + ' 0 false\n' : event() + '\n',
    async () => { throw new Error('Should not read stopped cgroup'); });
  assert.deepEqual(sample, { running: false, oomEvents: 1, cpu: null });
  const metrics = metricsFromSignals(sample, now);
  assert.match(metrics, /^gym_api_docker_signals_running 0$/m);
  assert.match(metrics, /^gym_api_docker_oom_events_window_10m 1$/m);
  assert.doesNotMatch(metrics, /gym_api_docker_cpu_periods_total/);
  assert.throws(() => metricsFromSignals({ ...sample, running: true }));
});

test('Docker and cgroup failure never publishes fabricated samples', async () => {
  await assert.rejects(collectSignals('api', now, async () => {
    throw new Error('potentially private Docker text');
  }));
  await assert.rejects(collectSignals('api', now,
    async args => args[0] === 'inspect' ? id + ' 55 true\n' : '',
    async () => { throw new Error('cgroup v1 unsupported'); }));
});

test('atomic metrics file survives unsafe destination or publication failures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-docker-signals-'));
  const output = join(dir, 'gym_api_docker_signals.prom');
  try {
    const good = metricsFromSignals({ running: false, oomEvents: 0, cpu: null }, now);
    await publishSignals(output, good);
    assert.equal(readFileSync(output, 'utf8'), good);
    assert.equal(lstatSync(output).mode & 0o777, 0o640);
    await assert.rejects(publishSignals(join(dir, 'wrong.prom'), 'bad'));
    assert.equal(readFileSync(output, 'utf8'), good);
    const link = join(dir, 'child');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(link);
    symlinkSync(output, join(link, 'gym_api_docker_signals.prom'));
    await assert.rejects(publishSignals(join(link, 'gym_api_docker_signals.prom'), good));
    chmodSync(dir, 0o777);
    await assert.rejects(publishSignals(output, 'bad'));
    assert.equal(readFileSync(output, 'utf8'), good);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
