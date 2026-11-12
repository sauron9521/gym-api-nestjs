#!/usr/bin/env node
// Validate image SBOM/Grype output and parse exact GHCR registry digest targets.
// This is a content/schema guard, not a replacement for cryptographic attestations.
import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const NAME = /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/;

export function validateSpdx(sbom) {
  assert.equal(sbom?.spdxVersion, 'SPDX-2.3', 'Unsupported SPDX version');
  assert.equal(sbom?.SPDXID, 'SPDXRef-DOCUMENT', 'Missing SPDX document identity');
  assert.equal(sbom?.dataLicense, 'CC0-1.0', 'Invalid SPDX license');
  assert.equal(typeof sbom?.name, 'string', 'Missing SPDX name');
  assert.ok(sbom.name.length > 0 && sbom.name.length < 4096, 'Invalid SPDX name');
  assert.equal(typeof sbom?.documentNamespace, 'string', 'Missing SPDX namespace');
  assert.ok(sbom.documentNamespace.startsWith('https://') || sbom.documentNamespace.startsWith('http://'),
    'Invalid SPDX namespace');
  assert.ok(Array.isArray(sbom.packages) && sbom.packages.length > 0,
    'Empty SBOM packages');
  assert.ok(sbom.packages.every((p) => typeof p?.SPDXID === 'string' &&
    /^SPDXRef-[A-Za-z0-9.-]+$/.test(p.SPDXID) &&
    typeof p.name === 'string' && p.name.length > 0), 'Invalid SPDX package');
  return { packages: sbom.packages.length };
}

export function validateGrype(report) {
  assert.ok(Array.isArray(report?.matches), 'No Grype matches array');
  // Grype 0.110.0 omits ignoredMatches entirely when there are none.
  // An explicitly present ignoredMatches value must still be an array.
  if (Object.hasOwn(report, 'ignoredMatches')) {
    assert.ok(Array.isArray(report.ignoredMatches),
      'Invalid Grype ignoredMatches array');
  }
  assert.equal(typeof report?.descriptor?.name, 'string', 'Missing Grype descriptor');
  assert.ok(report.descriptor.name.toLowerCase().includes('grype'), 'Wrong scanner');
  // Grype scan-action itself enforces the critical threshold. Verify that
  // reports are genuine scanner output, not empty placeholders or missing files.
  const severities = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  for (const m of report.matches) {
    assert.equal(typeof m?.vulnerability?.id, 'string', 'Invalid vulnerability ID');
    const severity = String(m.vulnerability.severity ?? 'unknown').toLowerCase();
    severities[severity] = (severities[severity] ?? 0) + 1;
  }
  // Keep the fail-closed critical policy independent of scan-action exit code.
  assert.equal(severities.critical, 0, 'Critical Grype vulnerabilities present');
  return { findings: report.matches.length, severities };
}

export function digestTargets(receipt, repository) {
  assert.match(repository, /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/);
  const runtimeRepo = 'ghcr.io/' + repository.toLowerCase();
  const migrateRepo = runtimeRepo + '-migrate';
  const result = {};
  for (const [key, expectedName] of [['runtime', runtimeRepo], ['migrate', migrateRepo]]) {
    const value = receipt?.[key];
    assert.equal(typeof value, 'string', 'Missing published image');
    const parts = value.split('@');
    assert.equal(parts.length, 2, 'Invalid digest reference');
    assert.equal(parts[0], expectedName, 'Unexpected GHCR package namespace');
    assert.match(parts[0], NAME);
    assert.match(parts[1], DIGEST);
    result[key + '_name'] = parts[0];
    result[key + '_digest'] = parts[1];
  }
  assert.notEqual(result.runtime_digest, result.migrate_digest, 'Images must be distinct');
  return result;
}

export function githubOutputs(values) {
  // Values are strictly syntax-validated above; no injection of output lines.
  return Object.entries(values).map(([key, value]) => key + '=' + value).join('\n') + '\n';
}

async function main() {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'validate' && args.length === 4) {
      const [runtimeSbom, migrateSbom, runtimeGrype, migrateGrype] = args;
      const results = {
        runtime: {
          sbom: validateSpdx(JSON.parse(await readFile(runtimeSbom, 'utf8'))),
          scan: validateGrype(JSON.parse(await readFile(runtimeGrype, 'utf8'))),
        },
        migrate: {
          sbom: validateSpdx(JSON.parse(await readFile(migrateSbom, 'utf8'))),
          scan: validateGrype(JSON.parse(await readFile(migrateGrype, 'utf8'))),
        },
      };
      process.stdout.write(JSON.stringify(results) + '\n');
    } else if (mode === 'digest-outputs' && args.length === 3) {
      const [receiptPath, repository, outputPath] = args;
      const values = digestTargets(JSON.parse(await readFile(receiptPath, 'utf8')), repository);
      await appendFile(outputPath, githubOutputs(values), { encoding: 'utf8' });
      process.stdout.write(JSON.stringify({ digestsValidated: true }) + '\n');
    } else {
      throw new Error('Invalid supply-chain operation');
    }
  } catch {
    process.stderr.write('Release supply-chain validation failed\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
