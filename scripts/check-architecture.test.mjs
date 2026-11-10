import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkArchitecture } from './check-architecture.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'gym-architecture-'));
  const write = (path, content) => {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  };

  write('src/modules/example/example.module.ts', `
    import { ExampleController } from './controllers/example.controller.js';
    @Module({ controllers: [ExampleController] })
    export class ExampleModule {}
  `);
  write('src/modules/example/controllers/example.controller.ts', `
    import { ExampleService } from '../services/example.service.js';
    export class ExampleController {}
  `);
  write('src/modules/example/test/controllers/example.controller.spec.ts', `
    import { ExampleController } from '../../controllers/example.controller.js';
  `);
  write('src/modules/example/test/controllers/example-controller-registry.spec.ts', `
    import { ExampleModule } from '../../example.module.js';
  `);

  try {
    run({ root, write, check: () => checkArchitecture(root) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('accepts a properly registered, tested feature controller', () => {
  fixture(({ check }) => assert.deepEqual(check(), []));
});

test('requires controllers directly in controllers/', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/legacy.controller.ts', 'export class LegacyController {}');
    assert.match(check().join('\n'), /legacy.controller.ts: controller must live directly/);
  });
});

test('requires a controller spec and a registry spec', () => {
  fixture(({ write, check }) => {
    // Adding an extra controller without corresponding tests identifies both
    // an unregistered controller and its missing focused unit test.
    write('src/modules/example/controllers/extra.controller.ts', 'export class ExtraController {}');
    assert.match(check().join('\n'), /missing controller unit test/);
    assert.match(check().join('\n'), /ExtraController not registered/);
  });
});

test('rejects phantom controller tests', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/test/controllers/phantom.controller.spec.ts', 'test("unused", () => {});');
    assert.match(check().join('\n'), /no matching controller/);
  });
});

test('rejects wrong module controller paths and registration drift', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/example.module.ts', `
      import { ExampleController } from './example.controller.js';
      @Module({ controllers: [UnknownController] })
      export class ExampleModule {}
    `);
    const problems = check().join('\n');
    assert.match(problems, /import controller directly/);
    assert.match(problems, /ExampleController not registered/);
    assert.match(problems, /unrecognized registered controller/);
  });
});

test('rejects extensionless imports and TypeScript-only aliases', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/controllers/example.controller.ts', `
      import { Local } from '../services/example.service';
      import { Other } from '@src/modules/users/users.module';
      export class ExampleController {}
    `);
    const problems = check().join('\n');
    assert.match(problems, /relative ESM import needs \.js/);
    assert.match(problems, /use native #src/);
  });
});

test('rejects cross-feature relative imports and .js suffixes on aliases', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/controllers/example.controller.ts', `
      import { Other } from '../../users/users.module.js';
      import { PrismaService } from '#src/infra/database/prisma.service.js';
      export class ExampleController {}
    `);
    const problems = check().join('\n');
    assert.match(problems, /cross-feature relative import/);
    assert.match(problems, /native alias must omit \.js/);
  });
});

test('fails clearly when feature modules are missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'gym-architecture-missing-'));
  try {
    assert.match(checkArchitecture(root).join('\n'), /feature module directory is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
