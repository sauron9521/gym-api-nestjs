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


test('accepts optional domain layers, barrels, helpers and nested subfeatures', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/services/example.service.ts',
      "import type { Item } from '../types/example.types.js'; export class ExampleService {}");
    write('src/modules/example/services/index.ts',
      "export { ExampleService } from './example.service.js';");
    write('src/modules/example/repositories/example.repository.ts',
      "import { selectItem } from '../selects/example.select.js'; export class ExampleRepository {}");
    write('src/modules/example/repositories/workout-locks.ts',
      'export const withLock = () => undefined;');
    write('src/modules/example/selects/example.select.ts',
      'export const selectItem = { id: true };');
    write('src/modules/example/types/example.types.ts',
      'export type Item = { id: string };');
    write('src/modules/example/avatar/avatar.service.ts',
      'export class AvatarService {}');
    assert.deepEqual(check(), []);
  });
});

test('requires domain role files to live in their matching folders', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/wrong.service.ts', 'export class WrongService {}');
    write('src/modules/example/services/wrong.repository.ts', 'export class WrongRepository {}');
    write('src/modules/example/types/wrong.select.ts', 'export const select = {};');
    write('src/modules/example/repositories/wrong.types.ts', 'export type Wrong = string;');

    const errors = check().join('\n');
    assert.match(errors, /wrong.service.ts: \.service\.ts file must live in services\//);
    assert.match(errors, /wrong.repository.ts: \.repository\.ts file must live in repositories\//);
    assert.match(errors, /wrong.select.ts: \.select\.ts file must live in selects\//);
    assert.match(errors, /wrong.types.ts: \.types\.ts file must live in types\//);
  });
});

test('checks native ESM imports in domain files including barrel exports', () => {
  fixture(({ write, check }) => {
    const badAlias = '@' + 'src/common/example';
    write('src/modules/example/services/example.service.ts',
      "import { Bad } from '" + badAlias +
      "';\nimport { Broken } from '../types/example.types';\nexport class ExampleService {}");
    write('src/modules/example/repositories/index.ts',
      "export { ExampleRepository } from './example.repository';");
    write('src/modules/example/types/example.types.ts',
      "import { Prisma } from '" + '#prisma' + "/client.js'; export type Item = string;");

    const errors = check().join('\n');
    assert.match(errors, /use native #src\/#prisma/);
    assert.match(errors, /relative ESM import needs \.js/);
    assert.match(errors, /native alias must omit \.js\/\.ts/);
  });
});

test('disallows domain-to-controller and persistence-to-service dependencies', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/services/example.service.ts',
      "import { ExampleController } from '../controllers/example.controller.js';");
    write('src/modules/example/repositories/example.repository.ts',
      "import { ExampleService } from '../services/example.service.js';");
    write('src/modules/example/selects/example.select.ts',
      "import { ExampleService } from '#src/modules/example/services/example.service';");
    write('src/modules/example/types/example.types.ts',
      "import type { ExampleController } from '../controllers/example.controller.js';");

    const errors = check().join('\n');
    assert.match(errors, /services\/ must not import controllers\//);
    assert.match(errors, /repositories\/ must not import services\//);
    assert.match(errors, /selects\/ must not import services\//);
    assert.match(errors, /types\/ must not import controllers\//);
  });
});

test('rejects cross-feature relative imports from repositories', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/repositories/example.repository.ts',
      "import { Other } from '../../other/repositories/other.repository.js';");
    assert.match(check().join('\n'), /cross-feature relative import/);
  });
});


test('type-only controller import does not satisfy required runtime registration', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/example.module.ts',
      "import type { ExampleController } from './controllers/example.controller.js';\n" +
      '@Module({ controllers: [ExampleController] }) export class ExampleModule {}');
    assert.match(check().join('\n'), /import controller directly/);
  });
});

test('rejects wrong ESM extensions in re-exports from domain barrels', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/services/index.ts',
      "export * from './example.service';");
    assert.match(check().join('\n'), /relative ESM import needs \.js/);
  });
});

test('rejects computed dynamic imports and ignores commented-out imports', () => {
  fixture(({ write, check }) => {
    write('src/modules/example/services/example.service.ts',
      "const note = 'import(\\'../controllers/example.controller\\')';\n" +
      "// import { X } from '../controllers/missing.controller';\n" +
      'export const load = (name) => import(name);');
    const violations = check().join('\n');
    assert.match(violations, /computed dynamic import cannot be checked statically/);
    assert.doesNotMatch(violations, /missing.controller/);
    assert.doesNotMatch(violations, /relative ESM import needs \.js/);
  });
});
