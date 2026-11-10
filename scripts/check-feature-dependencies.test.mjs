import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { checkFeatureDependencies } from './check-feature-dependencies.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'gym-feature-deps-'));
  const write = (path, source) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  };
  const module = (name, source = 'export class FeatureModule {}') => {
    write('src/modules/' + name + '/' + name + '.module.ts', source);
  };
  const source = (moduleName, path, content) => {
    write('src/modules/' + moduleName + '/' + path, content);
  };

  try {
    run({ write, module, source, check: () => checkFeatureDependencies(root) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('accepts a dependency-free feature and missing optional domain folders', () => {
  fixture(({ module, check }) => {
    module('one');
    assert.deepEqual(check(), []);
  });
});

test('allows a Nest dependency and its runtime service contract', () => {
  fixture(({ module, source, check }) => {
    module('first',
      "import { SecondModule } from '#src/modules/second/second.module';\nexport class FirstModule {}");
    module('second');
    source('first', 'services/first.service.ts',
      "import { SecondService } from '#src/modules/second/services/second.service';");
    assert.deepEqual(check(), []);
  });
});

test('type-only cycles are not runtime cycles, including inline type imports', () => {
  fixture(({ module, source, check }) => {
    module('first');
    module('second');
    source('first', 'types/first.types.ts',
      "import type { Second } from '#src/modules/second/types/second.types';");
    source('second', 'types/second.types.ts',
      "import { type First } from '#src/modules/first/types/first.types';");
    assert.deepEqual(check(), []);
  });
});

test('a runtime service edge and reverse type-only import are allowed', () => {
  fixture(({ module, source, check }) => {
    module('first',
      "import { SecondModule } from '#src/modules/second/second.module';");
    module('second');
    source('first', 'services/first.service.ts',
      "import { SecondService } from '#src/modules/second/services/second.service';");
    source('second', 'types/second.types.ts',
      "import type { FirstDto } from '#src/modules/first/types/first.types';");
    assert.deepEqual(check(), []);
  });
});

test('rejects a Nest module circular dependency', () => {
  fixture(({ module, check }) => {
    module('first',
      "import { SecondModule } from '#src/modules/second/second.module';");
    module('second',
      "import { FirstModule } from '#src/modules/first/first.module';");
    const problems = check().join('\n');
    assert.match(problems, /Nest module dependency cycle: first -> second -> first/);
    assert.match(problems, /Runtime feature dependency cycle: first -> second -> first/);
  });
});

test('detects a runtime cycle through domain services', () => {
  fixture(({ module, source, check }) => {
    module('first',
      "import { SecondModule } from '#src/modules/second/second.module';");
    module('second',
      "import { ThirdModule } from '#src/modules/third/third.module';");
    module('third',
      "import { FirstModule } from '#src/modules/first/first.module';");
    source('first', 'services/first.service.ts',
      "import { SecondService } from '#src/modules/second/services/second.service';");
    source('second', 'services/second.service.ts',
      "import { ThirdService } from '#src/modules/third/services/third.service';");
    source('third', 'services/third.service.ts',
      "import { FirstService } from '#src/modules/first/services/first.service';");
    assert.match(check().join('\n'),
      /Runtime feature dependency cycle: first -> second -> third -> first/);
  });
});

test('forbids imports of another feature controller and private repository', () => {
  fixture(({ module, source, check }) => {
    module('first',
      "import { SecondModule } from '#src/modules/second/second.module';");
    module('second');
    source('first', 'services/first.service.ts',
      "import { SecondController } from '#src/modules/second/controllers/second.controller';\n" +
      "import { SecondRepository } from '#src/modules/second/repositories/second.repository';");
    const issues = check().join('\n');
    assert.match(issues, /private cross-feature import.*controllers\/second.controller/);
    assert.match(issues, /private cross-feature import.*repositories\/second.repository/);
  });
});

test('allows only the audited cross-feature implementation contracts', () => {
  fixture(({ module, source, check }) => {
    module('auth', "import { UsersModule } from '#src/modules/users/users.module';");
    module('users');
    source('auth', 'services/credentials.service.ts',
      "import { UsersRepository } from '#src/modules/users/repositories/users.repository';");
    assert.deepEqual(check(), []);

    source('auth', 'services/credentials.service.ts',
      "import { OtherRepository } from '#src/modules/users/repositories/other.repository';");
    assert.match(check().join('\n'), /private cross-feature import/);
  });
});

test('rejects runtime provider injection if Nest module dependency is absent', () => {
  fixture(({ module, source, check }) => {
    module('first');
    module('second');
    source('first', 'services/first.service.ts',
      "import { SecondService } from '#src/modules/second/services/second.service';");
    assert.match(check().join('\n'), /requires its Nest module in first.module.ts/);
  });
});

test('rejects cross-feature relative imports and unknown features', () => {
  fixture(({ module, source, check }) => {
    module('first');
    module('second');
    source('first', 'services/first.service.ts',
      "import { SecondService } from '../../second/services/second.service.js';\n" +
      "import { Ghost } from '#src/modules/ghost/types/ghost.types';");
    const problems = check().join('\n');
    assert.match(problems, /cross-feature relative import/);
    assert.match(problems, /unknown feature 'ghost'/);
  });
});

test('test files can import cross-feature internals for integration testing', () => {
  fixture(({ module, source, check }) => {
    module('first');
    module('second');
    source('first', 'test/example.spec.ts',
      "import { OtherController } from '#src/modules/second/controllers/other.controller';");
    assert.deepEqual(check(), []);
  });
});

test('reports missing feature modules without loading application dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'gym-feature-deps-empty-'));
  try {
    assert.match(checkFeatureDependencies(root).join('\n'),
      /feature directory is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('a type-only re-export cycle is not a runtime feature cycle', () => {
  fixture(({ module, source, check }) => {
    module('first');
    module('second');
    source('first', 'types/first.types.ts',
      "export type { Second } from '#src/modules/second/types/second.types';");
    source('second', 'types/second.types.ts',
      "export { type First } from '#src/modules/first/types/first.types';");
    assert.deepEqual(check(), []);
  });
});

test('runtime re-exports contribute to a feature dependency cycle', () => {
  fixture(({ module, source, check }) => {
    module('first');
    module('second');
    source('first', 'types/index.ts',
      "export * from '#src/modules/second/types/index';");
    source('second', 'types/index.ts',
      "export { Runtime } from '#src/modules/first/types/index';");
    assert.match(check().join('\n'),
      /Runtime feature dependency cycle: first -> second -> first/);
  });
});

test('an import type query does not add a runtime cycle', () => {
  fixture(({ module, source, check }) => {
    module('first');
    module('second');
    source('first', 'types/first.types.ts',
      "export type Second = import('#src/modules/second/types/second.types').Second;");
    source('second', 'types/second.types.ts',
      "export type First = typeof import('#src/modules/first/types/first.types').First;");
    assert.deepEqual(check(), []);
  });
});

test('literal dynamic imports cannot bypass private feature boundaries', () => {
  fixture(({ module, source, check }) => {
    module('first');
    module('second');
    source('first', 'services/first.service.ts',
      "export async function load() { return import('#src/modules/second/controllers/secret.controller'); }");
    assert.match(check().join('\n'), /private cross-feature import/);
  });
});

test('computed imports fail with a path and source line', () => {
  fixture(({ module, source, check }) => {
    module('first');
    source('first', 'services/first.service.ts',
      "const target = './other.js';\nexport const load = () => import(target);");
    assert.match(check().join('\n'),
      /first.service.ts:2: computed dynamic import cannot be checked statically/);
  });
});

test('fake imports inside comments and strings do not add dependencies', () => {
  fixture(({ module, source, check }) => {
    module('first');
    module('second');
    const other = '#src/modules/second/controllers/secret.controller';
    source('first', 'services/first.service.ts',
      '// import { Secret } from "' + other + '";\n' +
      'export const note = "export * from ' + other + '";');
    assert.deepEqual(check(), []);
  });
});
