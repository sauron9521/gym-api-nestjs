#!/usr/bin/env node
// Manual GHCR staging rehearsal: report only, never connects to a live host.
// Contains no production credentials and never prints container environments.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const RUNTIME = /^ghcr\.io\/sauron9521\/gym-api-nestjs@sha256:[a-f0-9]{64}$/;
const MIGRATE = /^ghcr\.io\/sauron9521\/gym-api-nestjs-migrate@sha256:[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const HEALTH = ['live', 'ready'];

export function validateStagingRequest(env) {
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Only main is trusted');
  assert.equal(env.CONFIRM_STAGING, 'RUN_EPHEMERAL_STAGING', 'Explicit approval required');
  assert.match(env.DEPLOY_RUNTIME_IMAGE ?? '', RUNTIME, 'Invalid runtime digest reference');
  assert.match(env.DEPLOY_MIGRATE_IMAGE ?? '', MIGRATE, 'Invalid migration digest reference');
  assert.match(env.SOURCE_SHA ?? '', SHA, 'Invalid release source SHA');
  assert.match(env.PUBLISH_SHA ?? '', SHA, 'Invalid publishing workflow signer SHA');
  assert.match(String(env.GITHUB_RUN_ID ?? ''), /^[1-9][0-9]{0,15}$/, 'Invalid run ID');
  return {
    runtime: env.DEPLOY_RUNTIME_IMAGE,
    migrate: env.DEPLOY_MIGRATE_IMAGE,
    sourceSha: env.SOURCE_SHA,
    publisherSha: env.PUBLISH_SHA,
    runId: String(env.GITHUB_RUN_ID),
  };
}

export function verifyPulledImage(image, reference, sourceSha) {
  assert.match(reference, /@sha256:[a-f0-9]{64}$/, 'Unpinned reference');
  assert.match(image?.Id ?? '', IMAGE_ID, 'Missing image config digest');
  assert.equal(image?.Config?.User, 'node', 'Image is not the approved non-root build');
  assert.equal(image?.Config?.Labels?.['org.opencontainers.image.revision'], sourceSha,
    'Image revision differs from signed release');
  assert.equal(image?.Os, 'linux', 'Unexpected platform OS');
  assert.equal(image?.Architecture, 'amd64', 'Unexpected platform architecture');
  assert.ok(Array.isArray(image?.RepoDigests) &&
    image.RepoDigests.includes(reference), 'Registry digest mismatch');
  return { imageId: image.Id, reference };
}

export function verifyHealthResponse(path, responseStatus, body) {
  assert.ok(HEALTH.includes(path), 'Unsupported health path');
  assert.equal(responseStatus, 200, 'Health endpoint not ready');
  assert.equal(body?.status, 'ok', 'Unexpected health response');
  return { statusCode: responseStatus, status: 'ok' };
}

export function makeReceipt(input, outcome, results = {}) {
  const request = validateStagingRequest(input);
  assert.ok(outcome === 'passed' || outcome === 'failed');
  if (outcome === 'passed') {
    assert.equal(results.dockerHealth, 'healthy');
    assert.deepEqual(Object.keys(results.endpoints).sort(), ['live', 'ready']);
    for (const name of HEALTH) {
      verifyHealthResponse(name, results.endpoints[name].statusCode,
        results.endpoints[name]);
    }
    assert.match(results.runtimeImageId ?? '', IMAGE_ID);
    assert.match(results.migrateImageId ?? '', IMAGE_ID);
    assert.equal(results.migrations, 'success');
  }
  return {
    schemaVersion: 1,
    kind: 'ephemeral-github-hosted-staging-rehearsal',
    status: outcome,
    runId: request.runId,
    sourceSha: request.sourceSha,
    publisherSha: request.publisherSha,
    runtime: request.runtime,
    migrate: request.migrate,
    ... (outcome === 'passed' ? {
      migrations: 'success',
      runtimeImageId: results.runtimeImageId,
      migrateImageId: results.migrateImageId,
      dockerHealth: 'healthy',
      endpoints: results.endpoints,
    } : {}),
    productionContacted: false,
    deploymentPerformed: false,
    rollbackPerformed: false,
  };
}

function inspect(ref) {
  return JSON.parse(execFileSync('docker', [
    'image', 'inspect', '--format', '{{json .}}', ref,
  ], { encoding: 'utf8', timeout: 30_000,
    stdio: ['ignore', 'pipe', 'ignore'] }));
}

function dockerHealth(name) {
  return execFileSync('docker', [
    'inspect', '--format', '{{.State.Health.Status}}', name,
  ], { encoding: 'utf8', timeout: 20_000,
    stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

async function checkEndpoints() {
  const results = {};
  for (const path of HEALTH) {
    const response = await fetch('http://127.0.0.1:31848/health/' + path, {
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    });
    const data = await response.json();
    results[path] = verifyHealthResponse(path, response.status, data);
  }
  return results;
}

async function writeReceipt(receipt) {
  await mkdir('staging', { recursive: true, mode: 0o700 });
  await writeFile('staging/evidence.json', JSON.stringify(receipt, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  const line = receipt.status === 'passed'
    ? 'Ephemeral signed GHCR image + Prisma migration + HTTP readiness smoke passed.'
    : 'Ephemeral staging rehearsal failed or did not finish.';
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      '### Signed GHCR staging rehearsal\n' +
      'Result: ' + receipt.status + '\n' +
      'Source SHA: ' + receipt.sourceSha + '\n' +
      'Publish SHA: ' + receipt.publisherSha + '\n' +
      'Runtime: ' + receipt.runtime + '\n' +
      'Migrate: ' + receipt.migrate + '\n' +
      line + '\n' +
      'This is a disposable test, not staging-host or production deployment.\n');
  }
}

async function main() {
  try {
    const mode = process.argv[2];
    const request = validateStagingRequest(process.env);
    if (mode === 'identity') {
      process.stdout.write('Signed staging request identities validated\n');
    } else if (mode === 'images') {
      const runtime = verifyPulledImage(inspect(request.runtime),
        request.runtime, request.sourceSha);
      const migrate = verifyPulledImage(inspect(request.migrate),
        request.migrate, request.sourceSha);
      assert.notEqual(runtime.imageId, migrate.imageId,
        'Runtime and migration images must be distinct');
      process.stdout.write('Both immutable image digests and source labels verified\n');
    } else if (mode === 'probe') {
      const health = dockerHealth(process.env.STAGING_API);
      const endpoints = await checkEndpoints();
      const runtime = verifyPulledImage(inspect(request.runtime),
        request.runtime, request.sourceSha);
      const migrate = verifyPulledImage(inspect(request.migrate),
        request.migrate, request.sourceSha);
      await writeReceipt(makeReceipt(process.env, 'passed', {
        dockerHealth: health, endpoints,
        migrations: 'success',
        runtimeImageId: runtime.imageId, migrateImageId: migrate.imageId,
      }));
      process.stdout.write('Isolated staging ready/live HTTP checks passed\n');
    } else if (mode === 'failed') {
      try {
        await access('staging/evidence.json');
      } catch {
        await writeReceipt(makeReceipt(process.env, 'failed'));
      }
      process.stdout.write('Failure receipt recorded without credentials\n');
    } else {
      throw new Error('Unknown mode');
    }
  } catch {
    process.stderr.write('Signed GHCR staging smoke validation failed\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
