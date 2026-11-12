#!/usr/bin/env node
// Manual two-release rehearsal. Strictly isolated to a disposable GitHub runner.
// Only known GHCR digest references may be used; no production credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { verifyPulledImage } from './staging-smoke.mjs';

const RUNTIME = /^ghcr\.io\/sauron9521\/gym-api-nestjs@sha256:[a-f0-9]{64}$/;
const MIGRATE = /^ghcr\.io\/sauron9521\/gym-api-nestjs-migrate@sha256:[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const RUN_ID = /^[1-9][0-9]{0,15}$/;
const STATE = 'staging/upgrade-phase-state.json';
const EVIDENCE = 'staging/upgrade-evidence.json';

export const PHASES = Object.freeze([
  'previous-migrated',
  'previous-authenticated',
  'backup-verified',
  'target-migrated',
  'previous-compatible-with-target-schema',
  'target-authenticated',
  'previous-restored-without-schema-rollback',
]);

export function validateUpgradeRequest(env) {
  assert.equal(env?.GITHUB_REF, 'refs/heads/main', 'Only main can run the rehearsal');
  assert.equal(env?.CONFIRM_UPGRADE, 'REHEARSE_SIGNED_UPGRADE_ROLLBACK',
    'Manual upgrade/rollback approval required');
  assert.match(String(env?.GITHUB_RUN_ID ?? ''), RUN_ID, 'Missing run identity');

  function pair(prefix) {
    const runtime = env[prefix + '_RUNTIME_IMAGE'];
    const migrate = env[prefix + '_MIGRATE_IMAGE'];
    const sourceSha = env[prefix + '_SOURCE_SHA'];
    const publishSha = env[prefix + '_PUBLISH_SHA'];
    assert.match(runtime ?? '', RUNTIME, 'Invalid signed runtime image');
    assert.match(migrate ?? '', MIGRATE, 'Invalid signed migration image');
    assert.match(sourceSha ?? '', SHA, 'Invalid signed source SHA');
    assert.match(publishSha ?? '', SHA, 'Invalid signer SHA');
    return { runtime, migrate, sourceSha, publishSha };
  }

  const previous = pair('PREVIOUS');
  const target = pair('TARGET');
  assert.notEqual(previous.sourceSha, target.sourceSha,
    'Upgrade must use two distinct signed source commits');
  assert.notEqual(previous.runtime, target.runtime,
    'Upgrade must use two different runtime digests');
  assert.notEqual(previous.migrate, target.migrate,
    'Upgrade must use two different migration digests');
  return {
    runId: String(env.GITHUB_RUN_ID),
    previous, target,
  };
}

export function validateProgress(progress, request) {
  assert.equal(progress?.runId, request.runId, 'Receipt from another run');
  assert.deepEqual(progress?.previous, request.previous,
    'Previous signed image identity changed');
  assert.deepEqual(progress?.target, request.target,
    'Target signed image identity changed');
  assert.ok(Array.isArray(progress?.completed), 'Missing completed stages');
  assert.ok(progress.completed.length <= PHASES.length);
  for (let i = 0; i < progress.completed.length; i++) {
    assert.equal(progress.completed[i], PHASES[i],
      'Rehearsal stages must execute in approved order');
  }
  return progress;
}

export function advanceProgress(progress, phase, request) {
  const current = progress ? validateProgress(progress, request) : {
    runId: request.runId, previous: request.previous, target: request.target,
    completed: [],
  };
  assert.equal(phase, PHASES[current.completed.length],
    'Cannot skip, repeat or reorder upgrade/rollback stages');
  return { ...current, completed: [...current.completed, phase] };
}

export function createUpgradeReceipt(request, progress, status) {
  assert.ok(['passed', 'failed'].includes(status), 'Unknown result');
  if (progress) validateProgress(progress, request);
  if (status === 'passed') {
    assert.deepEqual(progress?.completed, PHASES,
      'A successful rehearsal requires all seven stages');
  }
  return {
    schemaVersion: 1,
    kind: 'disposable-two-signed-release-upgrade-rollback',
    result: status,
    runId: request.runId,
    previous: request.previous,
    target: request.target,
    checks: (progress?.completed ?? []).map(stage => ({
      stage, result: 'passed',
    })),
    databaseBackup: status === 'passed' ? 'test-only-verified' : 'unknown',
    rollback: status === 'passed'
      ? 'previous-runtime-on-target-schema' : 'not-confirmed',
    databaseDowngradePerformed: false,
    productionContacted: false,
    deployedToPersistentHost: false,
    authenticatedFunctionalChecks: status === 'passed',
    productionReleaseApproval: false,
  };
}

function inspect(ref) {
  return JSON.parse(execFileSync('docker', [
    'image', 'inspect', '--format', '{{json .}}', ref,
  ], { encoding: 'utf8', timeout: 30_000,
    stdio: ['ignore', 'pipe', 'ignore'] }));
}

async function readProgress(request, optional = false) {
  let progress;
  try {
    progress = JSON.parse(await readFile(STATE, 'utf8'));
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null;
    throw error;
  }
  return validateProgress(progress, request);
}

async function writeReceipt(receipt) {
  await mkdir('staging', { recursive: true, mode: 0o700 });
  await writeFile(EVIDENCE, JSON.stringify(receipt, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      '### Two signed GHCR releases — isolated staging upgrade/rollback\n' +
      'Status: ' + receipt.result + '\n' +
      'Previous runtime: ' + receipt.previous.runtime + '\n' +
      'Target runtime: ' + receipt.target.runtime + '\n' +
      'Completed stages: ' + receipt.checks.length + '/7\n' +
      'No production deployment, database downgrade or launch approval.\n');
  }
}

async function main() {
  try {
    const request = validateUpgradeRequest(process.env);
    const [mode, phase] = process.argv.slice(2);
    if (mode === 'identity') {
      process.stdout.write('Two signed, different release identities accepted\n');
    } else if (mode === 'images') {
      const images = [
        [request.previous.runtime, request.previous.sourceSha],
        [request.previous.migrate, request.previous.sourceSha],
        [request.target.runtime, request.target.sourceSha],
        [request.target.migrate, request.target.sourceSha],
      ];
      const IDs = images.map(([ref, sha]) =>
        verifyPulledImage(inspect(ref), ref, sha).imageId);
      assert.notEqual(IDs[0], IDs[2], 'Identical runtime image config IDs');
      assert.notEqual(IDs[1], IDs[3], 'Identical migration image config IDs');
      process.stdout.write('Four exact OCI digests and source labels verified\n');
    } else if (mode === 'mark') {
      const current = await readProgress(request, true);
      const next = advanceProgress(current, phase, request);
      await mkdir('staging', { recursive: true, mode: 0o700 });
      await writeFile(STATE, JSON.stringify(next), { mode: 0o600 });
      process.stdout.write('Validated signed staging phase: ' + phase + '\n');
    } else if (mode === 'finish') {
      const progress = await readProgress(request);
      await writeReceipt(createUpgradeReceipt(request, progress, 'passed'));
      process.stdout.write('Two-release staging upgrade/rollback rehearsal passed\n');
    } else if (mode === 'failed') {
      let exists = false;
      try { await readFile(EVIDENCE, 'utf8'); exists = true; }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      if (!exists) {
        const progress = await readProgress(request, true);
        await writeReceipt(createUpgradeReceipt(request, progress, 'failed'));
      }
      process.stdout.write('Safe incomplete-upgrade evidence stored\n');
    } else {
      throw new Error('Invalid upgrade rehearsal mode');
    }
  } catch {
    process.stderr.write('Two-release staging upgrade/rollback guard failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
