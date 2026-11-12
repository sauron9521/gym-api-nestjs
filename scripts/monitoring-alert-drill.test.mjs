import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  deliverDrill, drillAlert, parseDrillArgs, validateOrigin,
} from './monitoring-alert-drill.mjs';

const script = fileURLToPath(new URL('./monitoring-alert-drill.mjs', import.meta.url));

test('test drill is dry-run only unless sender confirms test-route ownership', () => {
  assert.deepEqual(parseDrillArgs([]), { origin: null, send: false });
  assert.deepEqual(parseDrillArgs(['--origin', 'http://127.0.0.1:9093']),
    { origin: 'http://127.0.0.1:9093', send: false });
  assert.deepEqual(parseDrillArgs(['--send', '--acknowledge-test-route',
    '--origin', 'https://alertmanager.example.test']),
    { origin: 'https://alertmanager.example.test', send: true });
  for (const args of [
    ['--send'], ['--acknowledge-test-route'],
    ['--send', '--origin', 'http://localhost:9093'],
    ['--unknown'], ['--origin'], ['--origin', 'http://localhost',
      '--origin', 'http://localhost'],
  ]) assert.throws(() => parseDrillArgs(args));
});

test('drill rejects credentials, redirects to arbitrary origins, and insecure hosts', () => {
  for (const url of [
    'http://alertmanager.example.test', 'https://user:pass@alerts.example.test',
    'http://127.0.0.1:9093/x', 'http://localhost:9093/?token=private',
    'https://alerts.example.test/#secret', 'file:///etc/passwd',
    'https://alerts.example.test/api/v2/alerts',
  ]) assert.throws(() => validateOrigin(url));
  assert.equal(validateOrigin('https://alerts.example.test/'),
    'https://alerts.example.test');
});

test('fixed, bounded warning payload includes no customer or host identifiers', () => {
  const alert = drillAlert(1_800_000_000_000);
  assert.equal(alert.length, 1);
  assert.deepEqual(alert[0].labels, {
    alertname: 'GymApiMonitoringDeliveryDrill',
    severity: 'warning',
    drill: 'true',
    source: 'gym-api-monitoring',
  });
  assert.equal(Date.parse(alert[0].endsAt) - Date.parse(alert[0].startsAt),
    180_000);
  assert.doesNotMatch(JSON.stringify(alert), /token|password|email|host|user/i);
});

test('sender uses only POST to the fixed Alertmanager endpoint', async () => {
  const calls = [];
  const result = await deliverDrill('https://alertmanager.example.test',
    1_800_000_000_000, async (url, request) => {
      calls.push({ url: String(url), ...request });
      return { status: 200 };
    });
  assert.deepEqual(result, { submitted: true, notificationConfirmed: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://alertmanager.example.test/api/v2/alerts');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(calls[0].headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].body), drillAlert(1_800_000_000_000));
  await assert.rejects(deliverDrill('https://alertmanager.example.test',
    1_800_000_000_000, async () => ({ status: 302 })));
  await assert.rejects(deliverDrill('https://alertmanager.example.test',
    1_800_000_000_000, async () => { throw new Error('secret host data'); }));
});

test('CLI dry run prints synthetic alert without sending notifications', () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.submitted, false);
  assert.equal(report.alert.labels.drill, 'true');
  assert.equal(report.notificationConfirmed, false);
  const rejected = spawnSync(process.execPath, [script, '--send',
    '--origin', 'https://user:pass@example.test'], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(rejected.status, 1);
  assert.doesNotMatch(rejected.stderr + rejected.stdout, /user:pass|example.test/);
});

test('manual delivery drill correlates a specific notification without claiming receipt', async () => {
  const id = '70b8db83-12e4-40d5-9b65-2f7c8f5b2d11';
  const alerts = drillAlert(1_800_000_000_000, id);
  assert.equal(alerts[0].labels.drill_id, id);
  assert.match(alerts[0].annotations.summary, new RegExp(id));
  assert.throws(() => drillAlert(1_800_000_000_000, 'raw-customer-email@example.test'));
  let delivered;
  const result = await deliverDrill('https://alertmanager.example.test',
    1_800_000_000_000, async (_url, request) => {
      delivered = JSON.parse(request.body);
      return { status: 202 };
    }, id);
  assert.equal(delivered[0].labels.drill_id, id);
  assert.deepEqual(result, {
    submitted: true, notificationConfirmed: false, drillId: id,
  });
});
