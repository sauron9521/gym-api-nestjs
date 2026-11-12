import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  verifyFunctionalResponse, verifyPersistedProfile, makeFunctionalEvidence,
  makeFunctionalFailureEvidence,
} from './staging-functional-smoke.mjs';

const runtime = 'ghcr.io/sauron9521/gym-api-nestjs@sha256:' + 'a'.repeat(64);
const migrate = 'ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:' + 'b'.repeat(64);
const userId = '91d67aa9-49a4-4ac6-ac49-9e1adacbe117';
const email = 'staging-a34fc1ac-70bd-42e8-8971-9897463f202b@example.test';
const baseEnv = {
  GITHUB_REF: 'refs/heads/main', CONFIRM_STAGING: 'RUN_EPHEMERAL_STAGING',
  GITHUB_RUN_ID: '43239872490', DEPLOY_RUNTIME_IMAGE: runtime,
  DEPLOY_MIGRATE_IMAGE: migrate, SOURCE_SHA: 'c'.repeat(40),
  PUBLISH_SHA: 'd'.repeat(40),
};
const profile = {
  id: userId, email, role: 'ATHLETE',
  profile: { firstName: 'StagingTest', weight: 81.25 },
};
const pair = { accessToken: 'long-test-access-token-value-1234',
  refreshToken: 'long-test-refresh-token-value-1234' };

test('registration, anonymous denial, credentials, JWT and refresh contracts are strict', () => {
  const cases = [
    ['anonymousDenied', 401, { statusCode: 401 }],
    ['registration', 201, { id: userId, email,
      verificationEmailStatus: 'RETRY_REQUIRED' }],
    ['registration', 201, { id: userId, email,
      verificationEmailStatus: 'SUBMITTED' }],
    ['login', 200, { mfaRequired: false }],
    ['tokenIssued', 200, pair], ['refresh', 200, pair],
    ['profileRead', 200, profile], ['profileUpdated', 200, profile],
    ['profilePreserved', 200, profile],
  ];
  for (const [name, status, data] of cases) {
    assert.equal(verifyFunctionalResponse(name, status, data), true);
  }
  const errors = [
    ['anonymousDenied', 200, {}],
    ['registration', 409, { id: userId, email }],
    ['registration', 201, { id: userId, email,
      verificationEmailStatus: 'SUBMITTED', passwordHash: 'leak' }],
    ['registration', 201, { id: userId, email, verificationEmailStatus: 'sent' }],
    ['login', 200, { mfaRequired: true }],
    ['tokenIssued', 200, { accessToken: 'x', refreshToken: 'y' }],
    ['refresh', 401, pair],
    ['profileRead', 200, { id: userId, email, passwordHash: 'leak' }],
    ['profileUpdated', 200, { ...profile, id: 'not-a-uuid' }],
    ['unknown', 200, {}],
  ];
  for (const [name, status, data] of errors) {
    assert.throws(() => verifyFunctionalResponse(name, status, data),
      'Failed negative contract: ' + name);
  }
});

test('profile data and fractional weight must survive migration replay and restart', () => {
  assert.equal(verifyPersistedProfile(profile, { userId, email }), true);
  for (const [value, state] of [
    [{ ...profile, id: 'bb0f5dcb-8ff5-49f8-bb05-12d3a1f12ed1' }, { userId, email }],
    [{ ...profile, email: 'wrong@example.test' }, { userId, email }],
    [{ ...profile, profile: { firstName: 'other', weight: 81.25 } }, { userId, email }],
    [{ ...profile, profile: { firstName: 'StagingTest', weight: 81 } }, { userId, email }],
    [profile, { userId, email: 'admin@prod.example.com' }],
  ]) assert.throws(() => verifyPersistedProfile(value, state));
});

test('functional evidence contains only safe assertions and admits no real rollback claim', () => {
  const evidence = makeFunctionalEvidence(baseEnv, 'passed');
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.runId, '43239872490');
  assert.equal(evidence.runtime, runtime);
  assert.equal(evidence.migrate, migrate);
  assert.equal(evidence.checks.refreshRotation, 'passed');
  assert.equal(evidence.checks.repeatedMigrationsPreservedSyntheticData, 'passed');
  assert.equal(evidence.checks.sameDigestContainerRestartRecovered, 'passed');
  assert.equal(evidence.rollbackAcrossDifferentVersions, 'not-tested');
  assert.equal(evidence.productionSchemaDowngraded, false);
  assert.equal(evidence.productionContacted, false);
  assert.ok(!JSON.stringify(evidence).includes(email));
  assert.ok(!JSON.stringify(evidence).includes('password'));
  const failed = makeFunctionalFailureEvidence(baseEnv);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.checks.functionalStatus, 'not-completed');
  assert.equal(failed.rollbackAcrossDifferentVersions, 'not-tested');
  assert.ok(!JSON.stringify(failed).includes(email));
  assert.throws(() => makeFunctionalEvidence(baseEnv, 'failed'));
  assert.throws(() => makeFunctionalEvidence({ ...baseEnv,
    CONFIRM_STAGING: 'NO_STAGING_RUN' }, 'passed'));
});

test('manual workflow executes functional checks between first ready and evidence upload', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/staging-ghcr.yml', import.meta.url), 'utf8');
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(pull_request|push|schedule):/m);
  assert.doesNotMatch(workflow, /docker push|docker build|secrets\./);
  const first = workflow.indexOf('node scripts/staging-smoke.mjs probe');
  const exercise = workflow.indexOf('node scripts/staging-functional-smoke.mjs exercise');
  const migration = workflow.indexOf('Replay signed Prisma migrations on populated disposable database');
  const verification = workflow.indexOf('node scripts/staging-functional-smoke.mjs verify-data');
  const restart = workflow.indexOf('docker stop --time 25 "$STAGING_API"');
  const final = workflow.indexOf('node scripts/staging-functional-smoke.mjs verify-restarted');
  const artifact = workflow.indexOf('Archive staging smoke evidence without credentials');
  const cleanup = workflow.indexOf('Destroy disposable API, database, Redis, network and avatar volume');
  assert.ok(first > 0 && first < exercise && exercise < migration);
  assert.ok(migration < verification && verification < restart &&
    restart < final && final < artifact && artifact < cleanup);
  assert.match(workflow, /-e SMTP_URL=smtps:\/\/127\.0\.0\.1:4465/);
  assert.match(workflow, /staging\/functional-evidence\.json/);
  assert.match(workflow, /node scripts\/staging-functional-smoke\.mjs failed/);
  assert.match(workflow, /rm -f staging\/functional-state\.json/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(ci, /node --test scripts\/staging-functional-smoke\.test\.mjs/);
  assert.match(ignore, /^\/staging\/functional-state\.json$/m);
  assert.match(ignore, /^\/staging\/functional-evidence\.json$/m);
});
