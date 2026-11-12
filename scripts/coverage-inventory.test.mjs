import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildCoverageInventory,
  isProductionSourcePath,
  listProductionSourcePaths,
  renderCoverageInventory,
} from './coverage-inventory.mjs';

const covered = { lines: { covered: 2, total: 4 } };
const summary = (paths) => Object.fromEntries([
  ['total', covered],
  ...paths.map((path) => [path, covered]),
]);

describe('coverage source inventory', () => {
  it('normalizes POSIX, Windows and relative source paths without double counting', () => {
    const inventory = buildCoverageInventory([
      'src/modules/auth/services/auth.service.ts',
      'src/modules/auth/services/auth.service.ts',
      'src/modules/training-programs/services/program.service.ts',
      'src/main.ts',
    ], summary([
      '/home/runner/work/app/src/modules/auth/services/auth.service.ts',
      'C:\\dev\\app\\src\\main.ts',
    ]));

    assert.equal(inventory.eligible, 3);
    assert.equal(inventory.measured, 2);
    assert.deepEqual(inventory.unmeasuredPaths, [
      'src/modules/training-programs/services/program.service.ts',
    ]);
    assert.deepEqual(inventory.scopes, [
      { scope: 'modules/auth', eligible: 1, measured: 1, unmeasured: 0 },
      { scope: 'modules/training-programs', eligible: 1, measured: 0, unmeasured: 1 },
      { scope: 'main.ts', eligible: 1, measured: 1, unmeasured: 0 },
    ].sort((a, b) => a.scope.localeCompare(b.scope)));
  });

  it('excludes specs, declarations, generated files, barrels and type-only folders', () => {
    for (const path of [
      'src/modules/auth/test/auth.spec.ts',
      'src/common/config/env.spec.ts',
      'src/modules/auth/auth.test.ts',
      'src/modules/auth/auth.e2e-spec.ts',
      'src/infra/database/generated/prisma/client.ts',
      'src/modules/auth/index.ts',
      'src/common/declarations.d.ts',
      'src/modules/auth/types/auth-store.types.ts',
      'src/modules/auth/example.types.ts',
      'test/fixtures/example.ts',
      'docs/example.ts',
    ]) {
      assert.equal(isProductionSourcePath(path), false, path);
    }
    assert.equal(isProductionSourcePath('src/modules/auth/services/auth.service.ts'), true);
    assert.equal(isProductionSourcePath('src/infra/openapi/openapi.ts'), true);
    assert.equal(isProductionSourcePath('src/modules/auth/components/widget.tsx'), true);
  });

  it('recursively enumerates eligible source files and ignores test/helper directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'gym-inventory-'));
    try {
      for (const path of [
        'src/main.ts',
        'src/modules/workouts/services/workouts.service.ts',
        'src/modules/workouts/test/workouts.spec.ts',
        'src/modules/workouts/types/workout.types.ts',
        'src/infra/database/generated/prisma/client.ts',
        'src/common/index.ts',
      ]) {
        const target = join(root, path);
        mkdirSync(join(target, '..'), { recursive: true });
        writeFileSync(target, 'export {};');
      }
      assert.deepEqual(listProductionSourcePaths(root), [
        'src/main.ts',
        'src/modules/workouts/services/workouts.service.ts',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed if the summary or source tree is empty', () => {
    assert.throws(
      () => buildCoverageInventory(['src/main.ts'], {}),
      /Missing aggregate coverage total/,
    );
    assert.throws(
      () => buildCoverageInventory(['src/main.ts'], { total: covered }),
      /no production source file entries/,
    );
    assert.throws(
      () => buildCoverageInventory([], summary(['src/main.ts'])),
      /No eligible production source files/,
    );
  });

  it('does not mistake a covered test file for a measured production file', () => {
    const inventory = buildCoverageInventory(
      ['src/modules/auth/auth.service.ts', 'src/modules/auth/test/auth.spec.ts'],
      summary([
        'src/modules/auth/auth.service.ts',
        'src/modules/auth/test/auth.spec.ts',
      ]),
    );
    assert.equal(inventory.measured, 1);
    assert.equal(inventory.eligible, 1);
    assert.equal(inventory.unmeasured, 0);
  });

  it('renders a capped, deterministic Markdown inventory without inventing coverage percentages', () => {
    const inventory = buildCoverageInventory([
      'src/modules/auth/services/auth.service.ts',
      'src/modules/auth/services/session.service.ts',
      'src/modules/auth/services/token.service.ts',
      'src/modules/workouts/workouts.service.ts',
    ], summary(['src/modules/workouts/workouts.service.ts']));
    const markdown = renderCoverageInventory(inventory, 2);

    assert.match(markdown, /1 of 4/);
    assert.match(markdown, /3\*\* do not/);
    assert.match(markdown, /\| modules\/auth \| 3 \| 0 \| 3 \|/);
    assert.match(markdown, /additional paths are in/);
    assert.match(markdown, /auth\.service\.ts/);
    assert.match(markdown, /session\.service\.ts/);
    assert.doesNotMatch(markdown, /token\.service\.ts/);
    assert.match(markdown, /Inventory, not zero coverage/);
  });
});
