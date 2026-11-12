import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  validateStagingRequest, verifyPulledImage, verifyHealthResponse, makeReceipt,
} from './staging-smoke.mjs';

const runtime = 'ghcr.io/sauron9521/gym-api-nestjs@sha256:' + 'a'.repeat(64);
const migrate = 'ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:' + 'b'.repeat(64);
const sha = 'c'.repeat(40);
const publisher = 'd'.repeat(40);
const env = {
  GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ID: '12345678901',
  CONFIRM_STAGING: 'RUN_EPHEMERAL_STAGING',
  DEPLOY_RUNTIME_IMAGE: runtime, DEPLOY_MIGRATE_IMAGE: migrate,
  SOURCE_SHA: sha, PUBLISH_SHA: publisher,
};

test('manual staging only accepts exact repository digests, branch and approval', () => {
  assert.equal(validateStagingRequest(env).runtime, runtime);
  assert.equal(validateStagingRequest(env).publisherSha, publisher);
  for (const bad of [
    { GITHUB_REF: 'refs/heads/feature/test' },
    { GITHUB_REF: 'refs/pull/160/merge' },
    { CONFIRM_STAGING: 'NO_STAGING_RUN' },
    { CONFIRM_STAGING: '' },
    { DEPLOY_RUNTIME_IMAGE: runtime.replace('@sha256:', ':latest') },
    { DEPLOY_MIGRATE_IMAGE: runtime },
    { DEPLOY_RUNTIME_IMAGE: runtime.replace('sauron9521', 'attacker') },
    { DEPLOY_MIGRATE_IMAGE: migrate.replace('ghcr.io', 'docker.io') },
    { DEPLOY_RUNTIME_IMAGE: runtime.slice(0, -3) },
    { SOURCE_SHA: 'main' }, { PUBLISH_SHA: '' },
    { GITHUB_RUN_ID: 'not-an-id' },
  ]) assert.throws(() => validateStagingRequest({ ...env, ...bad }));
});

test('both pulled images need exact digest, revision, platform and non-root user', () => {
  const image = {
    Id: 'sha256:' + 'e'.repeat(64), RepoDigests: [runtime],
    Config: { User: 'node', Labels: {
      'org.opencontainers.image.revision': sha,
    } }, Os: 'linux', Architecture: 'amd64',
  };
  assert.equal(verifyPulledImage(image, runtime, sha).imageId, image.Id);
  for (const bad of [
    { Id: 'wrong' }, { RepoDigests: [] }, { RepoDigests: [migrate] },
    { Os: 'windows' }, { Architecture: 'arm64' },
    { Config: { User: 'root', Labels: image.Config.Labels } },
    { Config: { User: 'node', Labels: {
      'org.opencontainers.image.revision': publisher,
    } } },
  ]) assert.throws(() => verifyPulledImage({ ...image, ...bad }, runtime, sha));
});

test('health probes require HTTP 200 and status ok', () => {
  assert.deepEqual(verifyHealthResponse('ready', 200, { status: 'ok' }),
    { statusCode: 200, status: 'ok' });
  assert.deepEqual(verifyHealthResponse('live', 200, { status: 'ok' }),
    { statusCode: 200, status: 'ok' });
  for (const [path, status, body] of [
    ['live', 404, { status: 'ok' }],
    ['ready', 503, { status: 'error' }],
    ['ready', 200, { status: 'error' }],
    ['admin', 200, { status: 'ok' }],
  ]) assert.throws(() => verifyHealthResponse(path, status, body));
});

test('safe staging evidence requires both endpoints, healthy Docker and migration', () => {
  const results = {
    migrations: 'success', dockerHealth: 'healthy',
    runtimeImageId: 'sha256:' + 'e'.repeat(64),
    migrateImageId: 'sha256:' + 'f'.repeat(64),
    endpoints: {
      live: { statusCode: 200, status: 'ok' },
      ready: { statusCode: 200, status: 'ok' },
    },
  };
  const r = makeReceipt(env, 'passed', results);
  assert.equal(r.status, 'passed');
  assert.equal(r.kind, 'ephemeral-github-hosted-staging-rehearsal');
  assert.equal(r.productionContacted, false);
  assert.equal(r.deploymentPerformed, false);
  assert.equal(r.rollbackPerformed, false);
  assert.equal(r.sourceSha, sha);
  assert.equal(r.publisherSha, publisher);
  assert.ok(!JSON.stringify(r).includes('DATABASE_URL'));
  assert.equal(makeReceipt(env, 'failed').status, 'failed');
  for (const change of [
    { migrations: 'failed' }, { dockerHealth: 'unhealthy' },
    { runtimeImageId: 'invalid' },
    { endpoints: { live: results.endpoints.live } },
    { endpoints: { ...results.endpoints,
      ready: { statusCode: 503, status: 'error' } } },
  ]) assert.throws(() => makeReceipt(env, 'passed', { ...results, ...change }));
});

test('workflow is manual only with signed digest checks and disposable cleanup', async () => {
  const workflow = await readFile(new URL('../.github/workflows/staging-ghcr.yml', import.meta.url), 'utf8');
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule|workflow_run):/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /packages: read/);
  assert.match(workflow, /attestations: read/);
  assert.doesNotMatch(workflow, /packages: write|id-token: write|secrets\./);
  assert.doesNotMatch(workflow, /docker build|docker push|kubectl|ssh |docker compose up/);
  assert.match(workflow, /gh attestation verify "oci:\/\/\$ref"/);
  assert.match(workflow, /--source-digest "\$PUBLISH_SHA"/);
  assert.match(workflow, /--predicate-type "\$predicate"/);
  assert.match(workflow, /docker pull --platform linux\/amd64/);
  assert.match(workflow, /-p 127\.0\.0\.1:31848:3000/);
  assert.match(workflow, /--read-only --tmpfs \/tmp:/);
  assert.match(workflow, /-e REDIS_URL="\$STAGING_REDIS_URL"/);
  assert.match(workflow, /docker rm -fv "\$STAGING_API" "\$STAGING_DB" "\$STAGING_REDIS"/);
  assert.match(workflow, /docker volume rm -f "\$STAGING_AVATARS"/);
  assert.match(workflow, /docker network rm "\$STAGING_NETWORK"/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(ci, /node --test scripts\/staging-smoke\.test\.mjs/);
});
