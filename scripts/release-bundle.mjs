#!/usr/bin/env node
// Prepare and verify immutable release-candidate image archives.
// The manifest is descriptive; GitHub attestations separately sign its digest.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const ID = /^sha256:[a-f0-9]{64}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_ID = /^[1-9][0-9]{0,15}$/;
const BASE = /^[A-Za-z0-9_.\/-]+@sha256:[a-f0-9]{64}$/;
const FILENAME = 'images.tar.gz';

export function parseOptions(argv) {
  const [command, ...rest] = argv;
  if (!['create', 'verify', 'verify-images'].includes(command)) {
    throw new Error('Unknown release bundle operation');
  }
  const options = {};
  if (rest.length % 2) throw new Error('Release arguments must be key/value pairs');
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i], v = rest[i + 1];
    if (!/^--(archive|manifest|commit|repository|run-id|runtime-id|migrate-id|base-image)$/.test(k) ||
        Object.hasOwn(options, k) || !v || v.startsWith('--')) {
      throw new Error('Invalid release bundle argument');
    }
    options[k.slice(2)] = v;
  }
  const required = command === 'create'
    ? ['archive', 'manifest', 'commit', 'repository', 'run-id', 'runtime-id', 'migrate-id', 'base-image']
    : command === 'verify'
      ? ['archive', 'manifest', 'commit', 'repository', 'run-id']
      : ['manifest', 'commit', 'repository', 'run-id'];
  if (Object.keys(options).length !== required.length ||
      !required.every((k) => Object.hasOwn(options, k))) {
    throw new Error('Incomplete release bundle arguments');
  }
  if (!SHA.test(options.commit) || !REPO.test(options.repository) ||
      !RUN_ID.test(options['run-id']) ||
      (command === 'create' && (!ID.test(options['runtime-id']) ||
        !ID.test(options['migrate-id']) || !BASE.test(options['base-image'])))) {
    throw new Error('Invalid release identity');
  }
  if (command !== 'verify-images' && basename(options.archive) !== FILENAME) {
    throw new Error('Unexpected release archive filename');
  }
  if (basename(options.manifest) !== 'manifest.json') {
    throw new Error('Unexpected release manifest filename');
  }
  return { command, ...options };
}

export function releaseImageTags(commit) {
  if (!SHA.test(commit)) throw new Error('Invalid source revision');
  return {
    runtime: 'gym-api:runtime-' + commit,
    migrate: 'gym-api:migrate-' + commit,
  };
}

export async function archiveFingerprint(path) {
  const info = await stat(path);
  if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size === 0) {
    throw new Error('Invalid image archive');
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { sha256: hash.digest('hex'), bytes: info.size };
}

export function buildManifest(identity, archive) {
  const { commit, repository, runId, runtimeId, migrateId, baseImage } = identity;
  if (!SHA.test(commit) || !REPO.test(repository) || !RUN_ID.test(runId) ||
      !ID.test(runtimeId) || !ID.test(migrateId) || !BASE.test(baseImage) ||
      !/^[a-f0-9]{64}$/.test(archive?.sha256 ?? '') ||
      !Number.isSafeInteger(archive?.bytes) || archive.bytes <= 0) {
    throw new Error('Invalid release manifest fields');
  }
  const tags = releaseImageTags(commit);
  return {
    schemaVersion: 1,
    source: {
      repository, commit, ref: 'refs/heads/main', runId,
      workflow: '.github/workflows/release-artifacts.yml',
    },
    baseImage,
    images: {
      runtime: { tag: tags.runtime, id: runtimeId },
      migrate: { tag: tags.migrate, id: migrateId },
    },
    archive: { filename: FILENAME, sha256: archive.sha256, bytes: archive.bytes },
  };
}

export async function createBundle(opts) {
  const archive = await archiveFingerprint(opts.archive);
  const manifest = buildManifest({
    commit: opts.commit,
    repository: opts.repository,
    runId: opts['run-id'],
    runtimeId: opts['runtime-id'],
    migrateId: opts['migrate-id'],
    baseImage: opts['base-image'],
  }, archive);
  // Refuse accidental overwrite of a previous release's manifest.
  await writeFile(opts.manifest, JSON.stringify(manifest, null, 2) + '\n', {
    flag: 'wx', mode: 0o600,
  });
  return manifest;
}

export function validateManifest(manifest, expected) {
  if (manifest?.schemaVersion !== 1 || manifest?.source?.commit !== expected.commit ||
      manifest.source.repository !== expected.repository ||
      manifest.source.runId !== expected['run-id'] ||
      manifest.source.ref !== 'refs/heads/main' ||
      manifest.source.workflow !== '.github/workflows/release-artifacts.yml' ||
      !BASE.test(manifest.baseImage ?? '') ||
      !ID.test(manifest.images?.runtime?.id ?? '') ||
      !ID.test(manifest.images?.migrate?.id ?? '') ||
      manifest.images.runtime.tag !== releaseImageTags(expected.commit).runtime ||
      manifest.images.migrate.tag !== releaseImageTags(expected.commit).migrate ||
      manifest.archive?.filename !== FILENAME ||
      !/^[a-f0-9]{64}$/.test(manifest.archive.sha256 ?? '') ||
      !Number.isSafeInteger(manifest.archive.bytes) || manifest.archive.bytes <= 0) {
    throw new Error('Release manifest identity or schema mismatch');
  }
  return manifest;
}

export async function loadManifest(path, opts) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  return validateManifest(manifest, opts);
}

export async function verifyBundle(opts) {
  const manifest = await loadManifest(opts.manifest, opts);
  const actual = await archiveFingerprint(opts.archive);
  if (actual.sha256 !== manifest.archive.sha256 ||
      actual.bytes !== manifest.archive.bytes) {
    throw new Error('Release archive digest mismatch');
  }
  return manifest;
}

export function verifyLoadedImages(manifest, inspect = (tag) => {
  const json = execFileSync('docker', ['image', 'inspect', tag, '--format', '{{json .}}'], {
    encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const image = JSON.parse(json);
  return {
    id: image.Id,
    user: image.Config?.User,
    revision: image.Config?.Labels?.['org.opencontainers.image.revision'],
  };
}) {
  for (const key of ['runtime', 'migrate']) {
    const expected = manifest.images[key];
    const actual = inspect(expected.tag);
    if (actual?.id !== expected.id || actual.user !== 'node' ||
        actual.revision !== manifest.source.commit) {
      throw new Error('Loaded image identity mismatch');
    }
  }
  return true;
}

async function main() {
  try {
    const opts = parseOptions(process.argv.slice(2));
    const manifest = opts.command === 'create'
      ? await createBundle(opts)
      : opts.command === 'verify'
        ? await verifyBundle(opts)
        : await loadManifest(opts.manifest, opts);
    if (opts.command === 'verify-images') verifyLoadedImages(manifest);
    process.stdout.write(JSON.stringify({
      operation: opts.command, verified: true, commit: manifest.source.commit,
      archiveSha256: manifest.archive.sha256,
    }) + '\n');
  } catch {
    // Do not echo configuration or filesystem paths from potentially untrusted input.
    process.stderr.write('Release bundle verification failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
