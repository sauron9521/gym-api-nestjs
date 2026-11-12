import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Dockerfile defaults to Node 22 Debian 13 trixie for all stages', async () => {
  const docker = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /^ARG NODE_BASE_IMAGE=node:22-trixie-slim$/m);
  assert.match(docker, /^FROM \${NODE_BASE_IMAGE} AS base$/m);
  assert.match(docker, /^FROM base AS build$/m);
  assert.match(docker, /^FROM base AS runtime$/m);
  assert.match(docker, /^FROM build AS migrate$/m);
  assert.doesNotMatch(docker, /node:22-bookworm-slim/);
});

test('signed release resolves patched Node 22 Debian 13 base by digest', async () => {
  const wf = await readFile(new URL('../.github/workflows/release-artifacts.yml', import.meta.url), 'utf8');
  assert.match(wf, /docker pull --platform linux\/amd64 node:22-trixie-slim/);
  assert.match(wf, /docker image inspect --format/);
  assert.match(wf, /node:22-trixie-slim/);
  assert.match(wf, /--build-arg NODE_BASE_IMAGE="\$BASE_IMAGE"/g);
  assert.match(wf, /Verify signed SLSA provenance from GitHub/);
  assert.doesNotMatch(wf, /node:22-bookworm-slim/);
});

test('CI rejects unpatched glibc and critical CVEs on both exact built images', async () => {
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /dpkg --compare-versions "\$version" ge "2\.41-12\+deb13u4"/);
  assert.match(ci, /test "\$VERSION_CODENAME" = trixie/);
  assert.match(ci, /gym-api:runtime-ci gym-api:migrate-ci/);
  assert.match(ci, /image: gym-api:runtime-ci/);
  assert.match(ci, /image: gym-api:migrate-ci/);
  const scans = ci.match(/severity-cutoff: critical/g) ?? [];
  assert.ok(scans.length >= 2);
  assert.match(ci, /node --test scripts\/docker-base-policy\.test\.mjs/);
});
