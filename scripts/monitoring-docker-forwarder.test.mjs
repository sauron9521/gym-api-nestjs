import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  normalizeDockerLogLine,
  publishSnapshot,
  validateSnapshot,
  MAX_SNAPSHOT_BYTES,
} from './monitoring-docker-forwarder.mjs';

const script = fileURLToPath(new URL('./monitoring-forward.sh', import.meta.url));
const cli = fileURLToPath(new URL('./monitoring-docker-forwarder.mjs', import.meta.url));

function dockerStamp(date = new Date()) {
  return date.toISOString().replace('Z', '000000Z');
}
function dockerLine(message, date = new Date()) {
  return dockerStamp(date) + ' ' + JSON.stringify(message);
}
function sampleLine(date = new Date()) {
  return dockerLine({
    level: 'log',
    message: 'HTTP request completed',
    context: {
      event: 'http.request.completed',
      statusCode: 429,
      email: 'private@example.test',
      token: 'private-token',
    },
  }, date);
}
function makeDir() {
  return mkdtempSync(join(tmpdir(), 'gym-log-forwarder-'));
}

test('normalizes Docker RFC3339Nano Nest logs and removes private metadata', () => {
  const accepted = normalizeDockerLogLine(sampleLine(
    new Date('2026-11-11T06:30:00.123Z')));
  assert.deepEqual(JSON.parse(accepted), {
    timestamp: '2026-11-11T06:30:00.123Z',
    event: 'http.request.completed',
    statusCode: 429,
  });
  for (const secret of ['private@example.test', 'private-token', 'context', 'message']) {
    assert.equal(accepted.includes(secret), false);
  }

  const redis = normalizeDockerLogLine(dockerLine({
    message: { event: 'RATE_LIMIT_REDIS_UNAVAILABLE', redisUrl: 'redis://secret' },
  }));
  assert.deepEqual(JSON.parse(redis).event, 'RATE_LIMIT_REDIS_UNAVAILABLE');
  assert.equal(redis.includes('redis://secret'), false);
  assert.equal(normalizeDockerLogLine(dockerStamp() + ' plain startup line'), null);
  assert.equal(normalizeDockerLogLine(dockerLine({ event: 'other.event' })), null);
});

test('rejects corrupt Docker log timestamps and malformed structured records', () => {
  for (const value of [
    'missing-timestamp text',
    '2026-99-11T06:30:00Z {}',
    '2026-11-11T06:30:00.123Z {"event":',
    'x'.repeat(65537),
  ]) assert.throws(() => normalizeDockerLogLine(value));
});

test('snapshot output contains only a complete, fixed-schema event stream', () => {
  const line = normalizeDockerLogLine(sampleLine());
  validateSnapshot(line + '\n');
  validateSnapshot('');
  assert.throws(() => validateSnapshot(line)); // incomplete trailing line
  assert.throws(() => validateSnapshot(line + '\n{"private":"secret"}\n'));
  assert.throws(() => validateSnapshot(JSON.stringify({
    ...JSON.parse(line), ip: '192.0.2.10',
  }) + '\n'));
  assert.throws(() => validateSnapshot('a'.repeat(MAX_SNAPSHOT_BYTES + 1)));
});

test('atomically rotates restricted JSONL and preserves snapshot on unsafe targets', async () => {
  const dir = makeDir();
  try {
    const file = join(dir, 'events.jsonl');
    const original = normalizeDockerLogLine(sampleLine()) + '\n';
    await publishSnapshot(file, original);
    assert.equal(readFileSync(file, 'utf8'), original);
    assert.equal(lstatSync(file).mode & 0o777, 0o640);
    const renewed = normalizeDockerLogLine(dockerLine({
      event: 'RATE_LIMIT_REDIS_RECOVERED',
    })) + '\n';
    await publishSnapshot(file, renewed);
    assert.equal(readFileSync(file, 'utf8'), renewed);
    const badDirectory = join(dir, 'missing', 'events.jsonl');
    await assert.rejects(publishSnapshot(badDirectory, original));
    assert.equal(readFileSync(file, 'utf8'), renewed);

    const link = join(dir, 'events-link.jsonl');
    symlinkSync(file, link);
    // Output basename is fixed to prevent arbitrary file overwrites.
    await assert.rejects(publishSnapshot(link, original));
    assert.equal(readFileSync(file, 'utf8'), renewed);

    chmodSync(dir, 0o777);
    await assert.rejects(publishSnapshot(file, original));
    assert.equal(readFileSync(file, 'utf8'), renewed);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('end-to-end forwarder script converts fake Docker logs without leaking raw records', () => {
  const dir = makeDir();
  try {
    const mockDocker = join(dir, 'docker');
    const snapshot = join(dir, 'events.jsonl');
    const events = [
      sampleLine(),
      dockerStamp() + ' INFO booted application',
    ];
    const stderrEvent = dockerLine({
      message: { event: 'RATE_LIMIT_REDIS_RECOVERED',
        secret: 'this-should-never-appear' },
    });
    // Fake Docker stdout; never touches the actual Docker daemon.
    writeFileSync(mockDocker, '#!/bin/sh\n' +
      'test "$1" = "logs" || exit 9\n' +
      'cat <<\'END_DOCKER_LOGS\'\n' + events.join('\n') +
      '\nEND_DOCKER_LOGS\n' +
      "cat <<'END_DOCKER_WARNINGS' >&2\n" + stderrEvent +
      '\nEND_DOCKER_WARNINGS\n');
    chmodSync(mockDocker, 0o755);
    const env = {
      ...process.env,
      PATH: dir + ':' + process.env.PATH,
      FORWARD_CONTAINER: 'gym-api-api-1',
      FORWARD_LOG_FILE: snapshot,
    };
    const ok = spawnSync('bash', [script], {
      encoding: 'utf8', timeout: 15000, env,
    });
    assert.equal(ok.status, 0, ok.stderr);
    const safe = readFileSync(snapshot, 'utf8');
    assert.equal(safe.trim().split('\n').length, 2);
    assert.equal(safe.includes('private@example.test'), false);
    assert.equal(safe.includes('private-token'), false);
    assert.equal(safe.includes('this-should-never-appear'), false);
    assert.equal(lstatSync(snapshot).mode & 0o777, 0o640);

    // A Docker failure with partial stdout must not publish partial metrics.
    writeFileSync(mockDocker, '#!/bin/sh\n' +
      'echo ' + JSON.stringify(sampleLine()) + '\nexit 17\n');
    chmodSync(mockDocker, 0o755);
    const failed = spawnSync('bash', [script], {
      encoding: 'utf8', timeout: 15000, env,
    });
    assert.equal(failed.status, 1);
    assert.equal(readFileSync(snapshot, 'utf8'), safe);

    // A malformed structured event also fails closed and keeps old snapshot.
    writeFileSync(mockDocker, '#!/bin/sh\n' +
      'printf "%s\\n" ' + JSON.stringify(dockerStamp() + ' {"bad":') + '\n');
    chmodSync(mockDocker, 0o755);
    const corrupt = spawnSync('bash', [script], {
      encoding: 'utf8', timeout: 15000, env,
    });
    assert.equal(corrupt.status, 1);
    assert.equal(readFileSync(snapshot, 'utf8'), safe);
    assert.equal(corrupt.stderr.includes('private-token'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizer CLI emits only safe JSONL without exposing raw Docker errors', () => {
  const input = sampleLine() + '\n' + dockerStamp() + ' plain debug\n';
  const result = spawnSync(process.execPath, [cli, 'normalize'], {
    input, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim().split('\n').length, 1);
  assert.equal(result.stdout.includes('private@example.test'), false);
  assert.equal(result.stderr, '');
});
