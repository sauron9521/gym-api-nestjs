#!/usr/bin/env node
// Offline assertions for an operator-host digest deployment. Never echo Compose
// configuration: it contains database URLs and credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const ID = /^sha256:[a-f0-9]{64}$/;
const RUNTIME = /^ghcr\.io\/sauron9521\/gym-api-nestjs@sha256:[a-f0-9]{64}$/;
const MIGRATE = /^ghcr\.io\/sauron9521\/gym-api-nestjs-migrate@sha256:[a-f0-9]{64}$/;

export function validateIdentity(input) {
  const id = {
    runtime: input?.DEPLOY_RUNTIME_IMAGE,
    migrate: input?.DEPLOY_MIGRATE_IMAGE,
    sourceSha: input?.SOURCE_SHA,
    publisherSha: input?.PUBLISH_SHA,
    previous: input?.EXPECTED_CURRENT_IMAGE,
  };
  assert.match(id.runtime ?? '', RUNTIME, 'Runtime ref must be a verified GHCR digest');
  assert.match(id.migrate ?? '', MIGRATE, 'Migrate ref must be a verified GHCR digest');
  assert.match(id.sourceSha ?? '', SHA, 'Source SHA required');
  assert.match(id.publisherSha ?? '', SHA, 'Publisher signer SHA required');
  assert.ok(id.previous === 'none' || RUNTIME.test(id.previous ?? ''),
    'Exact expected currently running image required (or none for first deploy)');
  assert.notEqual(id.previous, id.runtime, 'New runtime already deployed');
  return id;
}

export function validateCompose(config, id) {
  const api = config?.services?.api;
  const migrate = config?.services?.migrate;
  assert.ok(api && migrate, 'Both services are required');
  assert.equal(api.image, id.runtime);
  assert.equal(migrate.image, id.migrate);
  assert.ok(!Object.hasOwn(api, 'build') && !Object.hasOwn(migrate, 'build'),
    'Never allow Compose builds in digest deployment');
  assert.equal(api.read_only, true);
  assert.equal(api.init, true);
  assert.equal(api.restart, 'unless-stopped');
  assert.equal(migrate.restart, 'no');
  assert.ok(api.cap_drop?.includes('ALL') && migrate.cap_drop?.includes('ALL'));
  assert.ok(api.security_opt?.includes('no-new-privileges:true') &&
    migrate.security_opt?.includes('no-new-privileges:true'));
  assert.equal(Number(api.mem_limit), 1073741824);
  assert.equal(Number(api.memswap_limit), 1073741824);
  assert.equal(Number(api.cpus), 2);
  assert.equal(Number(api.pids_limit), 256);
  assert.equal(api.ports?.length, 1);
  assert.equal(api.ports[0].host_ip, '127.0.0.1');
  assert.equal(Number(api.ports[0].target), 3000);
  assert.ok(api.volumes?.some(v => v.target === '/app/uploads/avatars' &&
    v.type === 'volume'), 'Persistent avatar volume is missing');
  assert.ok(migrate.profiles?.includes('ops'), 'Migration must stay opt-in');
  return true;
}

export function validatePulled(image, ref, sourceSha) {
  assert.match(ref, /@sha256:[a-f0-9]{64}$/);
  assert.match(image?.Id ?? '', ID, 'Unexpected image config ID');
  assert.equal(image?.Config?.User, 'node', 'Image must run non-root');
  assert.equal(image?.Config?.Labels?.['org.opencontainers.image.revision'],
    sourceSha, 'Wrong source revision');
  assert.equal(image?.Os, 'linux');
  assert.equal(image?.Architecture, 'amd64');
  assert.ok(image?.RepoDigests?.includes(ref), 'Pulled image digest mismatch');
  return true;
}

export function validateCurrent(actual, expected) {
  assert.ok(expected === 'none' || RUNTIME.test(expected ?? ''));
  assert.equal(actual || 'none', expected,
    'Running image differs from the version approved by the operator');
  return true;
}

async function jsonStdin() {
  let raw = '';
  for await (const part of process.stdin) {
    raw += part;
    assert.ok(raw.length < 2_000_000, 'Compose output too large');
  }
  return JSON.parse(raw);
}

function inspect(ref) {
  return JSON.parse(execFileSync('docker', [
    'image', 'inspect', '--format', '{{json .}}', ref,
  ], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore','pipe','ignore'] }));
}

async function main() {
  try {
    const id = validateIdentity(process.env);
    const mode = process.argv[2];
    if (mode === 'refs' && process.argv.length === 3) {
      process.stdout.write('Digest references and source identities validated\n');
    } else if (mode === 'compose' && process.argv.length === 3) {
      validateCompose(await jsonStdin(), id);
      process.stdout.write('Production Compose security and no-build policy validated\n');
    } else if (mode === 'images' && process.argv.length === 3) {
      validatePulled(inspect(id.runtime), id.runtime, id.sourceSha);
      validatePulled(inspect(id.migrate), id.migrate, id.sourceSha);
      process.stdout.write('Both image digests and revision labels validated\n');
    } else if (mode === 'current' && process.argv.length === 4) {
      validateCurrent(process.argv[3], id.previous);
      process.stdout.write('Running image matches approved previous digest\n');
    } else {
      throw new Error('Unknown deployment operation');
    }
  } catch {
    process.stderr.write('Production digest guard rejected the operation\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
