#!/usr/bin/env node
// Read-only GHCR retention candidate planning. NEVER sends delete requests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const DAY = 86_400_000;

export function normalizeVersions(raw) {
  assert.ok(Array.isArray(raw), 'Expected paginated GHCR versions');
  const values = raw.flat();
  assert.ok(values.every((x) => x && typeof x === 'object'), 'Malformed GHCR versions');
  const ids = new Set();
  return values.map((version) => {
    const id = version.id;
    const digest = version.name;
    const created = Date.parse(version.created_at);
    const tags = version.metadata?.container?.tags;
    assert.ok(Number.isSafeInteger(id) && id > 0 && !ids.has(id),
      'Invalid or duplicate GHCR version ID');
    assert.match(digest ?? '', DIGEST);
    assert.ok(Number.isFinite(created), 'Invalid GHCR version creation date');
    assert.ok(Array.isArray(tags) && tags.every((x) => typeof x === 'string'),
      'Missing GHCR tags metadata');
    ids.add(id);
    return { id, digest, created, createdAt: version.created_at, tags };
  });
}

export function planRetention(rawByPackage, protectedByPackage, asOf, opts = {}) {
  const minAgeDays = opts.minAgeDays ?? 90;
  const keepNewest = opts.keepNewest ?? 10;
  assert.ok(Number.isSafeInteger(minAgeDays) && minAgeDays >= 30 &&
    Number.isSafeInteger(keepNewest) && keepNewest >= 5);
  assert.match(asOf, /^\d{4}-\d{2}-\d{2}$/);
  const now = Date.parse(asOf + 'T00:00:00Z');
  assert.ok(Number.isFinite(now) && new Date(now).toISOString().slice(0, 10) === asOf);
  assert.deepEqual(Object.keys(rawByPackage).sort(), ['migrate', 'runtime']);
  assert.deepEqual(Object.keys(protectedByPackage).sort(), ['migrate', 'runtime']);

  const result = { asOf, minAgeDays, keepNewest, packages: {} };
  for (const key of ['runtime', 'migrate']) {
    const protectedDigests = protectedByPackage[key];
    assert.ok(Array.isArray(protectedDigests) && protectedDigests.length > 0 &&
      protectedDigests.every((x) => typeof x === 'string' && DIGEST.test(x)),
      'Explicit active digest protection is mandatory for BOTH packages');
    const protectedSet = new Set(protectedDigests);
    const versions = normalizeVersions(rawByPackage[key]);
    // The newest N version IDs are conservatively excluded even if untagged.
    versions.sort((a, b) => b.created - a.created || b.id - a.id);
    const newest = new Set(versions.slice(0, keepNewest).map((v) => v.id));
    const candidates = [];
    for (const version of versions) {
      assert.ok(version.created <= now + DAY,
        'GHCR version creation date unexpectedly in the future');
      if (newest.has(version.id) || version.tags.length !== 0 ||
        protectedSet.has(version.digest) ||
        (now - version.created) / DAY < minAgeDays) continue;
      candidates.push({
        versionId: version.id, digest: version.digest, createdAt: version.createdAt,
        reason: 'old-untagged-unprotected-not-in-newest',
      });
    }
    result.packages[key] = {
      inspected: versions.length, candidateCount: candidates.length, candidates,
    };
  }
  return result;
}

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4) throw new Error('Expected two inventories, allowlist and as-of date');
    const [runtime, migrate, protect, asOf] = args;
    const raw = {
      runtime: JSON.parse(await readFile(runtime, 'utf8')),
      migrate: JSON.parse(await readFile(migrate, 'utf8')),
    };
    const keep = JSON.parse(await readFile(protect, 'utf8'));
    process.stdout.write(JSON.stringify(planRetention(raw, keep, asOf), null, 2) + '\n');
  } catch {
    process.stderr.write('GHCR read-only retention plan refused invalid input\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
