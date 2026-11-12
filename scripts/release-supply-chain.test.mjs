import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  validateSpdx, validateGrype, digestTargets, githubOutputs,
} from './release-supply-chain.mjs';

const sha = 'abcdef0123456789abcdef0123456789abcdef01';
const makeSpdx = () => ({
  spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT',
  dataLicense: 'CC0-1.0', name: 'gym-api',
  documentNamespace: 'https://example.test/spdx/gym-api',
  packages: [{ SPDXID: 'SPDXRef-Package-node', name: 'node' }],
});
const makeGrype = () => ({
  descriptor: { name: 'grype', version: '0.99.0' },
  matches: [{ vulnerability: { id: 'CVE-2026-1234', severity: 'High' } }],
  ignoredMatches: [],
});
const receipt = {
  runtime: 'ghcr.io/sauron9521/gym-api-nestjs@sha256:' + 'a'.repeat(64),
  migrate: 'ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:' + 'b'.repeat(64),
};

test('SPDX guards reject missing, empty and fabricated inventory', () => {
  assert.deepEqual(validateSpdx(makeSpdx()), { packages: 1 });
  for (const invalid of [
    {}, { ...makeSpdx(), spdxVersion: 'SPDX-3.0' },
    { ...makeSpdx(), packages: [] },
    { ...makeSpdx(), packages: [{ name: 'node' }] },
    { ...makeSpdx(), documentNamespace: 'not-an-uri' },
  ]) assert.throws(() => validateSpdx(invalid));
});

test('Grype reports contain scanner identity and well-formed results', () => {
  assert.deepEqual(validateGrype(makeGrype()), {
    findings: 1, severities: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
  });
  assert.equal(validateGrype({ ...makeGrype(), matches: [] }).findings, 0);
  for (const invalid of [
    {}, { ...makeGrype(), descriptor: { name: 'fake' } },
    { ...makeGrype(), matches: [{ vulnerability: {} }] },
    { ...makeGrype(), ignoredMatches: null },
  ]) assert.throws(() => validateGrype(invalid));
});

test('OCI targets are bound to exact registry namespace and digest, no tag substitution', () => {
  const result = digestTargets(receipt, 'sauron9521/gym-api-nestjs');
  assert.equal(result.runtime_name, 'ghcr.io/sauron9521/gym-api-nestjs');
  assert.equal(result.migrate_digest, 'sha256:' + 'b'.repeat(64));
  assert.equal(githubOutputs(result).split('\n').length, 5);
  for (const invalid of [
    { ...receipt, runtime: 'ghcr.io/other/repo@sha256:' + 'a'.repeat(64) },
    { ...receipt, runtime: 'ghcr.io/sauron9521/gym-api-nestjs:latest' },
    { ...receipt, migrate: 'ghcr.io/sauron9521/gym-api-nestjs-migrate@sha256:123' },
    { ...receipt, migrate: receipt.runtime.replace('gym-api-nestjs@', 'gym-api-nestjs-migrate@') },
  ]) assert.throws(() => digestTargets(invalid, 'sauron9521/gym-api-nestjs'));
  assert.throws(() => digestTargets(receipt, '../evil'));
});

test('manual GHCR publish signs provenance and SPDX SBOMs for both exact digests', async () => {
  const workflow = await readFile(new URL('../.github/workflows/publish-ghcr.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /attestations: write/);
  assert.match(workflow, /artifact-metadata: write/);
  assert.match(workflow, /anchore\/sbom-action@v0/g);
  assert.match(workflow, /anchore\/scan-action@v7/g);
  assert.match(workflow, /severity-cutoff: critical/g);
  assert.match(workflow, /fail-build: true/g);
  assert.match(workflow, /actions\/attest@v4/g);
  assert.match(workflow, /push-to-registry: true/g);
  assert.match(workflow, /sbom-path: release\/runtime\.spdx\.json/);
  assert.match(workflow, /sbom-path: release\/migrate\.spdx\.json/);
  assert.match(workflow, /for predicate in https:\/\/slsa\.dev\/provenance\/v1 https:\/\/spdx\.dev\/Document\/v2\.3/);
  assert.match(workflow, /--predicate-type "\$predicate"/);
  assert.match(workflow, /--signer-workflow/);
  assert.match(workflow, /--source-digest "\$GITHUB_SHA"/);
  const beforePush = workflow.indexOf('      - name: Publish both verified images without rebuilding');
  const beforeScan = workflow.indexOf('      - name: Scan runtime SBOM for critical vulnerabilities');
  assert.ok(beforeScan > 0 && beforeScan < beforePush);
  assert.doesNotMatch(workflow, /docker build |docker compose|gh release create/);
  assert.doesNotMatch(workflow, /^\s+(pull_request|push|schedule):/m);
});

test('CI never publishes OCI artifacts and still runs offline regression tests', async () => {
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /scripts\/release-supply-chain\.test\.mjs/);
  assert.doesNotMatch(ci, /packages: write|id-token: write|docker push/);
});
