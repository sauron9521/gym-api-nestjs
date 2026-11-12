import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PHASES } from './staging-upgrade-rollback.mjs';
import {
  validateReadOnlyRequest, verifyReleaseEvidence, evaluateOperatorApproval,
  selectSuccessfulSourceCI, verifySourceCI,
} from './production-readiness.mjs';

const runtime = 'ghcr.io/sauron9521/gym-api-nestjs@sha256:' + 'a'.repeat(64);
const migrate = 'ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:' + 'b'.repeat(64);
const previousRuntime = 'ghcr.io/sauron9521/gym-api-nestjs@sha256:' + 'c'.repeat(64);
const previousMigrate = 'ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:' + 'd'.repeat(64);
const sourceSha = 'e'.repeat(40);
const publisherSha = 'f'.repeat(40);
const olderSha = '1'.repeat(40);
const olderPublisher = '2'.repeat(40);
const request = { publisherRunId: '43280626086', stagingRunId: '43285235000' };
const repository = { full_name: 'sauron9521/gym-api-nestjs' };
const run = {
  repository, event: 'workflow_dispatch', head_branch: 'main',
  status: 'completed', conclusion: 'success',
};
const publisher = {
  ...run, id: Number(request.publisherRunId), head_sha: publisherSha,
  path: '.github/workflows/publish-ghcr.yml',
  created_at: '2026-11-12T18:30:58Z',
};
const staging = {
  ...run, id: Number(request.stagingRunId), head_sha: sourceSha,
  path: '.github/workflows/staging-upgrade-rollback.yml',
  created_at: '2026-11-12T18:57:51Z',
};
const ciRun = {
  ...run, id: 43278936773, event: 'push',
  path: '.github/workflows/ci.yml', head_sha: sourceSha,
  created_at: '2026-11-12T18:21:15Z',
};
const ciJobs = { total_count: 4, jobs: [
  'CI / required gates',
  'Lint, build and tests',
  'Dependency vulnerability audit',
  'Docker production build and HTTP smoke',
].map(name => ({
  name, run_id: ciRun.id,
  // Real GitHub returned an inconsistent status for this successful job:
  // "in_progress" while its conclusion and parent run were "success".
  status: name === 'Dependency vulnerability audit' ? 'in_progress' : 'completed',
  conclusion: 'success',
})) };
const previous = {
  sourceSha: olderSha, publishSha: olderPublisher,
  runtime: previousRuntime, migrate: previousMigrate,
};
const target = { sourceSha, publishSha: publisherSha, runtime, migrate };
const stagingReceipt = {
  schemaVersion: 1, kind: 'disposable-two-signed-release-upgrade-rollback',
  result: 'passed', runId: request.stagingRunId, previous, target,
  checks: PHASES.map(stage => ({ stage, result: 'passed' })),
  rollback: 'previous-runtime-on-target-schema',
  databaseBackup: 'test-only-verified',
  databaseDowngradePerformed: false,
  productionContacted: false, deployedToPersistentHost: false,
  productionReleaseApproval: false, authenticatedFunctionalChecks: true,
};
const candidate = { request, publisher, staging, ciRun, ciJobs,
  publishDigests: { runtime, migrate }, stagingReceipt };
const clone = value => structuredClone(value);

test('manual review must be explicit on main with distinct run IDs', () => {
  const env = {
    GITHUB_REF: 'refs/heads/main', CONFIRM_REVIEW: 'REVIEW_RELEASE_EVIDENCE',
    PUBLISH_RUN_ID: request.publisherRunId,
    STAGING_RUN_ID: request.stagingRunId,
  };
  assert.deepEqual(validateReadOnlyRequest(env), request);
  for (const change of [
    { GITHUB_REF: 'refs/heads/untrusted' },
    { CONFIRM_REVIEW: 'NO_REVIEW' },
    { PUBLISH_RUN_ID: 'latest' },
    { PUBLISH_RUN_ID: request.stagingRunId },
    { STAGING_RUN_ID: '0' },
  ]) assert.throws(() => validateReadOnlyRequest({ ...env, ...change }));
});

test('verified release evidence is always production NO-GO before private host approval', () => {
  const report = verifyReleaseEvidence(candidate);
  assert.equal(report.kind, 'release-readiness-evidence');
  assert.equal(report.releaseEvidence, 'VERIFIED');
  assert.equal(report.decision, 'NO-GO');
  assert.equal(report.decisionScope, 'PRODUCTION_DEPLOYMENT');
  assert.equal(report.publisherRunId, request.publisherRunId);
  assert.equal(report.ciRunId, ciRun.id);
  assert.equal(report.stagingRunId, request.stagingRunId);
  assert.equal(report.runtime, runtime);
  assert.equal(report.migrate, migrate);
  assert.equal(report.publisherSha, publisherSha);
  assert.equal(report.sourceSha, sourceSha);
  assert.equal(report.verifiedStagingPhases.length, 7);
  assert.equal(report.verifiedOciAttestations, true);
  assert.equal(report.productionContacted, false);
  assert.equal(report.productionReleaseApproval, false);
  assert.equal(report.deployTriggered, false);
  assert.equal(report.reasons.length, 4);
});

test('fail closed for wrong digest, stale/failed stage or untrusted publisher', () => {
  const mutation = [
    x => { x.publisher.conclusion = 'failure'; },
    x => { x.publisher.event = 'pull_request'; },
    x => { x.publisher.path = '.github/workflows/malicious.yml'; },
    x => { x.publisher.head_branch = 'feature'; },
    x => { x.publisher.repository.full_name = 'other/repo'; },
    x => { x.publisher.head_sha = 'f'.repeat(39) + '0'; },
    x => { x.publishDigests.runtime = previousRuntime; },
    x => { x.publishDigests.migrate = previousMigrate; },
    x => { x.staging.conclusion = 'failure'; },
    x => { x.staging.path = '.github/workflows/staging-ghcr.yml'; },
    x => { x.staging.created_at = '2026-11-12T12:00:00Z'; },
    x => { x.stagingReceipt.runId = '43281859866'; },
    x => { x.stagingReceipt.result = 'failed'; },
    x => { x.stagingReceipt.target.runtime = previousRuntime; },
    x => { x.stagingReceipt.checks.pop(); },
    x => { x.stagingReceipt.checks[3].result = 'failed'; },
    x => { x.stagingReceipt.checks.reverse(); },
    x => { x.stagingReceipt.databaseBackup = 'unknown'; },
    x => { x.stagingReceipt.rollback = 'not-confirmed'; },
    x => { x.stagingReceipt.databaseDowngradePerformed = true; },
    x => { x.stagingReceipt.productionContacted = true; },
    x => { x.stagingReceipt.authenticatedFunctionalChecks = false; },
    x => { x.ciRun.conclusion = 'failure'; },
    x => { x.ciRun.status = 'in_progress'; },
    x => { x.ciRun.path = '.github/workflows/fake-ci.yml'; },
    x => { x.ciRun.event = 'workflow_dispatch'; },
    x => { x.ciRun.head_sha = olderSha; },
    x => { x.ciRun.head_branch = 'feature'; },
    x => { x.ciRun.repository.full_name = 'another/repo'; },
    x => { x.ciRun.created_at = '2026-11-12T19:00:00Z'; },
    x => { x.ciJobs.jobs[0].conclusion = 'failure'; },
    x => { x.ciJobs.jobs[2].run_id = 1; },
    x => { x.ciJobs.jobs.splice(1, 1); },
    x => { x.ciJobs.jobs.push(structuredClone(x.ciJobs.jobs[0])); },
  ];
  for (const tamper of mutation) {
    const x = clone(candidate);
    tamper(x);
    assert.throws(() => verifyReleaseEvidence(x));
  }
});

test('choose only completed successful main-push CI for the correct source SHA', () => {
  const valid = structuredClone(ciRun);
  const invalid = [
    { ...valid, id: 1, event: 'pull_request' },
    { ...valid, id: 2, head_branch: 'other' },
    { ...valid, id: 3, head_sha: olderSha },
    { ...valid, id: 4, status: 'in_progress' },
    { ...valid, id: 5, conclusion: 'failure' },
    { ...valid, id: 6, created_at: '2026-11-12T19:00:00Z' },
    { ...valid, id: 7, path: '.github/workflows/untrusted.yml' },
    { ...valid, id: 8, repository: { full_name: 'wrong/repo' } },
  ];
  assert.equal(selectSuccessfulSourceCI({ workflow_runs: [...invalid, valid] },
    sourceSha, publisher).id, valid.id);
  assert.throws(() => selectSuccessfulSourceCI({ workflow_runs: invalid },
    sourceSha, publisher));
  assert.throws(() => selectSuccessfulSourceCI({ workflow_runs: [valid] },
    olderSha, publisher));
});

test('inconsistent job status is allowed only when the parent CI workflow concluded successfully', () => {
  // Real GitHub #43278936773: dependency job says in_progress/success;
  // completed, successful parent run and all four successful conclusions win.
  assert.equal(verifySourceCI(ciRun, ciJobs, sourceSha, publisher), true);
  assert.equal(verifyReleaseEvidence(candidate).releaseEvidence, 'VERIFIED');
  assert.throws(() => verifySourceCI({ ...ciRun, status: 'in_progress' },
    ciJobs, sourceSha, publisher));
  assert.throws(() => verifySourceCI({ ...ciRun, conclusion: 'failure' },
    ciJobs, sourceSha, publisher));
  assert.throws(() => verifySourceCI(ciRun, {
    jobs: ciJobs.jobs.map(x => x.name === 'Dependency vulnerability audit'
      ? { ...x, conclusion: null } : x),
  }, sourceSha, publisher));
});

const time = new Date('2026-11-12T19:00:00Z');
const env = {
  DEPLOY_RUNTIME_IMAGE: runtime, DEPLOY_MIGRATE_IMAGE: migrate,
  SOURCE_SHA: sourceSha, PUBLISH_SHA: publisherSha,
  EXPECTED_CURRENT_IMAGE: previousRuntime,
  BACKUP_DIR: '/srv/private/backups/release-456',
  CONFIRM_DEPLOY: 'DEPLOY_VERIFIED_DIGEST',
  RUN_DB_MIGRATIONS: 'yes',
};
const approval = {
  schemaVersion: 1, kind: 'private-production-change-approval',
  changeTicket: 'CHANGE-2026-000245',
  approvedBy: 'release-manager-01',
  operatorOnCall: 'oncall-secondary-02',
  approvedAt: '2026-11-12T18:55:00Z',
  maintenanceWindowStart: '2026-11-12T18:50:00Z',
  maintenanceWindowEnd: '2026-11-12T20:00:00Z',
  expectedCurrentImage: previousRuntime,
  backupDirectory: env.BACKUP_DIR,
  release: {
    publisherRunId: request.publisherRunId,
    stagingRunId: request.stagingRunId,
    runtime, migrate, sourceSha, publisherSha,
  },
  evidence: {
    restoredBackupEvidenceId: 'restore-postgres-456',
    avatarRestoreEvidenceId: 'restore-avatars-456',
    tlsProxyEvidenceId: 'tls-proxy-verified-456',
    monitoringAlertEvidenceId: 'alert-routing-drill-456',
    schemaCompatibilityReviewId: 'migration-review-456',
    rollbackPlanEvidenceId: 'rollback-approval-456',
    hostPreflightEvidenceId: 'host-preflight-456',
    onCallAcknowledgementId: 'oncall-confirm-456',
  },
};

test('local operator approval GO is possible only for separately confirmed apply', () => {
  const report = verifyReleaseEvidence(candidate);
  report.verifiedAt = time.toISOString();
  const ok = evaluateOperatorApproval(report, approval, env, time);
  assert.equal(ok.decision, 'GO');
  assert.equal(ok.decisionScope, 'MANUAL_SINGLE_HOST_APPLY');
  assert.equal(ok.automaticDeployment, false);
  assert.equal(ok.hostEvidenceVerification,
    'OPERATOR_ATTESTED_NOT_AUTOMATICALLY_VERIFIED');
  assert.deepEqual(ok.reasons, []);
});

test('local operator gate defaults NO-GO on missing proofs, drift and expiry', () => {
  const report = verifyReleaseEvidence(candidate);
  report.verifiedAt = time.toISOString();
  const cases = [
    [{ ...report, verifiedAt: '2026-10-30T00:00:00Z' }, approval, env, time],
    [{ ...report, verifiedAt: '2026-11-13T00:00:00Z' }, approval, env, time],
    [null, approval, env, time],
    [{ ...report, releaseEvidence: 'FAILED' }, approval, env, time],
    [report, null, env, time],
    [report, { ...approval, approvedBy: approval.operatorOnCall }, env, time],
    [report, { ...approval, approvedAt: '2026-11-10T00:00:00Z' }, env, time],
    [report, { ...approval, maintenanceWindowEnd: '2026-11-12T18:59:00Z' }, env, time],
    [report, { ...approval, maintenanceWindowEnd: '2026-11-13T20:00:00Z' }, env, time],
    [report, { ...approval, expectedCurrentImage: 'none' }, env, time],
    [report, { ...approval, backupDirectory: '/srv/elsewhere' }, env, time],
    [report, { ...approval, evidence: {
      ...approval.evidence, restoredBackupEvidenceId: '',
    } }, env, time],
    [report, { ...approval, evidence: {
      ...approval.evidence, onCallAcknowledgementId: 'unknown',
    } }, env, time],
    [report, { ...approval, release: {
      ...approval.release, stagingRunId: '43281859866',
    } }, env, time],
    [report, approval, { ...env, SOURCE_SHA: olderSha }, time],
    [report, approval, { ...env, DEPLOY_RUNTIME_IMAGE: previousRuntime }, time],
    [report, approval, { ...env, EXPECTED_CURRENT_IMAGE: 'wrong' }, time],
    [report, approval, { ...env, RUN_DB_MIGRATIONS: 'auto' }, time],
    [report, approval, { ...env, CONFIRM_DEPLOY: 'no' }, time],
    [report, approval, env, new Date('2026-11-13T19:00:00Z')],
  ];
  for (const [source, signoff, operatorEnv, now] of cases) {
    assert.equal(evaluateOperatorApproval(source, signoff, operatorEnv, now).decision,
      'NO-GO');
  }
});

test('read-only GitHub review cannot deploy, and apply requires both private proofs', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/production-readiness.yml', import.meta.url), 'utf8');
  const deploy = await readFile(new URL('./production-digest-deploy.sh', import.meta.url), 'utf8');
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule|workflow_run):/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /--source-digest "\$publisher_sha"/);
  assert.match(workflow, /--predicate-type "\$predicate"/);
  assert.match(workflow, /--signer-workflow "\$GITHUB_REPOSITORY\/\.github\/workflows\/publish-ghcr\.yml"/);
  assert.match(workflow, /node scripts\/production-readiness\.mjs assess/);
  assert.match(workflow, /staging-two-release-\$STAGING_RUN_ID-\$attempt/);
  assert.match(workflow, /actions\/runs\?head_sha=\$source_sha/);
  assert.match(workflow, /node scripts\/production-readiness\.mjs select-ci/);
  assert.match(workflow, /actions\/runs\/\$ci_run_id\/jobs\?filter=latest/);
  assert.doesNotMatch(workflow, /\/commits\/\$source_sha\/check-runs/);
  assert.match(workflow, /ghcr-digests-/);
  assert.match(workflow, /NO-GO/);
  assert.doesNotMatch(workflow,
    /secrets\.|id-token: write|packages: write|ssh |kubectl|docker compose up|docker push|docker run|production:|environment: production/);
  assert.match(deploy, /PRODUCTION_RELEASE_REPORT:\?/);
  assert.match(deploy, /PRODUCTION_OPERATOR_APPROVAL_FILE:\?/);
  assert.match(deploy, /node scripts\/production-readiness\.mjs operator-gate/);
  const backup = deploy.indexOf('tar -tzf "$BACKUP_DIR/avatars.tar.gz"');
  const gate = deploy.indexOf('node scripts/production-readiness.mjs operator-gate');
  const migration = deploy.indexOf('--profile ops run --rm --no-deps --pull never migrate');
  const update = deploy.indexOf('up -d --no-deps --no-build --pull never --force-recreate api');
  assert.ok(backup > 0 && backup < gate && gate < migration && gate < update);
  assert.match(ci, /node --test scripts\/production-readiness\.test\.mjs/);
});
