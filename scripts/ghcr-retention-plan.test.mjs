import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeVersions, planRetention } from './ghcr-retention-plan.mjs';

const digest = (letter) => 'sha256:' + letter.repeat(64);
const release = (id, date, tags = []) => ({
  id, name: digest('a'), created_at: date, metadata: { container: { tags } },
});
const protectedByPackage = {
  runtime: [digest('c')], migrate: [digest('c')],
};

test('GHCR versions normalize paginated CLI --slurp and validate metadata', () => {
  assert.equal(normalizeVersions([[release(1, '2026-01-01T00:00:00Z')]]).length, 1);
  for (const broken of [
    [{ id: 1 }], [release(1, 'bad-date')], [release(1, '2026-01-01Z'), release(1, '2026-02-01Z')],
    [{ ...release(2, '2026-01-01T00:00:00Z'), name: 'latest' }],
  ]) assert.throws(() => normalizeVersions(broken));
});

test('no automatic deletion: plan only old, untagged and unprotected beyond newest', () => {
  const inventory = {
    runtime: [
      release(1, '2026-01-01T00:00:00Z'),
      { ...release(2, '2026-01-02T00:00:00Z'), name: digest('b') },
      { ...release(3, '2026-01-03T00:00:00Z'), name: digest('c') },
      release(4, '2026-01-04T00:00:00Z', ['prod']),
      ...Array.from({ length: 10 }, (_, idx) => ({
        ...release(idx + 10, '2026-08-' + String(idx + 1).padStart(2, '0') + 'T00:00:00Z'),
        name: digest('d'),
      })),
    ],
    migrate: [release(1, '2026-11-01T00:00:00Z')],
  };
  const result = planRetention(inventory, protectedByPackage, '2026-11-12');
  assert.deepEqual(result.packages.runtime.candidates.map((c) => c.versionId), [2, 1]);
  assert.equal(result.packages.migrate.candidateCount, 0);
  assert.equal(result.packages.runtime.inspected, 14);
});

test('fail closed on absent production allowlist or invalid inventory/date', () => {
  const source = { runtime: [release(1, '2026-01-01T00:00:00Z')], migrate: [] };
  assert.throws(() => planRetention(source, { runtime: [], migrate: [] }, '2026-11-12'));
  assert.throws(() => planRetention(source, protectedByPackage, '2026-02-30'));
  assert.throws(() => planRetention({ runtime: [] }, protectedByPackage, '2026-11-12'));
  assert.throws(() => planRetention(source, protectedByPackage, '2026-11-12', { minAgeDays: 1 }));
});
