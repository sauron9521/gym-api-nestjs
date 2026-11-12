#!/usr/bin/env node
// Authenticated, credential-safe smoke of already-signed digest images.
// Runs ONLY against a temporary local API on the isolated staging runner.
// Synthetic password/token state is private and never uploaded as evidence.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStagingRequest } from './staging-smoke.mjs';

const ORIGIN = 'http://127.0.0.1:31848';
const STATE = 'staging/functional-state.json';
const EVIDENCE = 'staging/functional-evidence.json';
const EMAIL_RE = /^staging-[0-9a-f-]{36}@example\.test$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WEIGHT = 81.25;
const FIRST_NAME = 'StagingTest';

export function verifyFunctionalResponse(name, status, body) {
  const expected = {
    anonymousDenied: 401,
    registration: 201,
    login: 200,
    tokenIssued: 200,
    profileRead: 200,
    profileUpdated: 200,
    refresh: 200,
    profilePreserved: 200,
  };
  assert.ok(Object.hasOwn(expected, name), 'Unknown functional contract');
  assert.equal(status, expected[name], 'Unexpected HTTP result');
  if (name === 'registration') {
    assert.match(body?.id ?? '', UUID, 'Missing registered user ID');
    assert.ok(['SUBMITTED', 'RETRY_REQUIRED'].includes(body?.verificationEmailStatus),
      'Unknown verification email submission status');
    assert.equal(typeof body.email, 'string', 'Missing registered email');
    assert.ok(!Object.hasOwn(body, 'passwordHash'), 'Credential hash leaked');
  }
  if (name === 'login') assert.equal(body?.mfaRequired, false, 'Unexpected MFA requirement');
  if (name === 'tokenIssued' || name === 'refresh') {
    assert.ok(typeof body?.accessToken === 'string' &&
      body.accessToken.length > 20, 'Missing access token');
    assert.ok(typeof body?.refreshToken === 'string' &&
      body.refreshToken.length > 20, 'Missing refresh token');
  }
  if (name === 'profileRead' || name === 'profileUpdated' ||
      name === 'profilePreserved') {
    assert.match(body?.id ?? '', UUID, 'Missing profile owner');
    assert.ok(!Object.hasOwn(body, 'passwordHash'), 'Credential hash leaked');
  }
  return true;
}

export function verifyPersistedProfile(body, state) {
  verifyFunctionalResponse('profilePreserved', 200, body);
  assert.match(state?.userId ?? '', UUID);
  assert.match(state?.email ?? '', EMAIL_RE);
  assert.equal(body.id, state.userId, 'Account identity changed');
  assert.equal(body.email, state.email, 'Account email changed');
  assert.equal(body.profile?.firstName, FIRST_NAME, 'Profile lost during migration or restart');
  assert.equal(body.profile?.weight, WEIGHT, 'Decimal weight changed');
  return true;
}

export function makeFunctionalEvidence(request, stage) {
  const id = validateStagingRequest(request);
  assert.equal(stage, 'passed');
  return {
    schemaVersion: 1,
    kind: 'isolated-functional-migration-recovery',
    status: 'passed',
    runId: id.runId,
    sourceSha: id.sourceSha,
    publisherSha: id.publisherSha,
    runtime: id.runtime,
    migrate: id.migrate,
    checks: {
      anonymousDenied: 'passed',
      registration: 'passed',
      credentialsLogin: 'passed',
      jwtProtectedProfile: 'passed',
      fractionalWeight: 'passed',
      refreshRotation: 'passed',
      repeatedMigrationsPreservedSyntheticData: 'passed',
      sameDigestContainerRestartRecovered: 'passed',
    },
    rollbackAcrossDifferentVersions: 'not-tested',
    productionContacted: false,
    productionSchemaDowngraded: false,
    persistentStagingDeployment: false,
  };
}

export function makeFunctionalFailureEvidence(env) {
  const id = validateStagingRequest(env);
  return {
    schemaVersion: 1,
    kind: 'isolated-functional-migration-recovery',
    status: 'failed',
    runId: id.runId,
    sourceSha: id.sourceSha,
    publisherSha: id.publisherSha,
    runtime: id.runtime,
    migrate: id.migrate,
    checks: { functionalStatus: 'not-completed' },
    rollbackAcrossDifferentVersions: 'not-tested',
    productionContacted: false,
    productionSchemaDowngraded: false,
    persistentStagingDeployment: false,
  };
}

async function http(method, path, body, bearer) {
  assert.match(path, /^\/(?:auth|users)\/[a-z0-9/-]+$/, 'Unexpected API path');
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (bearer) headers.authorization = 'Bearer ' + bearer;
  const response = await fetch(ORIGIN + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  let value = {};
  if (response.status !== 204) {
    const text = await response.text();
    assert.ok(text.length < 500_000, 'Response too large');
    value = JSON.parse(text);
  }
  return { status: response.status, body: value, headers: response.headers };
}

async function createSyntheticAccount(request) {
  const anonymous = await http('GET', '/users/me');
  verifyFunctionalResponse('anonymousDenied', anonymous.status, anonymous.body);

  const email = 'staging-' + randomUUID() + '@example.test';
  const password = randomBytes(36).toString('base64url') + 'Aa1!';
  const registered = await http('POST', '/auth/register', { email, password });
  verifyFunctionalResponse('registration', registered.status, registered.body);
  assert.equal(registered.body.email, email, 'Wrong new account');
  assert.equal(registered.headers.get('cache-control'), 'no-store',
    'Missing sensitive auth response cache protection');
  assert.match(registered.headers.get('set-cookie') ?? '', /__Host-sid=/,
    'Registration session cookie missing');

  const login = await http('POST', '/auth/login', { email, password });
  verifyFunctionalResponse('login', login.status, login.body);

  const token = await http('POST', '/auth/token', { email, password });
  verifyFunctionalResponse('tokenIssued', token.status, token.body);

  const user = await http('GET', '/users/me', undefined, token.body.accessToken);
  verifyFunctionalResponse('profileRead', user.status, user.body);
  assert.equal(user.body.id, registered.body.id);
  assert.equal(user.body.email, email);

  const update = await http('PATCH', '/users/me',
    { firstName: FIRST_NAME, weight: WEIGHT }, token.body.accessToken);
  verifyFunctionalResponse('profileUpdated', update.status, update.body);
  assert.equal(update.body.profile?.firstName, FIRST_NAME);
  assert.equal(update.body.profile?.weight, WEIGHT);

  const refresh = await http('POST', '/auth/token/refresh', {
    refreshToken: token.body.refreshToken,
  });
  verifyFunctionalResponse('refresh', refresh.status, refresh.body);
  assert.notEqual(refresh.body.refreshToken, token.body.refreshToken,
    'Refresh token was not rotated');

  const rotated = await http('GET', '/users/me',
    undefined, refresh.body.accessToken);
  assert.equal(rotated.status, 200);
  verifyPersistedProfile(rotated.body, {
    userId: registered.body.id, email,
  });

  // Never put email/password/tokens in the public Actions evidence artifact.
  const state = { email, password, userId: registered.body.id };
  await mkdir('staging', { recursive: true, mode: 0o700 });
  await writeFile(STATE, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
  return true;
}

async function verifySyntheticAccount(request, final) {
  const state = JSON.parse(await readFile(STATE, 'utf8'));
  assert.match(state.email ?? '', EMAIL_RE);
  assert.match(state.userId ?? '', UUID);
  assert.equal(typeof state.password, 'string');
  const token = await http('POST', '/auth/token', {
    email: state.email, password: state.password,
  });
  verifyFunctionalResponse('tokenIssued', token.status, token.body);
  const profile = await http('GET', '/users/me',
    undefined, token.body.accessToken);
  assert.equal(profile.status, 200);
  verifyPersistedProfile(profile.body, state);
  if (final) {
    const evidence = makeFunctionalEvidence(request, 'passed');
    await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        '### Functional staging drill\n' +
        'Authentication, token rotation, synthetic profile preservation and same-digest restart: passed.\n' +
        'Version-to-version rollback and production migration compatibility: NOT TESTED.\n');
    }
  }
}

async function main() {
  try {
    const id = validateStagingRequest(process.env);
    const mode = process.argv[2];
    if (mode === 'exercise') {
      await createSyntheticAccount(id);
      process.stdout.write('Synthetic functional API contracts passed\n');
    } else if (mode === 'verify-data' || mode === 'verify-restarted') {
      await verifySyntheticAccount(process.env, mode === 'verify-restarted');
      process.stdout.write('Synthetic account and decimal profile preserved\n');
    } else if (mode === 'failed') {
      // Do not replace a success receipt; if a later job step fails,
      // the job conclusion still takes precedence over this evidence.
      try {
        await readFile(EVIDENCE, 'utf8');
      } catch {
        await mkdir('staging', { recursive: true, mode: 0o700 });
        await writeFile(EVIDENCE,
          JSON.stringify(makeFunctionalFailureEvidence(process.env), null, 2) + '\n',
          { flag: 'wx', mode: 0o600 });
      }
      process.stdout.write('Safe incomplete-functional-rehearsal receipt recorded\n');
    } else {
      throw new Error('Unknown functional staging mode');
    }
  } catch {
    process.stderr.write('Isolated functional staging contract failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
