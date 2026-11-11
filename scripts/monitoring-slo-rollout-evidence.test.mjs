import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { PREFLIGHT_METRICS } from './monitoring-slo-preflight.mjs';
import {
  REQUIRED_CONFIRMATIONS, EvidenceError, createEvidenceBundle,
  parseEvidenceArgs, validatePreflightEvidence, validateOperatorChecklist,
  verifyEvidenceBundle, writeEvidenceBundle,
} from './monitoring-slo-rollout-evidence.mjs';

const now = Date.parse('2026-11-11T15:00:00.000Z');
const deployment = 'production';
const values = Object.fromEntries(PREFLIGHT_METRICS.map(name => [
  name.split(':').at(-1),
  name.includes('coverage') || name.endsWith('scrape_success_30d') ? 0.997 :
    name.endsWith('availability_verified_30d') ? 0.985 :
      name.endsWith('error_budget_consumed_verified_30d') ? 15 : 1,
]));

function report(overrides = {}) {
  return {
    version: 1, checkedAt: new Date(now - 120_000).toISOString(),
    deployment, status: 'READY_FOR_REVIEW',
    expectedReplicas: 2, observedReplicas: 2,
    checks: { ...values }, reasons: [], ...overrides,
  };
}

function checklist(overrides = {}) {
  return {
    version: 1, deployment, reviewer: 'operator-01',
    reviewedAt: new Date(now - 60_000).toISOString(),
    changeRef: 'CHG-142-FOLLOWUP',
    decision: 'REVIEWED_FOR_STAGING',
    confirmations: Object.fromEntries(REQUIRED_CONFIRMATIONS.map(x => [x, true])),
    ...overrides,
  };
}

test('includes every real preflight check and does not require 99.9% actual availability', () => {
  const validated = validatePreflightEvidence(report(), now);
  assert.deepEqual(Object.keys(validated.checks).sort(), Object.keys(values).sort());
  assert.equal(validated.checks.http_availability_verified_30d, 0.985);
  assert.equal(validated.checks.http_error_budget_consumed_verified_30d, 15);
  assert.equal(validated.expectedReplicas, 2);
});

test('creates an offline operator-attested but NOT cryptographically signed evidence bundle', () => {
  const evidence = createEvidenceBundle(report(), checklist(), now);
  assert.equal(evidence.status, 'EVIDENCE_READY_FOR_HUMAN_REVIEW');
  assert.equal(evidence.safeguards.networkCalls, false);
  assert.equal(evidence.safeguards.deploymentExecuted, false);
  assert.equal(evidence.safeguards.productionAlertsEnabled, false);
  assert.equal(evidence.safeguards.cryptographicallySigned, false);
  assert.deepEqual(Object.keys(evidence.hashes).sort(),
    ['preflightSha256', 'reviewSha256']);
  assert.match(evidence.hashes.preflightSha256, /^[a-f0-9]{64}$/);
  assert.ok(verifyEvidenceBundle(evidence).valid);
  assert.deepEqual(verifyEvidenceBundle(evidence).deployment, deployment);
  const raw = JSON.stringify(evidence);
  assert.doesNotMatch(raw, /prod-a.internal|authorization|prometheus\.internal|Bearer|api_token|password/i);
});

test('blocks stale, blocked, fabricated, extra-field and incomplete preflight reports', () => {
  const cases = [
    report({ status: 'BLOCKED' }),
    report({ checkedAt: new Date(now - 601_000).toISOString() }),
    report({ checkedAt: new Date(now + 61_000).toISOString() }),
    report({ reasons: ['MISSING_SCRAPE'] }),
    report({ observedReplicas: 1 }),
    report({ expectedReplicas: 0, observedReplicas: 0 }),
    report({ checks: { ...values, unexpected: 1 } }),
    report({ checks: { ...values, http_targets_up: 0 } }),
    report({ checks: { ...values, http_scrape_coverage_30d: 0.98 } }),
    report({ checks: { ...values, http_counter_coverage_30d: null } }),
    report({ checks: { ...values, http_availability_verified_30d: 1.1 } }),
    report({ checks: { ...values, http_error_budget_consumed_verified_30d: -1 } }),
    report({ token: 'SHOULD_NOT_BE_ACCEPTED' }),
    report({ deployment: 'production"or vector(1)' }),
  ];
  for (const item of cases) {
    assert.throws(() => createEvidenceBundle(item, checklist(), now),
      EvidenceError);
  }
});

test('operator checklist requires every manually reviewed gate and matching identity', () => {
  const valid = validateOperatorChecklist(checklist(), report(), now);
  assert.equal(valid.reviewer, 'operator-01');
  assert.equal(valid.decision, 'REVIEWED_FOR_STAGING');
  for (const item of [
    checklist({ deployment: 'staging' }),
    checklist({ decision: 'APPROVE_PRODUCTION' }),
    checklist({ reviewer: 'a' }),
    checklist({ reviewer: 'operator@example.test' }),
    checklist({ changeRef: 'https://secret.example.test/path' }),
    checklist({ reviewedAt: new Date(now - 11 * 60_000).toISOString() }),
    checklist({ reviewedAt: new Date(now + 5 * 60_000).toISOString() }),
    checklist({ reviewedAt: new Date(now - 5 * 60_000).toISOString() }),
    checklist({ confirmations: {
      ...checklist().confirmations, testAlertRoutingReviewed: false,
    } }),
    checklist({ confirmations: {
      ...checklist().confirmations, arbitrary: true,
    } }),
    checklist({ password: 'SENSITIVE' }),
  ]) {
    assert.throws(() => createEvidenceBundle(report(), item, now), EvidenceError);
  }
});

test('tampering with source values or operator review is detected', () => {
  const evidence = createEvidenceBundle(report(), checklist(), now);
  const modified = structuredClone(evidence);
  modified.preflight.checks.http_history_ready_30d = 0;
  assert.throws(() => verifyEvidenceBundle(modified), EvidenceError);
  const changedReviewer = structuredClone(evidence);
  changedReviewer.review.reviewer = 'operator-02';
  assert.throws(() => verifyEvidenceBundle(changedReviewer),
    /EVIDENCE_HASH_MISMATCH/);
  const fakeSignature = structuredClone(evidence);
  fakeSignature.safeguards.cryptographicallySigned = true;
  assert.throws(() => verifyEvidenceBundle(fakeSignature), EvidenceError);
  const staleTime = structuredClone(evidence);
  staleTime.generatedAt = new Date(now + 15 * 60_000).toISOString();
  assert.throws(() => verifyEvidenceBundle(staleTime), EvidenceError);
});

test('exclusive atomic write uses 0600 and refuses overwritten or symlink artifacts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-api-evidence-'));
  try {
    const output = join(dir, 'review.json');
    const bundle = createEvidenceBundle(report(), checklist(), now);
    writeEvidenceBundle(output, bundle);
    assert.ok(existsSync(output));
    assert.ok(lstatSync(output).isFile());
    if (process.platform !== 'win32') assert.equal(statSync(output).mode & 0o777, 0o600);
    const decoded = JSON.parse(readFileSync(output, 'utf8'));
    assert.ok(verifyEvidenceBundle(decoded).valid);
    assert.throws(() => writeEvidenceBundle(output, bundle), EvidenceError);
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), decoded);
    const symlink = join(dir, 'symlink.json');
    symlinkSync(output, symlink);
    assert.throws(() => writeEvidenceBundle(symlink, bundle), EvidenceError);
    assert.equal(
      createHash('sha256').update(JSON.stringify(decoded)).digest('hex'),
      verifyEvidenceBundle(decoded).digest,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI rejects invalid paths and prevents leaking supplied tokens or data', () => {
  assert.deepEqual(parseEvidenceArgs(['--verify', '/tmp/report.json']),
    { verifyPath: '/tmp/report.json' });
  for (const args of [
    [], ['--verify', 'relative.json'],
    ['--report', '/tmp/a', '--checklist', '/tmp/b'],
    ['--report', '/tmp/a', '--checklist', '/tmp/b', '--output', '/tmp/a'],
    ['--report', '/tmp/a', '--checklist', '/tmp/b', '--output', '/tmp/out.txt'],
    ['--report', '/tmp/a', '--checklist', '/tmp/b', '--output', 'relative.json'],
    ['--report', '/tmp/a', '--checklist', '/tmp/b', '--report', '/tmp/out.json'],
  ]) assert.throws(() => parseEvidenceArgs(args), EvidenceError);

  const cli = new URL('./monitoring-slo-rollout-evidence.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, '--report', '/no/secret.json',
    '--checklist', '/no/secret-review.json', '--output', '/tmp/anything.json'],
  { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, 'BLOCKED');
  assert.doesNotMatch(result.stdout, /secret\.json|secret-review|\/no\//);
  assert.equal(result.stderr, '');
});

test('source checklist example is deliberately unapproved and cannot mint an artifact', () => {
  const example = JSON.parse(readFileSync(new URL(
    '../ops/monitoring/http-slo-rollout-checklist.example.json', import.meta.url,
  ), 'utf8'));
  assert.ok(REQUIRED_CONFIRMATIONS.every(k => example.confirmations[k] === false));
  assert.throws(() => createEvidenceBundle(report(), example, now), EvidenceError);
});

test('CLI packages and verifies a valid freshly reviewed artifact without secret paths in stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gym-api-evidence-cli-'));
  try {
    const cli = new URL('./monitoring-slo-rollout-evidence.mjs', import.meta.url).pathname;
    const current = Date.now();
    const instant = iso => new Date(iso).toISOString();
    const currentReport = report({checkedAt: instant(current - 90_000)});
    const currentReview = checklist({reviewedAt: instant(current - 30_000)});
    const reportFile = join(dir, 'private.slo-preflight.json');
    const reviewFile = join(dir, 'private.slo-review.json');
    const outFile = join(dir, 'CHG-142.slo-evidence.json');
    writeFileSync(reportFile, JSON.stringify(currentReport));
    writeFileSync(reviewFile, JSON.stringify(currentReview));

    const created = spawnSync(process.execPath, [
      cli, '--report', reportFile, '--checklist', reviewFile, '--output', outFile,
    ], {encoding: 'utf8'});
    assert.equal(created.status, 0, created.stdout);
    assert.equal(created.stderr, '');
    const summary = JSON.parse(created.stdout);
    assert.equal(summary.status, 'EVIDENCE_READY_FOR_HUMAN_REVIEW');
    assert.equal(summary.authenticatedSignature, false);
    assert.ok(existsSync(outFile));
    assert.ok(!created.stdout.includes(dir));
    assert.ok(!created.stdout.includes(currentReview.reviewer));

    const verified = spawnSync(process.execPath, [cli, '--verify', outFile],
      {encoding: 'utf8'});
    assert.equal(verified.status, 0);
    assert.equal(JSON.parse(verified.stdout).status, 'EVIDENCE_VALID');
    assert.equal(JSON.parse(verified.stdout).sha256, summary.sha256);

    const duplicate = spawnSync(process.execPath, [
      cli, '--report', reportFile, '--checklist', reviewFile, '--output', outFile,
    ], {encoding: 'utf8'});
    assert.equal(duplicate.status, 2);
    assert.deepEqual(JSON.parse(duplicate.stdout).reasons, ['OUTPUT_EXISTS_OR_UNSAFE']);
    assert.ok(verifyEvidenceBundle(JSON.parse(readFileSync(outFile))).valid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
