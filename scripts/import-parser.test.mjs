import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseModuleImports } from './import-parser.mjs';

const scan = (source) => parseModuleImports(source, 'fixtures/example.ts');

test('distinguishes type-only and value imports including mixed bindings', () => {
  const imports = scan([
    "import type { A, B } from './types-only.js';",
    "import { type A, type B as Renamed } from './inline-types.js';",
    "import { type A, value as B } from './mixed.js';",
    "import Core, { type A } from './default.js';",
    "import * as namespace from './namespace.js';",
    "import './side-effect.js';",
  ].join('\n'));
  assert.deepEqual(imports.map(({ path, typeOnly }) => [path, typeOnly]), [
    ['./types-only.js', true],
    ['./inline-types.js', true],
    ['./mixed.js', false],
    ['./default.js', false],
    ['./namespace.js', false],
    ['./side-effect.js', false],
  ]);
});

test('detects runtime and type-only re-exports', () => {
  const imports = scan([
    "export type { User } from './type-export.js';",
    "export { type User, type Member } from './inline-type-export.js';",
    "export { type User, runtime } from './mixed-export.js';",
    "export * from './star-export.js';",
    "export type * from './star-types.js';",
    "export * as lib from './namespace-export.js';",
    "export {} from './empty-export.js';",
  ].join('\n'));
  assert.deepEqual(imports.map(({ path, typeOnly }) => [path, typeOnly]), [
    ['./type-export.js', true],
    ['./inline-type-export.js', true],
    ['./mixed-export.js', false],
    ['./star-export.js', false],
    ['./star-types.js', true],
    ['./namespace-export.js', false],
    ['./empty-export.js', false],
  ]);
});

test('detects literal dynamic imports and distinguishes type queries', () => {
  const imports = scan([
    "const promise = import('./live.js');",
    'const template = import(' + String.fromCharCode(96) + './literal.js' + String.fromCharCode(96) + ');',
    "const requireValue = require('./legacy.js');",
    "type TypeQuery = import('./type-query.js').TypeQuery;",
    "type TypeOfQuery = typeof import('./typeof-query.js').something;",
  ].join('\n'));
  assert.deepEqual(imports.map(({ path, typeOnly, kind }) => [path, typeOnly, kind]), [
    ['./live.js', false, 'dynamic-import'],
    ['./literal.js', false, 'dynamic-import'],
    ['./legacy.js', false, 'require'],
    ['./type-query.js', true, 'type-query'],
    ['./typeof-query.js', true, 'type-query'],
  ]);
});

test('ignores comments, plain strings, regexes and unrelated from clauses', () => {
  const fakePath = '#src/modules/other/controllers/private.controller';
  const imports = scan([
    '// import { X } from "' + fakePath + '";',
    '/* export * from "' + fakePath + '"; */',
    'const text = "import(' + fakePath + ')";',
    'const regexp = /import\\(/;',
    'const from = { value: "from ' + fakePath + '" };',
    'export const value = 1;',
  ].join('\n'));
  assert.deepEqual(imports, []);
});

test('computed dynamic imports emit an actionable unresolved marker', () => {
  const statement = 'const value = import(' + String.fromCharCode(96) +
    './modules/$' + '{name}.js' + String.fromCharCode(96) + ');';
  const imports = scan(statement);
  assert.equal(imports.length, 1);
  assert.equal(imports[0].path, null);
  assert.equal(imports[0].kind, 'dynamic-unresolved');
  assert.equal(imports[0].line, 1);
});

test('handles multiple statements separated only by newlines', () => {
  const imports = scan([
    "import { A } from './first.js'",
    "export { B } from './second.js'",
    "import type { C } from './third.js'",
  ].join('\n'));
  assert.deepEqual(imports.map(({ path }) => path), [
    './first.js', './second.js', './third.js',
  ]);
});
