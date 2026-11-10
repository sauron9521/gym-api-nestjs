import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  addLogLine,
  buildReport,
  emptySummary,
  parseArgs,
  probeHealth,
} from './monitoring-report.mjs';

const script = fileURLToPath(new URL('./monitoring-report.mjs', import.meta.url));

function http(statusCode, extra = {}) {
  return JSON.stringify({
    event: 'http.request.completed',
    statusCode,
    ...extra,
  });
}

test('aggregates known HTTP and Redis event counters from flattened and nested JSON logs', () => {
  const stats = emptySummary();
  const lines = [
    http(200),
    http(429, { email: 'private@example.test', token: 'secret-token' }),
    JSON.stringify({ message: 'HTTP request completed',
      context: { event: 'http.request.completed', statusCode: 503, route: '/ready' } }),
    JSON.stringify({ message: { event: 'RATE_LIMIT_REDIS_UNAVAILABLE' } }),
    JSON.stringify({ metadata: { event: 'RATE_LIMIT_REDIS_RECOVERED' } }),
    JSON.stringify({ event: 'RATE_LIMIT_REDIS_UNAVAILABLE' }),
    'invalid { json',
    JSON.stringify({ event: 'http.request.completed', statusCode: '429' }),
    JSON.stringify({ event: 'http.request.completed', statusCode: 999 }),
    JSON.stringify({ event: 'login.password', password: 'secret-password' }),
    'x'.repeat(65_000),
  ];
  for (const line of lines) addLogLine(stats, line);
  const report = buildReport(stats);
  assert.deepEqual(report.counters, {
    httpRequests: 3,
    http429: 1,
    http503: 1,
    redisOutages: 2,
    redisRecoveries: 1,
    ignoredLines: 5,
  });
  assert.equal(report.probes.live.status, 'not_checked');
  assert.equal(report.ratios.http429Percent, 33.33);
  assert.equal(report.ratios.http503Percent, 33.33);
  const output = JSON.stringify(report);
  for (const secret of ['private@example.test', 'secret-token', 'secret-password', '/ready']) {
    assert.equal(output.includes(secret), false);
  }
});

test('does not classify an empty or small sample as a reliable traffic-rate alert', () => {
  const empty = buildReport(emptySummary());
  assert.equal(empty.ratios.http429Percent, null);
  assert.equal(empty.ratios.http503Percent, null);
  assert.deepEqual(empty.alerts, []);

  const sample = emptySummary();
  addLogLine(sample, http(429));
  addLogLine(sample, http(503));
  assert.deepEqual(buildReport(sample).alerts, []);
});

test('emits low-cardinality alerts for meaningful 429 and 503 rates', () => {
  const stats = emptySummary();
  for (let i = 0; i < 20; i++) {
    addLogLine(stats, http(i < 4 ? 429 : i === 4 ? 503 : 200));
  }
  addLogLine(stats, JSON.stringify({ event: 'RATE_LIMIT_REDIS_UNAVAILABLE' }));
  const report = buildReport(stats);
  assert.deepEqual(report.alerts, [
    { severity: 'warning', code: 'HIGH_HTTP_429_RATE' },
    { severity: 'critical', code: 'HIGH_HTTP_503_RATE' },
    { severity: 'warning', code: 'REDIS_OUTAGE_OBSERVED' },
  ]);
});

test('active probes use only public health URLs and never follow redirects', async () => {
  const calls = [];
  const result = await probeHealth('https://api.example.test', async (url, options) => {
    calls.push({ path: url.pathname, options });
    return { status: url.pathname === '/health/live' ? 200 : 503 };
  });
  assert.deepEqual(result, {
    live: { status: 'ok', httpStatus: 200 },
    ready: { status: 'failed', httpStatus: 503 },
  });
  assert.deepEqual(calls.map(({ path }) => path).sort(), ['/health/live', '/health/ready']);
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'manual');
  }
  assert.deepEqual(buildReport(emptySummary(), result).alerts, [
    { severity: 'critical', code: 'READINESS_PROBE_FAILED' },
  ]);
});

test('probe network errors are reported without exposing target or exception text', async () => {
  const result = await probeHealth('https://api.example.test', async () => {
    throw new Error('secret-key redis://:secret@internal-host');
  });
  assert.equal(result.live.httpStatus, null);
  assert.equal(result.ready.status, 'failed');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('rejects credential-bearing and non-origin targets without logging the target', async () => {
  const rejected = [
    'https://user:password@api.example.test',
    'https://api.example.test/private?token=secret',
    'file:///etc/hosts',
    'https://api.example.test/health/live',
  ];
  for (const url of rejected) {
    await assert.rejects(probeHealth(url, async () => ({ status: 200 })));
  }
  assert.deepEqual(parseArgs(['--base-url', 'https://api.example.test']), {
    baseUrl: 'https://api.example.test',
  });
  assert.throws(() => parseArgs(['--unknown', 'secret']));
});

test('one-shot CLI writes only safe aggregates and exits 2 on a critical threshold', () => {
  const secret = 'token=SENSITIVE123 email=private@example.test';
  const lines = [
    ...Array.from({ length: 19 }, () => http(200, { secret })),
    http(503, { secret }),
  ];
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input: lines.join('\n') + '\n',
    timeout: 10_000,
  });
  assert.equal(result.status, 2);
  const output = JSON.parse(result.stdout);
  assert.equal(output.counters.http503, 1);
  assert.deepEqual(output.alerts, [
    { severity: 'critical', code: 'HIGH_HTTP_503_RATE' },
  ]);
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(result.stdout.includes('private@example.test'), false);
  assert.equal(result.stderr, '');
});

test('one-shot CLI does not print malformed URLs or other input values on failure', () => {
  const result = spawnSync(process.execPath, [script, '--base-url',
    'https://user:password@api.example.test'], {
    encoding: 'utf8', input: '', timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes('password'), false);
  assert.equal(result.stdout.includes('api.example.test'), false);
});
