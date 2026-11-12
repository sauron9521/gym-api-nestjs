import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  PHASES, validateUpgradeRequest, validateProgress,
  advanceProgress, createUpgradeReceipt,
} from './staging-upgrade-rollback.mjs';

const previousRuntime = 'ghcr.io/sauron9521/gym-api-nestjs@sha256:' + 'a'.repeat(64);
const previousMigrate = 'ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:' + 'b'.repeat(64);
const targetRuntime = 'ghcr.io/sauron9521/gym-api-nestjs@sha256:' + 'c'.repeat(64);
const targetMigrate = 'ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:' + 'd'.repeat(64);
const env = {
  GITHUB_REF: 'refs/heads/main',
  GITHUB_RUN_ID: '1234567890',
  CONFIRM_UPGRADE: 'REHEARSE_SIGNED_UPGRADE_ROLLBACK',
  PREVIOUS_RUNTIME_IMAGE: previousRuntime,
  PREVIOUS_MIGRATE_IMAGE: previousMigrate,
  PREVIOUS_SOURCE_SHA: 'e'.repeat(40),
  PREVIOUS_PUBLISH_SHA: 'f'.repeat(40),
  TARGET_RUNTIME_IMAGE: targetRuntime,
  TARGET_MIGRATE_IMAGE: targetMigrate,
  TARGET_SOURCE_SHA: '1'.repeat(40),
  TARGET_PUBLISH_SHA: '2'.repeat(40),
};

test('manual guard enforces trusted main and four exact distinct signed image digests', () => {
  const request = validateUpgradeRequest(env);
  assert.equal(request.previous.runtime, previousRuntime);
  assert.equal(request.target.migrate, targetMigrate);
  assert.notEqual(request.previous.sourceSha, request.target.sourceSha);

  for (const changed of [
    { GITHUB_REF: 'refs/pull/162/merge' },
    { GITHUB_REF: 'refs/heads/other' },
    { GITHUB_RUN_ID: '-7' },
    { CONFIRM_UPGRADE: 'NO_REHEARSAL' },
    { CONFIRM_UPGRADE: '' },
    { PREVIOUS_RUNTIME_IMAGE: previousRuntime.replace('@sha256:', ':latest') },
    { TARGET_RUNTIME_IMAGE: previousRuntime },
    { TARGET_MIGRATE_IMAGE: previousMigrate },
    { PREVIOUS_MIGRATE_IMAGE: previousRuntime },
    { PREVIOUS_RUNTIME_IMAGE: previousRuntime.replace('sauron9521', 'attacker') },
    { TARGET_RUNTIME_IMAGE: targetRuntime.replace('ghcr.io', 'docker.io') },
    { PREVIOUS_SOURCE_SHA: 'main' },
    { TARGET_SOURCE_SHA: env.PREVIOUS_SOURCE_SHA },
    { TARGET_PUBLISH_SHA: '' },
  ]) assert.throws(() => validateUpgradeRequest({ ...env, ...changed }));
});

test('strict ordered seven-phase progress rejects skips, duplicates and changed identities', () => {
  const request = validateUpgradeRequest(env);
  let progress = null;
  for (const phase of PHASES) {
    progress = advanceProgress(progress, phase, request);
    assert.deepEqual(progress.completed, PHASES.slice(0, progress.completed.length));
    assert.equal(validateProgress(progress, request), progress);
  }
  assert.equal(progress.completed.length, 7);
  assert.throws(() => advanceProgress(progress, PHASES[6], request));
  assert.throws(() => advanceProgress(null, PHASES[1], request));
  assert.throws(() => validateProgress({
    ...progress, completed: [PHASES[1], PHASES[0]],
  }, request));
  assert.throws(() => validateProgress({ ...progress, runId: 'other' }, request));
  assert.throws(() => validateProgress({ ...progress,
    target: { ...request.target, runtime: previousRuntime },
  }, request));
});

test('a passed receipt requires all stages and never claims DB downgrade or deployment', () => {
  const request = validateUpgradeRequest(env);
  const completed = PHASES.reduce(
    (progress, phase) => advanceProgress(progress, phase, request), null);
  const receipt = createUpgradeReceipt(request, completed, 'passed');
  assert.equal(receipt.result, 'passed');
  assert.equal(receipt.runId, env.GITHUB_RUN_ID);
  assert.equal(receipt.checks.length, 7);
  assert.equal(receipt.databaseBackup, 'test-only-verified');
  assert.equal(receipt.rollback, 'previous-runtime-on-target-schema');
  assert.equal(receipt.productionContacted, false);
  assert.equal(receipt.productionReleaseApproval, false);
  assert.equal(receipt.databaseDowngradePerformed, false);
  assert.equal(receipt.deployedToPersistentHost, false);
  assert.ok(!JSON.stringify(receipt).includes('staging_only_ephemeral'));
  assert.ok(!JSON.stringify(receipt).includes('JWT_SECRET'));

  const incomplete = advanceProgress(null, PHASES[0], request);
  assert.throws(() => createUpgradeReceipt(request, incomplete, 'passed'));
  const failed = createUpgradeReceipt(request, incomplete, 'failed');
  assert.equal(failed.checks.length, 1);
  assert.equal(failed.rollback, 'not-confirmed');
  assert.equal(failed.productionReleaseApproval, false);
  assert.equal(createUpgradeReceipt(request, null, 'failed').result, 'failed');
  assert.throws(() => createUpgradeReceipt(request, completed, 'unknown'));
});

test('manual workflow verifies all four attestations and uses only ephemeral targets', async () => {
  const wf = await readFile(
    new URL('../.github/workflows/staging-upgrade-rollback.yml', import.meta.url),
    'utf8');
  const run = await readFile(
    new URL('./staging-upgrade-run.sh', import.meta.url), 'utf8');
  const ci = await readFile(
    new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');

  assert.match(wf, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(wf, /^\s+(push|pull_request|schedule|workflow_run):/m);
  assert.match(wf, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(wf, /REHEARSE_SIGNED_UPGRADE_ROLLBACK/);
  assert.match(wf, /--signer-workflow "\$GITHUB_REPOSITORY\/\.github\/workflows\/publish-ghcr\.yml"/);
  assert.match(wf, /--predicate-type "\$predicate"/);
  assert.match(wf, /--source-digest "\$publisher"/);
  assert.match(wf, /compare\/\$PREVIOUS_SOURCE_SHA\.\.\.\$TARGET_SOURCE_SHA/);
  assert.match(wf, /packages: read/);
  assert.match(wf, /attestations: read/);
  assert.doesNotMatch(wf, /packages: write|id-token: write|secrets\./);
  assert.doesNotMatch(wf, /docker build|docker push|kubectl|ssh |docker compose up/);

  const migrationStart = wf.indexOf('Apply previous signed Prisma migrations');
  const synthetic = wf.indexOf('node scripts/staging-functional-smoke.mjs exercise');
  const snapshot = wf.indexOf('pg_dump -U postgres');
  const newMigration = wf.indexOf('Apply new signed Prisma migrations');
  const oldCompatible = wf.indexOf('node scripts/staging-upgrade-rollback.mjs mark previous-compatible-with-target-schema');
  const switchTarget = wf.indexOf('scripts/staging-upgrade-run.sh switch-target');
  const targetCompatible = wf.indexOf('node scripts/staging-upgrade-rollback.mjs mark target-authenticated');
  const rollback = wf.indexOf('scripts/staging-upgrade-run.sh rollback-previous');
  const rollbackCheck = wf.indexOf('node scripts/staging-upgrade-rollback.mjs mark previous-restored-without-schema-rollback');
  const finish = wf.indexOf('node scripts/staging-upgrade-rollback.mjs finish');
  assert.ok(migrationStart > 0 && migrationStart < synthetic && synthetic < snapshot);
  assert.ok(snapshot < newMigration && newMigration < oldCompatible);
  assert.ok(oldCompatible < switchTarget && switchTarget < targetCompatible);
  assert.ok(targetCompatible < rollback && rollback < rollbackCheck && rollbackCheck < finish);
  assert.match(wf, /pg_restore --list/);
  assert.match(wf, /sha256sum --check --status/);
  assert.match(wf, /-p 127\.0\.0\.1:31848:3000|Start previous signed runtime on isolated loopback port/);
  assert.match(wf, /staging\/upgrade-evidence\.json/);
  assert.match(wf, /if: always\(\)/);
  assert.match(wf, /docker rm -fv "\$STAGING_API"/);
  assert.match(wf, /docker volume rm -f "\$STAGING_AVATARS"/);
  assert.match(wf, /docker network rm "\$STAGING_NETWORK"/);

  assert.match(run, /GITHUB_ACTIONS/);
  assert.match(run, /--pull never -d/);
  assert.match(run, /-p 127\.0\.0\.1:31848:3000/);
  assert.match(run, /--read-only --tmpfs \/tmp:/);
  assert.match(run, /--cap-drop ALL --security-opt no-new-privileges/);
  assert.match(run, /expected="\$TARGET_RUNTIME_IMAGE"/);
  assert.match(run, /expected="\$PREVIOUS_RUNTIME_IMAGE"/);
  assert.match(run, /docker stop --time 25/);
  assert.doesNotMatch(run, /pg_restore|migrate deploy|db reset|ssh |docker push/);
  assert.match(ci, /node --test scripts\/staging-upgrade-rollback\.test\.mjs/);
  assert.match(ci, /bash -n scripts\/staging-upgrade-run\.sh/);
  assert.match(ignore, /^\/staging\/upgrade-phase-state\.json$/m);
  assert.match(ignore, /^\/staging\/upgrade-evidence\.json$/m);
});
