#!/usr/bin/env node
// Production readiness is evidence-based and NO-GO unless an independent
// human operator supplies current, private host-specific evidence.
// No network or host mutations; never print secret-bearing input objects.
import assert from 'node:assert/strict';
import { lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASES } from './staging-upgrade-rollback.mjs';

const REPO = 'sauron9521/gym-api-nestjs';
const RUNTIME = /^ghcr\.io\/sauron9521\/gym-api-nestjs@sha256:[a-f0-9]{64}$/;
const MIGRATE = /^ghcr\.io\/sauron9521\/gym-api-nestjs-migrate@sha256:[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[1-9][0-9]{0,15}$/;
const EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;
const REQUIRED_CHECKS = [
  'CI / required gates',
  'Lint, build and tests',
  'Dependency vulnerability audit',
  'Docker production build and HTTP smoke',
];
const HOST_REQUIRED = [
  'restoredBackupEvidenceId',
  'avatarRestoreEvidenceId',
  'tlsProxyEvidenceId',
  'monitoringAlertEvidenceId',
  'schemaCompatibilityReviewId',
  'rollbackPlanEvidenceId',
  'hostPreflightEvidenceId',
  'onCallAcknowledgementId',
];

function requireRun(value, id, name, path) {
  assert.equal(value?.id, Number(id), 'Wrong ' + name + ' run identity');
  assert.equal(value?.repository?.full_name, REPO, 'Wrong repository');
  assert.equal(value?.path, path, 'Untrusted workflow');
  assert.equal(value?.event, 'workflow_dispatch', 'Not manually dispatched');
  assert.equal(value?.head_branch, 'main', 'Not from main');
  assert.equal(value?.status, 'completed', 'Run is incomplete');
  assert.equal(value?.conclusion, 'success', 'Run did not succeed');
  assert.match(value?.head_sha ?? '', SHA);
  assert.match(value?.created_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Number.isFinite(Date.parse(value.created_at)), 'Invalid run timestamp');
}

function requirePair(pair) {
  assert.match(pair?.runtime ?? '', RUNTIME);
  assert.match(pair?.migrate ?? '', MIGRATE);
  assert.match(pair?.sourceSha ?? '', SHA);
  assert.match(pair?.publishSha ?? '', SHA);
}

export function validateReadOnlyRequest(env) {
  assert.equal(env?.GITHUB_REF, 'refs/heads/main', 'Must use main');
  assert.equal(env?.CONFIRM_REVIEW, 'REVIEW_RELEASE_EVIDENCE',
    'Manual read-only review confirmation missing');
  assert.match(String(env?.PUBLISH_RUN_ID ?? ''), ID);
  assert.match(String(env?.STAGING_RUN_ID ?? ''), ID);
  assert.notEqual(String(env.PUBLISH_RUN_ID), String(env.STAGING_RUN_ID));
  return {
    publisherRunId: String(env.PUBLISH_RUN_ID),
    stagingRunId: String(env.STAGING_RUN_ID),
  };
}

export function verifyReleaseEvidence(input) {
  const { publisherRunId, stagingRunId } = input.request;
  const { publisher, staging, checks, publishDigests, stagingReceipt } = input;
  requireRun(publisher, publisherRunId, 'publisher',
    '.github/workflows/publish-ghcr.yml');
  requireRun(staging, stagingRunId, 'staging',
    '.github/workflows/staging-upgrade-rollback.yml');

  assert.equal(stagingReceipt?.schemaVersion, 1);
  assert.equal(stagingReceipt?.kind,
    'disposable-two-signed-release-upgrade-rollback');
  assert.equal(stagingReceipt?.result, 'passed', 'Staging result failed');
  assert.equal(stagingReceipt?.runId, stagingRunId);
  requirePair(stagingReceipt?.previous);
  requirePair(stagingReceipt?.target);
  assert.notEqual(stagingReceipt.previous.runtime, stagingReceipt.target.runtime);
  assert.notEqual(stagingReceipt.previous.migrate, stagingReceipt.target.migrate);
  assert.notEqual(stagingReceipt.previous.sourceSha, stagingReceipt.target.sourceSha);
  assert.deepEqual(stagingReceipt.checks,
    PHASES.map(stage => ({ stage, result: 'passed' })),
    'Missing ordered staging compatibility gates');
  assert.equal(stagingReceipt.rollback, 'previous-runtime-on-target-schema');
  assert.equal(stagingReceipt.databaseBackup, 'test-only-verified');
  assert.equal(stagingReceipt.databaseDowngradePerformed, false);
  assert.equal(stagingReceipt.productionContacted, false);
  assert.equal(stagingReceipt.deployedToPersistentHost, false);
  assert.equal(stagingReceipt.productionReleaseApproval, false);
  assert.equal(stagingReceipt.authenticatedFunctionalChecks, true);

  assert.equal(publisher.head_sha, stagingReceipt.target.publishSha,
    'Publisher main commit changed');
  assert.ok(Date.parse(publisher.created_at) < Date.parse(staging.created_at),
    'Staging must follow publication');
  assert.equal(publishDigests?.runtime, stagingReceipt.target.runtime,
    'Published runtime digest does not match staging');
  assert.equal(publishDigests?.migrate, stagingReceipt.target.migrate,
    'Published migrations digest does not match staging');

  const sourceSha = stagingReceipt.target.sourceSha;
  assert.ok(Array.isArray(checks?.check_runs), 'Missing main checks');
  for (const name of REQUIRED_CHECKS) {
    assert.ok(checks.check_runs.some(check =>
      check.name === name &&
      check.head_sha === sourceSha &&
      check.status === 'completed' &&
      check.conclusion === 'success' &&
      check.app?.slug === 'github-actions'),
      'Missing successful required CI gate: ' + name);
  }

  const source = stagingReceipt.target;
  const previous = stagingReceipt.previous;
  return {
    schemaVersion: 1,
    kind: 'release-readiness-evidence',
    releaseEvidence: 'VERIFIED',
    decision: 'NO-GO',
    decisionScope: 'PRODUCTION_DEPLOYMENT',
    reasons: [
      'Private production backup and restored avatars not machine-verified',
      'Production restore drill and live host preflight not supplied',
      'TLS, alert routing, migration approval and on-call acknowledgements missing',
      'No production operator approval or change window',
    ],
    publisherRunId, stagingRunId,
    sourceSha: source.sourceSha,
    publisherSha: source.publishSha,
    runtime: source.runtime,
    migrate: source.migrate,
    previous: {
      sourceSha: previous.sourceSha,
      runtime: previous.runtime,
      migrate: previous.migrate,
    },
    verifiedChecks: REQUIRED_CHECKS,
    verifiedStagingPhases: PHASES,
    verifiedOciAttestations: true,
    productionContacted: false,
    productionReleaseApproval: false,
    deployTriggered: false,
  };
}

function idPresent(value) {
  return typeof value === 'string' && EVIDENCE_ID.test(value);
}

export function evaluateOperatorApproval(releaseReport, approval, env, now = new Date()) {
  const reasons = [];
  const fail = (message) => reasons.push(message);
  if (releaseReport?.kind !== 'release-readiness-evidence' ||
      releaseReport.releaseEvidence !== 'VERIFIED' ||
      releaseReport.decision !== 'NO-GO' ||
      releaseReport.productionReleaseApproval !== false ||
      releaseReport.productionContacted !== false ||
      releaseReport.deployTriggered !== false ||
      releaseReport.verifiedOciAttestations !== true) {
    fail('Trusted release-evidence report missing or invalid');
  }
  if (!RUNTIME.test(env?.DEPLOY_RUNTIME_IMAGE ?? '') ||
      !MIGRATE.test(env?.DEPLOY_MIGRATE_IMAGE ?? '') ||
      !SHA.test(env?.SOURCE_SHA ?? '') ||
      !SHA.test(env?.PUBLISH_SHA ?? '') ||
      !RUNTIME.test(releaseReport?.runtime ?? '') ||
      !MIGRATE.test(releaseReport?.migrate ?? '') ||
      env.DEPLOY_RUNTIME_IMAGE !== releaseReport.runtime ||
      env.DEPLOY_MIGRATE_IMAGE !== releaseReport.migrate ||
      env.SOURCE_SHA !== releaseReport.sourceSha ||
      env.PUBLISH_SHA !== releaseReport.publisherSha) {
    fail('Requested production digest and source do not match verified release');
  }
  const expectedCurrent = env?.EXPECTED_CURRENT_IMAGE;
  if (!(expectedCurrent === 'none' || RUNTIME.test(expectedCurrent ?? ''))) {
    fail('Expected current image is missing or untrusted');
  }
  if (approval?.schemaVersion !== 1 ||
      approval?.kind !== 'private-production-change-approval') {
    fail('Private operator approval is absent');
  }
  if (!idPresent(approval?.changeTicket) ||
      !idPresent(approval?.approvedBy) ||
      !idPresent(approval?.operatorOnCall) ||
      approval?.approvedBy === approval?.operatorOnCall) {
    fail('Named change ticket and two separate people/roles are required');
  }
  if (approval?.release?.publisherRunId !== releaseReport?.publisherRunId ||
      approval?.release?.stagingRunId !== releaseReport?.stagingRunId ||
      approval?.release?.runtime !== releaseReport?.runtime ||
      approval?.release?.migrate !== releaseReport?.migrate ||
      approval?.release?.sourceSha !== releaseReport?.sourceSha ||
      approval?.release?.publisherSha !== releaseReport?.publisherSha) {
    fail('Operator approval is for a different release or staging run');
  }
  if (approval?.expectedCurrentImage !== expectedCurrent) {
    fail('Approved currently running digest changed');
  }
  if (approval?.backupDirectory !== env?.BACKUP_DIR ||
      !isAbsolute(approval?.backupDirectory ?? '')) {
    fail('Private backup directory must match the one locally verified');
  }
  for (const key of HOST_REQUIRED) {
    if (!idPresent(approval?.evidence?.[key])) {
      fail('Missing private operator evidence: ' + key);
    }
  }
  const start = Date.parse(approval?.maintenanceWindowStart ?? '');
  const end = Date.parse(approval?.maintenanceWindowEnd ?? '');
  const approved = Date.parse(approval?.approvedAt ?? '');
  const current = now.getTime();
  if (!(Number.isFinite(start) && Number.isFinite(end) &&
    start <= current && current <= end &&
    end - start <= 8 * 60 * 60 * 1000)) {
    fail('Current time not inside an approved maintenance window (max 8h)');
  }
  if (!(Number.isFinite(approved) && approved <= current &&
    current - approved <= 24 * 60 * 60 * 1000)) {
    fail('Operator approval is older than 24 hours or in the future');
  }
  if (env?.CONFIRM_DEPLOY !== 'DEPLOY_VERIFIED_DIGEST') {
    fail('Explicit local operator deployment confirmation missing');
  }
  if (env?.RUN_DB_MIGRATIONS !== 'yes' && env?.RUN_DB_MIGRATIONS !== 'no') {
    fail('RUN_DB_MIGRATIONS must be yes or no');
  }

  return {
    decision: reasons.length ? 'NO-GO' : 'GO',
    decisionScope: 'MANUAL_SINGLE_HOST_APPLY',
    reasons,
    // This is a local *human evidence* gate, not remote independent checks.
    hostEvidenceVerification: 'OPERATOR_ATTESTED_NOT_AUTOMATICALLY_VERIFIED',
    automaticDeployment: false,
  };
}

async function readPrivateJson(path) {
  assert.ok(typeof path === 'string' && isAbsolute(path));
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Refuse non-file or symlink');
  assert.ok(stat.size > 0 && stat.size <= 128_000, 'Invalid evidence size');
  assert.equal(stat.mode & 0o002, 0, 'World-writable evidence is forbidden');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  try {
    const mode = process.argv[2];
    if (mode === 'identity') {
      validateReadOnlyRequest(process.env);
      process.stdout.write('Manual read-only production readiness review authorized\n');
    } else if (mode === 'assess') {
      const request = validateReadOnlyRequest(process.env);
      const files = ['publisher.json', 'staging.json', 'checks.json',
        'ghcr-digests.json', 'upgrade-evidence.json'];
      const values = await Promise.all(files.map(x =>
        readFile('readiness/input/' + x, 'utf8').then(JSON.parse)));
      const [publisher, staging, checks, publishDigests, stagingReceipt] = values;
      const report = verifyReleaseEvidence({
        request, publisher, staging, checks, publishDigests, stagingReceipt,
      });
      await mkdir('readiness/output', { recursive: true, mode: 0o700 });
      await writeFile('readiness/output/release-evidence.json',
        JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      process.stdout.write('Release evidence: VERIFIED. Production: NO-GO until independently verified host evidence and manual approval.\n');
      if (process.env.GITHUB_STEP_SUMMARY) {
        const { appendFile } = await import('node:fs/promises');
        await appendFile(process.env.GITHUB_STEP_SUMMARY,
          '### Production readiness review — NO-GO\n' +
          'Release evidence: VERIFIED. CI, published immutable digests, OCI attestations and seven-stage staging success confirmed.\n' +
          'Production approval: NOT GRANTED. Host backups, restore, TLS, monitoring, change window and independent operator approval are not established by GitHub Actions.\n' +
          'No production deployment or remote access occurred.\n');
      }
    } else if (mode === 'operator-gate') {
      const report = await readPrivateJson(process.env.PRODUCTION_RELEASE_REPORT);
      const approval = await readPrivateJson(process.env.PRODUCTION_OPERATOR_APPROVAL_FILE);
      const outcome = evaluateOperatorApproval(report, approval, process.env);
      if (outcome.decision !== 'GO') {
        process.stderr.write('Production: NO-GO (' + outcome.reasons.join('; ') + ')\n');
        process.exitCode = 1;
      } else {
        process.stdout.write('Production: GO for explicitly confirmed local manual apply only; human host evidence is operator-attested.\n');
      }
    } else {
      throw new Error('Unsupported production readiness mode');
    }
  } catch {
    process.stderr.write('Production readiness guard: NO-GO (missing, malformed or untrusted evidence)\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
