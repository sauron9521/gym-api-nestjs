import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectSample, metricsFromSample, parseInspect, parseStats, publishMetrics,
} from './monitoring-docker-resources.mjs';

const fixture = JSON.stringify({
  Name: 'private-container', CPUPerc: '122.50%',
  MemPerc: '91.25%', PIDs: '12', Env: 'PRIVATE-TOKEN',
}) + '\n';

test('parses only fixed numeric Docker inspect and stats fields', () => {
  assert.deepEqual(parseInspect('3 false true\n'), {
    restartCount: 3, oomKilled: false, running: true,
  });
  assert.deepEqual(parseStats(fixture), {
    cpuPercent: 122.5, memoryPercent: 91.25, pids: 12,
  });
  for (const broken of ['NaN false true', '-2 false true', '0 x true', '0 true', '']) {
    assert.throws(() => parseInspect(broken));
  }
  for (const broken of [
    '{}', 'not JSON', fixture + fixture,
    '{"CPUPerc":"NaN%","MemPerc":"10%","PIDs":"1"}',
    '{"CPUPerc":"10%","MemPerc":"101%","PIDs":"1"}',
    '{"CPUPerc":"10%","MemPerc":"10%","PIDs":"1;rm"}',
  ]) assert.throws(() => parseStats(broken));
});

test('collector requests Docker numeric format only and never full inspect', async () => {
  const commands = [];
  const sample = await collectSample('gym-api-api-1', async (args) => {
    commands.push(args);
    if (args[0] === 'inspect') return '4 false true\n';
    if (args[0] === 'stats') return fixture;
    throw new Error('unexpected Docker call');
  });
  assert.deepEqual(commands, [
    ['inspect', '--format',
      '{{.RestartCount}} {{.State.OOMKilled}} {{.State.Running}}', 'gym-api-api-1'],
    ['stats', '--no-stream', '--format', '{{json .}}', 'gym-api-api-1'],
  ]);
  assert.equal(sample.restartCount, 4);
  const metrics = metricsFromSample(sample, 1_700_000_000);
  assert.match(metrics, /^gym_api_docker_memory_percent 91.25$/m);
  assert.match(metrics, /^gym_api_docker_cpu_percent 122.5$/m);
  assert.match(metrics, /^gym_api_docker_restart_count 4$/m);
  assert.match(metrics, /^gym_api_docker_pids 12$/m);
  assert.doesNotMatch(metrics, /PRIVATE-TOKEN|private-container|\{.*\}/);
  await assert.rejects(collectSample('--all'), /Invalid container/);
});

test('stopped or OOM-killed container yields unknown usage, not false zeros', async () => {
  const commands = [];
  const sample = await collectSample('gym-api-api-1', async (args) => {
    commands.push(args);
    return '5 true false\n';
  });
  assert.equal(commands.length, 1);
  assert.equal(sample.cpuPercent, -1);
  assert.equal(sample.memoryPercent, -1);
  const metrics = metricsFromSample(sample, 1_700_000_000);
  assert.match(metrics, /^gym_api_docker_running 0$/m);
  assert.match(metrics, /^gym_api_docker_oom_killed 1$/m);
  assert.match(metrics, /^gym_api_docker_memory_percent -1$/m);
  assert.throws(() => metricsFromSample({ ...sample, memoryPercent: 0 }));
  await assert.rejects(collectSample('gym-api-api-1', async () => {
    throw new Error('Docker unavailable with private secret');
  }));
});

test('atomic 0640 metric publication protects prior snapshot and rejects unsafe paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gym-resources-'));
  const output = join(root, 'gym_api_docker.prom');
  try {
    const good = metricsFromSample({
      restartCount: 0, oomKilled: false, running: true,
      cpuPercent: 10, memoryPercent: 20, pids: 2,
    }, 1_700_000_000);
    await publishMetrics(output, good);
    assert.equal(readFileSync(output, 'utf8'), good);
    assert.equal(lstatSync(output).mode & 0o777, 0o640);
    await assert.rejects(publishMetrics(join(root, 'bad.prom'), good));
    assert.equal(readFileSync(output, 'utf8'), good);

    const replacement = metricsFromSample({
      restartCount: 1, oomKilled: false, running: true,
      cpuPercent: 0, memoryPercent: 11, pids: 1,
    }, 1_700_000_060);
    await publishMetrics(output, replacement);
    assert.equal(readFileSync(output, 'utf8'), replacement);

    const unsafe = join(root, 'nested');
    const { mkdirSync, renameSync } = await import('node:fs');
    mkdirSync(unsafe);
    symlinkSync(output, join(unsafe, 'gym_api_docker.prom'));
    await assert.rejects(publishMetrics(join(unsafe, 'gym_api_docker.prom'), good));
    assert.equal(readFileSync(output, 'utf8'), replacement);

    chmodSync(root, 0o777);
    await assert.rejects(publishMetrics(output, good));
    assert.equal(readFileSync(output, 'utf8'), replacement);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
