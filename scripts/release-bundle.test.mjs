import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  archiveFingerprint, buildManifest, createBundle, loadManifest,
  parseOptions, releaseImageTags, validateManifest, verifyBundle,
  verifyLoadedImages,
} from './release-bundle.mjs';

const commit = 'abcdef0123456789abcdef0123456789abcdef01';
const idRuntime = 'sha256:' + 'a'.repeat(64);
const idMigrate = 'sha256:' + 'b'.repeat(64);
const baseImage = 'node@sha256:' + 'c'.repeat(64);
const options = {
  command: 'create',
  archive: '/tmp/images.tar.gz',
  manifest: '/tmp/manifest.json',
  commit,
  repository: 'sauron9521/gym-api-nestjs',
  'run-id': '123456',
  'runtime-id': idRuntime,
  'migrate-id': idMigrate,
  'base-image': baseImage,
};

test('release options refuse missing context, malicious tags and unknown switches', () => {
  assert.deepEqual(parseOptions([
    'create', ...Object.entries(options)
      .filter(([k]) => k !== 'command')
      .flatMap(([k, v]) => ['--' + k, v]),
  ]), options);
  for (const invalid of [
    ['create'],
    ['create', '--commit', 'main'],
    ['verify', '--archive', '/tmp/a.tar.gz', '--manifest', '/tmp/manifest.json',
      '--commit', commit, '--repository', options.repository, '--run-id', '123'],
    ['verify-images', '--manifest', '/tmp/manifest.json', '--commit', commit,
      '--repository', options.repository, '--run-id', '0'],
    ['create', '--archive', '/tmp/images.tar.gz', '--archive', '/tmp/images.tar.gz'],
  ]) assert.throws(() => parseOptions(invalid));
  assert.throws(() => releaseImageTags('main'));
});

test('manifest generation is SHA-bound to commit, base and docker config IDs', () => {
  const manifest = buildManifest({
    commit,
    repository: options.repository,
    runId: options['run-id'],
    runtimeId: idRuntime,
    migrateId: idMigrate,
    baseImage,
  }, { sha256: 'd'.repeat(64), bytes: 123 });
  assert.equal(manifest.source.ref, 'refs/heads/main');
  assert.equal(manifest.images.runtime.tag, 'gym-api:runtime-' + commit);
  assert.equal(manifest.images.migrate.id, idMigrate);
  assert.equal(manifest.baseImage, baseImage);
  assert.throws(() => validateManifest(
    { ...manifest, source: { ...manifest.source, commit: 'e'.repeat(40) } },
    options,
  ));
  assert.throws(() => validateManifest(
    { ...manifest, images: { ...manifest.images,
      runtime: { ...manifest.images.runtime, tag: 'gym-api:latest' } } },
    options,
  ));
  assert.throws(() => buildManifest({ ...options, runtimeId: idRuntime,
    migrateId: idMigrate, baseImage }, { sha256: 'wrong', bytes: 123 }));
});

test('release bundle hashes archive bytes, catches corruption and prevents overwrite', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gym-release-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = join(dir, 'images.tar.gz');
  const path = join(dir, 'manifest.json');
  const args = { ...options, archive, manifest: path };
  await writeFile(archive, 'test-release-image-archive-bytes');
  const manifest = await createBundle(args);
  assert.deepEqual(manifest.archive, {
    filename: 'images.tar.gz',
    ...(await archiveFingerprint(archive)),
  });
  assert.deepEqual(await loadManifest(path, args), manifest);
  assert.deepEqual(await verifyBundle(args), manifest);
  assert.equal((await readFile(path, 'utf8')).endsWith('\n'), true);
  await assert.rejects(createBundle(args));
  await writeFile(archive, 'one-byte-different');
  await assert.rejects(verifyBundle(args), /digest mismatch/);
  await assert.rejects(verifyBundle({ ...args, commit: 'f'.repeat(40) }));
});

test('archive image load must match IDs, non-root runtime and source revision', () => {
  const manifest = buildManifest({
    commit, repository: options.repository, runId: options['run-id'],
    runtimeId: idRuntime, migrateId: idMigrate, baseImage,
  }, { sha256: 'd'.repeat(64), bytes: 123 });
  const mock = (tag) => ({
    id: tag.includes(':runtime-') ? idRuntime : idMigrate,
    user: 'node',
    revision: commit,
  });
  assert.equal(verifyLoadedImages(manifest, mock), true);
  assert.throws(() => verifyLoadedImages(manifest, () => ({
    id: idRuntime, user: 'root', revision: commit,
  })), /identity mismatch/);
  assert.throws(() => verifyLoadedImages(manifest, () => ({
    id: idMigrate, user: 'node', revision: 'f'.repeat(40),
  })), /identity mismatch/);
});

test('release workflow is manual-only, provenance-attested and source-gated', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/release-artifacts.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request):/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /CI \/ required gates/);
  assert.match(workflow, /actions\/attest@v4/);
  assert.match(workflow, /--source-digest/);
  assert.match(workflow, /--source-ref/);
  assert.match(workflow, /actions\/download-artifact@v8/);
  assert.match(workflow, /--target runtime/);
  assert.match(workflow, /--target migrate/);
  assert.doesNotMatch(workflow, /docker push|gh release create/);
});
