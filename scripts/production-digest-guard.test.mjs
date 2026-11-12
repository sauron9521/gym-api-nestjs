import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  validateIdentity, validateCompose, validatePulled, validateCurrent,
} from './production-digest-guard.mjs';

const sha = 'a'.repeat(40);
const pub = 'b'.repeat(40);
const runtime = 'ghcr.io/sauron9521/gym-api-nestjs@sha256:' + 'c'.repeat(64);
const migrate = 'ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:' + 'd'.repeat(64);
const old = 'ghcr.io/sauron9521/gym-api-nestjs@sha256:' + 'e'.repeat(64);
const env = { DEPLOY_RUNTIME_IMAGE: runtime, DEPLOY_MIGRATE_IMAGE: migrate,
  SOURCE_SHA: sha, PUBLISH_SHA: pub, EXPECTED_CURRENT_IMAGE: old };
const validConfig = () => ({ services: {
  api: {
    image: runtime, init: true, read_only: true, restart: 'unless-stopped',
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    mem_limit: 1073741824, memswap_limit: 1073741824, cpus: 2, pids_limit: 256,
    ports: [{ host_ip: '127.0.0.1', target: 3000, published: '3000' }],
    volumes: [{ type: 'volume', source: 'avatars', target: '/app/uploads/avatars' }],
  },
  migrate: {
    image: migrate, restart: 'no', profiles: ['ops'],
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
  },
} });

test('requires exact repository-scoped digests and both source identities', () => {
  assert.equal(validateIdentity(env).previous, old);
  assert.equal(validateIdentity({ ...env, EXPECTED_CURRENT_IMAGE: 'none' }).previous, 'none');
  for (const bad of [
    { DEPLOY_RUNTIME_IMAGE: runtime.replace('@sha256:', ':latest-') },
    { DEPLOY_RUNTIME_IMAGE: runtime.replace('sauron9521', 'another') },
    { DEPLOY_MIGRATE_IMAGE: runtime },
    { SOURCE_SHA: 'main' }, { PUBLISH_SHA: '' },
    { EXPECTED_CURRENT_IMAGE: 'gym-api:local' },
    { EXPECTED_CURRENT_IMAGE: runtime },
    { EXPECTED_CURRENT_IMAGE: undefined },
  ]) assert.throws(() => validateIdentity({ ...env, ...bad }));
});

test('digest override must preserve original hardened Compose contract', () => {
  const id = validateIdentity(env);
  assert.equal(validateCompose(validConfig(), id), true);
  const mutations = [
    (c) => { c.services.api.build = { context: '.' }; },
    (c) => { c.services.migrate.build = { context: '.' }; },
    (c) => { c.services.api.image = 'gym-api:local'; },
    (c) => { c.services.api.ports[0].host_ip = '0.0.0.0'; },
    (c) => { c.services.api.read_only = false; },
    (c) => { c.services.api.mem_limit = 0; },
    (c) => { c.services.api.cap_drop = []; },
    (c) => { c.services.api.security_opt = []; },
    (c) => { c.services.api.volumes = []; },
    (c) => { c.services.migrate.profiles = []; },
    (c) => { c.services.migrate.restart = 'always'; },
    (c) => { c.services.migrate.image = 'latest'; },
  ];
  for (const mutate of mutations) {
    const config = validConfig();
    mutate(config);
    assert.throws(() => validateCompose(config, id));
  }
});

test('Docker image must match digest, non-root UID, architecture and source label', () => {
  const good = {
    Id: 'sha256:' + 'f'.repeat(64), RepoDigests: [runtime],
    Os: 'linux', Architecture: 'amd64',
    Config: { User: 'node', Labels: { 'org.opencontainers.image.revision': sha } },
  };
  assert.equal(validatePulled(good, runtime, sha), true);
  for (const patch of [
    { RepoDigests: [migrate] },
    { Os: 'windows' }, { Architecture: 'arm64' },
    { Config: { User: 'root', Labels: { 'org.opencontainers.image.revision': sha } } },
    { Config: { User: 'node', Labels: { 'org.opencontainers.image.revision': pub } } },
  ]) assert.throws(() => validatePulled({ ...good, ...patch }, runtime, sha));
});

test('observed running image must match operator-approved previous image', () => {
  assert.equal(validateCurrent(old, old), true);
  assert.equal(validateCurrent('', 'none'), true);
  assert.throws(() => validateCurrent('gym-api:local', 'none'));
  assert.throws(() => validateCurrent(runtime, old));
});

test('manual script requires approvals, signed OCI predicates and no-build rollout', async () => {
  const bash = await readFile(new URL('./production-digest-deploy.sh', import.meta.url), 'utf8');
  const compose = await readFile(new URL('../compose.digest.prod.yml', import.meta.url), 'utf8');
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(compose, /build: !reset null/g);
  assert.match(bash, /DEPLOY_VERIFIED_DIGEST/);
  assert.match(bash, /ROLLBACK_RUNTIME_ONLY/);
  assert.match(bash, /RUN_DB_MIGRATIONS/);
  assert.match(bash, /sha256sum --check --status/);
  assert.match(bash, /pg_restore --list/);
  assert.match(bash, /gh attestation verify/);
  assert.match(bash, /https:\/\/slsa\.dev\/provenance\/v1 https:\/\/spdx\.dev\/Document\/v2\.3/);
  assert.match(bash, /--signer-workflow/);
  assert.match(bash, /--source-digest "\$PUBLISH_SHA"/);
  assert.match(bash, /--no-build --pull never --force-recreate api/);
  assert.match(bash, /flock -n 9/);
  assert.match(bash, /Health\.Status/);
  assert.match(ci, /scripts\/production-digest-guard\.test\.mjs/);
  assert.doesNotMatch(bash, /docker build|docker push|prisma migrate reset|git push|DELETE/);
});
