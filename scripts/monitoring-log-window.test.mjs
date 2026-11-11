import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, symlinkSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  MAX_FILE_BYTES,
  WINDOW_MS,
  filterLogFile,
  parseLogFileArg,
  selectWindowLine,
} from './monitoring-log-window.mjs';

const fixedNow = Date.parse('2026-11-11T07:00:00.000Z');
function record(at, extra = {}) {
  return JSON.stringify({
    timestamp: new Date(at).toISOString(),
    event: 'http.request.completed',
    statusCode: 429,
    email: 'private@example.test',
    token: 'sensitive-token',
    ...extra,
  });
}
function makeFixture() {
  return mkdtempSync(join(tmpdir(), 'gym-monitor-source-'));
}

test('strictly selects last five minutes and emits only approved event fields', () => {
  const inWindow = selectWindowLine(record(fixedNow - 5000), fixedNow);
  assert.deepEqual(JSON.parse(inWindow), {
    event: 'http.request.completed', statusCode: 429,
  });
  for (const sensitive of ['private@example.test', 'sensitive-token', 'timestamp']) {
    assert.equal(inWindow.includes(sensitive), false);
  }
  assert.equal(selectWindowLine(record(fixedNow - WINDOW_MS - 1), fixedNow), null);
  assert.equal(selectWindowLine(record(fixedNow + 1000), fixedNow), null);
  assert.deepEqual(JSON.parse(selectWindowLine(JSON.stringify({
    time: new Date(fixedNow).toISOString(),
    message: { event: 'RATE_LIMIT_REDIS_UNAVAILABLE', redisUrl: 'redis://secret' },
  }), fixedNow)), { event: 'RATE_LIMIT_REDIS_UNAVAILABLE' });
  assert.equal(selectWindowLine(JSON.stringify({
    timestamp: new Date(fixedNow).toISOString(),
    event: 'unknown.event', credentials: 'private',
  }), fixedNow), null);
});

test('rejects malformed, unbounded and clock-skewed records without exposing input', () => {
  const invalid = [
    '{ not json', '', '[]', 'null', '{}',
    JSON.stringify({ event: 'http.request.completed', statusCode: 200 }),
    JSON.stringify({ timestamp: 'invalid', event: 'http.request.completed' }),
    record(fixedNow + 10000),
    'x'.repeat(65537),
  ];
  for (const item of invalid) {
    assert.throws(() => selectWindowLine(item, fixedNow), {
      message: /^(Invalid log entry|Missing ISO timestamp|Invalid timestamp|Clock-skewed log entry)$/,
    });
  }
  assert.throws(() => parseLogFileArg(['--file', 'relative.jsonl']));
  assert.throws(() => parseLogFileArg(['--file', '/tmp/source.txt']));
  assert.throws(() => parseLogFileArg(['--file', '/tmp/secret.jsonl', '--extra']));
});

test('reads regular group-readable log file and rejects world access, symlinks and large files', async () => {
  const dir = makeFixture();
  try {
    const source = join(dir, 'events.jsonl');
    const payload = [
      record(fixedNow - WINDOW_MS - 10),
      record(fixedNow - 1000),
      JSON.stringify({
        timestamp: new Date(fixedNow - 1000).toISOString(),
        event: 'RATE_LIMIT_REDIS_RECOVERED', value: 'private',
      }),
    ].join('\n') + '\n';
    writeFileSync(source, payload);
    chmodSync(source, 0o640);

    const output = [];
    await filterLogFile(source, (line) => output.push(line), fixedNow);
    assert.deepEqual(output.map((line) => JSON.parse(line)), [
      { event: 'http.request.completed', statusCode: 429 },
      { event: 'RATE_LIMIT_REDIS_RECOVERED' },
    ]);

    chmodSync(source, 0o666);
    await assert.rejects(filterLogFile(source, () => undefined, fixedNow));
    chmodSync(source, 0o640);

    const symlink = join(dir, 'linked.jsonl');
    symlinkSync(source, symlink);
    await assert.rejects(filterLogFile(symlink, () => undefined, fixedNow));

    const huge = join(dir, 'huge.jsonl');
    writeFileSync(huge, '');
    truncateSync(huge, MAX_FILE_BYTES + 1);
    chmodSync(huge, 0o640);
    await assert.rejects(filterLogFile(huge, () => undefined, fixedNow));

    await assert.rejects(filterLogFile(join(dir, 'missing.jsonl'), () => undefined, fixedNow));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed line after valid records makes the entire source fail', async () => {
  const dir = makeFixture();
  try {
    const source = join(dir, 'events.jsonl');
    writeFileSync(source, record(fixedNow) + '\n' + '{ "truncated":');
    chmodSync(source, 0o640);
    const emitted = [];
    await assert.rejects(filterLogFile(source, (line) => emitted.push(line), fixedNow));
    assert.equal(emitted.length, 1);
    // The caller must refuse to publish the partial upstream result.
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
