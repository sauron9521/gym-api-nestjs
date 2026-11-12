import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { buildManifest } from './release-bundle.mjs';
import {
  parsePromotionOptions, publicationTargets, preflight, targetAbsent,
  validateReleaseRun, verifyRemoteImage, verifyPublishedImages,
} from './ghcr-promotion.mjs';

const repo = 'sauron9521/gym-api-nestjs';
const sha = 'abcdef0123456789abcdef0123456789abcdef01';
const runId = '456789';
const opts = { repository: repo, 'source-sha': sha, 'release-run-id': runId };
const runtimeId = 'sha256:' + 'a'.repeat(64);
const migrateId = 'sha256:' + 'b'.repeat(64);
const runtimeDigest = 'sha256:' + 'c'.repeat(64);
const migrateDigest = 'sha256:' + 'd'.repeat(64);
const tags = publicationTargets(repo, sha, runId);
const manifest = buildManifest({
  commit: sha, repository: repo, runId, runtimeId, migrateId,
  baseImage: 'node@sha256:' + 'e'.repeat(64),
}, { sha256: 'f'.repeat(64), bytes: 120_000 });
const successful = {
  id: Number(runId), repository: { full_name: repo },
  head_sha: sha, head_branch: 'main', event: 'workflow_dispatch',
  status: 'completed', conclusion: 'success',
  path: '.github/workflows/release-artifacts.yml',
};

test('promotion requires exact successful manual release run on main', () => {
  assert.equal(validateReleaseRun(successful, opts), true);
  for (const change of [
    { id: 1234 }, { head_sha: '0'.repeat(40) }, { head_branch: 'release' },
    { status: 'in_progress' }, { conclusion: 'failure' },
    { conclusion: 'cancelled' }, { event: 'pull_request' },
    { path: '.github/workflows/ci.yml' },
    { repository: { full_name: 'another/project' } },
  ]) {
    assert.throws(() => validateReleaseRun({ ...successful, ...change }, opts));
  }
  assert.equal(validateReleaseRun({
    ...successful, path: repo + '/.github/workflows/release-artifacts.yml@refs/heads/main',
  }, opts), true);
});

test('promotion arguments and SHA-run tags reject malformed identities', () => {
  assert.deepEqual(parsePromotionOptions([
    'validate-run', '--repository', repo,
    '--source-sha', sha, '--release-run-id', runId,
    '--run-json', '/tmp/run.json',
  ]), { command: 'validate-run', ...opts, 'run-json': '/tmp/run.json' });
  assert.deepEqual(tags, {
    runtime: 'ghcr.io/sauron9521/gym-api-nestjs:sha-' + sha + '-run-' + runId,
    migrate: 'ghcr.io/sauron9521/gym-api-nestjs-migrate:sha-' + sha + '-run-' + runId,
  });
  for (const bad of [
    ['targets', '--repository', repo, '--source-sha', 'main', '--release-run-id', runId],
    ['targets', '--repository', 'foo/../../secret', '--source-sha', sha,
      '--release-run-id', runId],
    ['targets', '--repository', repo, '--source-sha', sha, '--release-run-id', '0'],
    ['targets', '--repository', repo, '--source-sha', sha, '--release-run-id', runId,
      '--run-json', 'unwanted'],
  ]) assert.throws(() => parsePromotionOptions(bad));
});

test('GHCR preflight only authorizes explicit 404 from registry with pull token', async () => {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith('https://ghcr.io/token?')) {
      return { status: 200, json: async () => ({ token: 'scoped-test-token' }) };
    }
    return { status: 404 };
  };
  assert.deepEqual(await preflight(opts, 'actions-user', 'test-secret', fetchMock), tags);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url.includes('scope=repository%3Asauron9521%2Fgym-api-nestjs%3Apull'), true);
  assert.equal(calls[1].init.method, 'HEAD');
  assert.equal(calls[1].init.redirect, 'error');
  assert.equal(calls[1].init.headers.authorization, 'Bearer scoped-test-token');
  assert.doesNotMatch(calls.map(c => c.url).join(' '), /test-secret/);

  const exists = async (url) => String(url).includes('/token?')
    ? { status: 200, json: async () => ({ token: 'token' }) }
    : { status: 200 };
  await assert.rejects(targetAbsent(tags.runtime, 'actions-user', 'secret', exists),
    /existing GHCR tag/);
  for (const status of [401, 403, 429, 500]) {
    const bad = async (url) => String(url).includes('/token?')
      ? { status: 200, json: async () => ({ token: 'token' }) }
      : { status };
    await assert.rejects(targetAbsent(tags.runtime, 'actions-user', 'secret', bad),
      /inconclusive/);
  }
  await assert.rejects(targetAbsent(tags.runtime, '', 'secret', fetchMock),
    /credentials/);
  await assert.rejects(targetAbsent(tags.runtime, 'user', '', fetchMock),
    /credentials/);
});

test('post-publication digest must match exact image config, source and namespace', () => {
  const imageFor = (tag) => ({
    Id: tag === tags.runtime ? runtimeId : migrateId,
    Config: { User: 'node', Labels: {
      'org.opencontainers.image.revision': sha,
    } },
    RepoDigests: [(tag.split(':')[0]) + '@' +
      (tag === tags.runtime ? runtimeDigest : migrateDigest)],
  });
  assert.deepEqual(verifyPublishedImages(manifest, opts, imageFor), {
    runtime: 'ghcr.io/sauron9521/gym-api-nestjs@' + runtimeDigest,
    migrate: 'ghcr.io/sauron9521/gym-api-nestjs-migrate@' + migrateDigest,
  });
  const runtime = imageFor(tags.runtime);
  assert.equal(verifyRemoteImage(tags.runtime, manifest.images.runtime, sha, runtime),
    'ghcr.io/sauron9521/gym-api-nestjs@' + runtimeDigest);
  for (const invalid of [
    { ...runtime, Id: migrateId },
    { ...runtime, Config: { User: 'root', Labels: {
      'org.opencontainers.image.revision': sha } } },
    { ...runtime, Config: { User: 'node', Labels: {
      'org.opencontainers.image.revision': 'f'.repeat(40) } } },
    { ...runtime, RepoDigests: ['ghcr.io/other/repo@' + runtimeDigest] },
    { ...runtime, RepoDigests: [] },
  ]) {
    assert.throws(() => verifyRemoteImage(
      tags.runtime, manifest.images.runtime, sha, invalid,
    ));
  }
});

test('publish workflow is explicitly manual, does not build and never deploys', async () => {
  const file = await readFile(new URL(
    '../.github/workflows/publish-ghcr.yml', import.meta.url,
  ), 'utf8');
  assert.match(file, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(file, /^\s+(push|pull_request|release):/m);
  assert.match(file, /github\.ref == 'refs\/heads\/main'/);
  assert.match(file, /packages: write/);
  assert.match(file, /CI \/ required gates/);
  assert.match(file, /gh attestation verify/);
  assert.match(file, /--source-digest/);
  assert.match(file, /scripts\/release-bundle.mjs verify-images/);
  assert.match(file, /scripts\/ghcr-promotion.mjs preflight/);
  assert.match(file, /docker push/);
  assert.match(file, /docker pull/);
  assert.doesNotMatch(file, /docker build |docker compose|gh release create|ghcr\.io\/.*:latest/);
});
