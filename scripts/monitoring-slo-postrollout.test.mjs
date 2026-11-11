import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { PREFLIGHT_METRICS } from './monitoring-slo-preflight.mjs';
import {
  createEvidenceBundle, REQUIRED_CONFIRMATIONS, verifyEvidenceBundle,
} from './monitoring-slo-rollout-evidence.mjs';
import {
  DriftError, evaluatePostRollout, inventoryFingerprint,
  parseDriftArgs, validateChangeRecord,
} from './monitoring-slo-postrollout.mjs';

const deployment = 'production';
const now = Date.parse('2026-11-11T18:40:00.000Z');
const iso = x => new Date(x).toISOString();
const sampleChecks = Object.fromEntries(PREFLIGHT_METRICS.map(metric => [
  metric.split(':').at(-1),
  metric.includes('coverage') || metric.endsWith('scrape_success_30d') ? 0.997 :
    metric.endsWith('availability_verified_30d') ? 0.999 :
      metric.endsWith('error_budget_consumed_verified_30d') ? 1 : 1,
]));
const originalTargets = ['prod-a.internal:8443', 'prod-b.internal:8443'];

const inventory = (instances = originalTargets) => ({
  version: 1, scrapeIntervalSeconds: 30,
  deployments: [{name: deployment, instances}],
});

function preflight(overrides = {}) {
  return {
    version: 1, checkedAt: iso(now - 240_000), deployment,
    status: 'READY_FOR_REVIEW',
    expectedReplicas: 2, observedReplicas: 2,
    checks: {...sampleChecks}, reasons: [], ...overrides,
  };
}
function operatorReview() {
  return {
    version: 1, deployment, reviewer: 'operator-01',
    reviewedAt: iso(now - 210_000), changeRef: 'CHG-144',
    decision: 'REVIEWED_FOR_STAGING',
    confirmations: Object.fromEntries(REQUIRED_CONFIRMATIONS.map(key => [key, true])),
  };
}
function fixture() {
  const baseline = createEvidenceBundle(preflight(), operatorReview(), now - 180_000);
  const baselineInventory = inventory();
  const currentInventory = inventory([...originalTargets].reverse());
  const currentReport = preflight({checkedAt: iso(now - 30_000)});
  const changeRecord = {
    version: 1, changeRef: baseline.review.changeRef,
    evidenceSha256: verifyEvidenceBundle(baseline).digest,
    inventorySha256: inventoryFingerprint(baselineInventory, deployment).sha256,
    recordedAt: iso(now - 120_000),
    decision: 'STAGING_ROLLOUT_REVIEWED', operatorVerifiedExternally: true,
  };
  return {baseline, baselineInventory, currentInventory, currentReport, changeRecord, nowMs: now};
}

test('same replica set in a different order produces clean sanitized manual-review report', () => {
  const sample = fixture();
  const report = evaluatePostRollout(sample);
  assert.equal(report.status, 'NO_DRIFT_FOR_MANUAL_REVIEW');
  assert.deepEqual(report.reasons, []);
  assert.deepEqual(report.replicaChanges, {added: 0, removed: 0});
  assert.equal(report.baselineReplicas, 2);
  assert.equal(report.currentInventoryReplicas, 2);
  assert.equal(report.metrics.availabilityBaseline, 0.999);
  assert.equal(report.metrics.errorBudgetConsumptionIncrease, 0);
  assert.equal(report.safeguards.networkCalls, false);
  assert.equal(report.safeguards.externallyAuthenticatedApproval, false);
  assert.ok(/^[a-f0-9]{64}$/.test(report.baselineEvidenceSha256));
  const text = JSON.stringify(report);
  for (const forbidden of [...originalTargets, 'Bearer', 'password', 'http://']) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
});

test('equal replica counts with a different target ID are DRIFT', () => {
  const sample = fixture();
  sample.currentInventory = inventory([originalTargets[0], 'prod-c.internal:8443']);
  const report = evaluatePostRollout(sample);
  assert.equal(report.status, 'BLOCKED');
  assert.deepEqual(report.replicaChanges, {added: 1, removed: 1});
  assert.ok(report.reasons.includes('REPLICA_MEMBERSHIP_DRIFT'));
  assert.ok(!JSON.stringify(report).includes('prod-c.internal'));
});

test('an actual availability drop and increased budget trigger distinct review blocks', () => {
  const sample = fixture();
  sample.currentReport.checks.http_availability_verified_30d = 0.997;
  sample.currentReport.checks.http_error_budget_consumed_verified_30d = 1.75;
  const report = evaluatePostRollout(sample);
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.reasons.includes('AVAILABILITY_DEGRADED'));
  assert.ok(report.reasons.includes('ERROR_BUDGET_CONSUMPTION_INCREASED'));
  assert.ok(report.metrics.availabilityDrop > 0.001);
  assert.ok(report.metrics.errorBudgetConsumptionIncrease > 0.5);
});

test('a blocked current preflight cannot be treated as unchanged healthy service', () => {
  const sample = fixture();
  sample.currentReport = preflight({
    checkedAt: iso(now - 30_000), status: 'BLOCKED',
    checks: {...sampleChecks, http_history_ready_30d: 0},
    reasons: ['NOT_READY_HTTP_HISTORY_READY_30D'],
  });
  const report = evaluatePostRollout(sample);
  assert.equal(report.status, 'BLOCKED');
  assert.ok(report.reasons.includes('CURRENT_PREFLIGHT_BLOCKED'));
  assert.ok(report.reasons.includes('CURRENT_NOT_READY_HTTP_HISTORY_READY_30D'));
  assert.equal(report.metrics, null);
});

test('stale, malformed or forged current reports are rejected', () => {
  const cases = [
    {checkedAt: iso(now - 11 * 60_000)},
    {checkedAt: iso(now + 62_000)},
    {deployment: 'staging'},
    {checks: {...sampleChecks, http_targets_up: 0}},
    {checks: {...sampleChecks, http_counter_coverage_30d: null}},
    {checks: {...sampleChecks, arbitraryToken: 'secret'}},
    {reasons: ['SENSITIVE_TOKEN_HERE']},
    {observedReplicas: 1},
  ];
  for (const patch of cases) {
    const sample = fixture();
    sample.currentReport = preflight({checkedAt: iso(now - 30_000), ...patch});
    assert.throws(() => evaluatePostRollout(sample), DriftError);
  }
});

test('baseline evidence, exact inventory count and change record digests are required', () => {
  const sample = fixture();
  const corrupted = structuredClone(sample);
  corrupted.baseline.preflight.checks.http_targets_up = 0;
  assert.throws(() => evaluatePostRollout(corrupted));

  const mismatch = fixture();
  mismatch.baselineInventory = inventory([originalTargets[0]]);
  assert.throws(() => evaluatePostRollout(mismatch), /BASELINE_INVENTORY_COUNT_MISMATCH/);

  for (const patch of [
    {changeRef: 'CHG-SOMEONE-ELSE'},
    {evidenceSha256: 'f'.repeat(64)},
    {inventorySha256: 'f'.repeat(64)},
    {operatorVerifiedExternally: false},
    {decision: 'APPROVED_FOR_PRODUCTION'},
    {unexpected: 'value'},
    {recordedAt: iso(now - 220_000)},
    {recordedAt: iso(now + 120_000)},
  ]) {
    const current = fixture();
    current.changeRecord = {...current.changeRecord, ...patch};
    assert.throws(() => evaluatePostRollout(current), DriftError);
  }
});

test('later/current reports must follow externally referenced staging change review', () => {
  const sample = fixture();
  sample.currentReport.checkedAt = iso(now - 130_000);
  assert.throws(() => evaluatePostRollout(sample), /CURRENT_REPORT_PREDATES_CHANGE/);
});

test('malicious approval examples remain unapproved and do not expose source identities', () => {
  const sample = fixture();
  const unapproved = JSON.parse(readFileSync(new URL(
    '../ops/monitoring/http-slo-postrollout-change-record.example.json',
    import.meta.url,
  ), 'utf8'));
  assert.equal(unapproved.operatorVerifiedExternally, false);
  assert.throws(() => validateChangeRecord(
    unapproved, sample.baseline,
    inventoryFingerprint(sample.baselineInventory, deployment).sha256, now,
  ));
});

test('CLI argument parser disallows path injection, duplicates and unrelated flags', () => {
  const args = [
    '--baseline', '/tmp/base.slo-evidence.json',
    '--baseline-inventory', '/tmp/base-inventory.json',
    '--current-inventory', '/tmp/current-inventory.json',
    '--current-report', '/tmp/current.slo-preflight.json',
    '--change-record', '/tmp/approval.slo-change-record.json',
  ];
  assert.equal(parseDriftArgs(args).baselinePath, '/tmp/base.slo-evidence.json');
  for (const bad of [
    args.slice(0, -2),
    [...args, '--extra', '/tmp/nope'],
    args.map(x => x === '/tmp/current-inventory.json' ? 'relative' : x),
    args.map(x => x === '/tmp/current-inventory.json' ? '/tmp/base-inventory.json' : x),
  ]) assert.throws(() => parseDriftArgs(bad), DriftError);
});

test('CLI reads only local JSON; returns zero for no drift, two on drift or bad input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-api-slo-postrollout-'));
  const cli = new URL('./monitoring-slo-postrollout.mjs', import.meta.url).pathname;
  try {
    const current = Date.now();
    const sample = fixture();
    sample.baseline = createEvidenceBundle(
      preflight({checkedAt: iso(current - 5 * 60_000)}),
      {...operatorReview(), reviewedAt: iso(current - 4 * 60_000)},
      current - 3 * 60_000,
    );
    sample.changeRecord = {
      ...sample.changeRecord,
      evidenceSha256: verifyEvidenceBundle(sample.baseline).digest,
      recordedAt: iso(current - 2 * 60_000),
    };
    sample.currentReport = preflight({checkedAt: iso(current - 30_000)});
    const paths = {
      baseline: join(dir, 'base.slo-evidence.json'),
      baselineInventory: join(dir, 'base-inventory.json'),
      currentInventory: join(dir, 'current-inventory.json'),
      currentReport: join(dir, 'current.slo-preflight.json'),
      changeRecord: join(dir, 'change.slo-change-record.json'),
    };
    for (const [name, path] of Object.entries(paths)) {
      writeFileSync(path, JSON.stringify(sample[name]));
    }
    const fingerprint = spawnSync(process.execPath, [
      cli, '--fingerprint-inventory', paths.baselineInventory,
      '--deployment', deployment,
    ], {encoding: 'utf8'});
    assert.equal(fingerprint.status, 0);
    const finger = JSON.parse(fingerprint.stdout);
    assert.equal(finger.status, 'INVENTORY_FINGERPRINT');
    assert.equal(finger.inventorySha256, sample.changeRecord.inventorySha256);
    assert.equal(finger.replicaCount, 2);
    assert.ok(!fingerprint.stdout.includes('prod-a.internal'));

    const args = [
      '--baseline', paths.baseline,
      '--baseline-inventory', paths.baselineInventory,
      '--current-inventory', paths.currentInventory,
      '--current-report', paths.currentReport,
      '--change-record', paths.changeRecord,
    ];
    const ok = spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8'});
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.equal(JSON.parse(ok.stdout).status, 'NO_DRIFT_FOR_MANUAL_REVIEW');
    assert.equal(ok.stderr, '');
    assert.ok(!ok.stdout.includes('prod-a.internal'));

    writeFileSync(paths.currentInventory, JSON.stringify(
      inventory([originalTargets[0], 'prod-c.internal:8443']),
    ));
    const changed = spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8'});
    assert.equal(changed.status, 2);
    assert.ok(JSON.parse(changed.stdout).reasons.includes('REPLICA_MEMBERSHIP_DRIFT'));
    const bad = spawnSync(process.execPath, [cli, ...args.slice(0, -2)],
      {encoding: 'utf8'});
    assert.equal(bad.status, 2);
    assert.deepEqual(JSON.parse(bad.stdout).reasons, ['INVALID_ARGUMENTS']);
    assert.ok(!bad.stdout.includes(dir));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
