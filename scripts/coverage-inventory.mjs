import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ignoredDirectories = new Set([
  'generated', 'test', 'tests', '__tests__', '__fixtures__',
]);

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Match production TS/TSX candidates while honoring Vitest's generated/index
 * exclusions. Type-only declarations/folders have no executable statements.
 */
export function isProductionSourcePath(path) {
  const normalized = normalizePath(path);
  if (!normalized.startsWith('src/') || !/\.tsx?$/.test(normalized)) return false;

  const segments = normalized.split('/');
  const name = segments.at(-1);
  if (
    segments.some((segment) => ignoredDirectories.has(segment)) ||
    segments.includes('types') ||
    name === 'index.ts' ||
    name === 'index.tsx' ||
    /\.(?:d|spec|test|e2e-spec|types|type)\.tsx?$/.test(name)
  ) {
    return false;
  }
  return true;
}

/** Recursively list production candidates without following symlinks. */
export function listProductionSourcePaths(projectRoot) {
  const paths = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && entry.name !== 'types') walk(fullPath);
      } else if (entry.isFile()) {
        const path = normalizePath(relative(projectRoot, fullPath));
        if (isProductionSourcePath(path)) paths.push(path);
      }
    }
  }
  walk(join(projectRoot, 'src'));
  return paths.sort();
}

function coverageSourcePath(coveragePath) {
  const normalized = normalizePath(coveragePath);
  if (normalized.startsWith('src/')) return normalized;
  const index = normalized.lastIndexOf('/src/');
  return index < 0 ? null : normalized.slice(index + 1);
}

function scopeForSource(path) {
  const segments = path.split('/');
  if (segments[1] === 'modules' && segments[2]) return 'modules/' + segments[2];
  return segments[1] ?? 'src';
}

/**
 * Reports file presence in unit coverage, not executable line/branch coverage.
 * Missing files can be bootstrap entrypoints or non-executable source.
 */
export function buildCoverageInventory(sourcePaths, summary) {
  if (!summary || typeof summary !== 'object' || !summary.total) {
    throw new Error('Missing aggregate coverage total');
  }
  if (!Array.isArray(sourcePaths)) throw new TypeError('Source paths must be an array');

  const measured = new Set(
    Object.keys(summary)
      .filter((key) => key !== 'total')
      .map(coverageSourcePath)
      .filter((path) => path && isProductionSourcePath(path)),
  );
  if (measured.size === 0) {
    throw new Error('Coverage report contains no production source file entries');
  }

  const candidates = [...new Set(
    sourcePaths.map(normalizePath).filter(isProductionSourcePath),
  )].sort();
  if (candidates.length === 0) throw new Error('No eligible production source files found');

  const measuredPaths = candidates.filter((path) => measured.has(path));
  const unmeasuredPaths = candidates.filter((path) => !measured.has(path));
  const scopes = new Map();
  for (const path of candidates) {
    const name = scopeForSource(path);
    const scope = scopes.get(name) ?? { scope: name, eligible: 0, measured: 0, unmeasured: 0 };
    scope.eligible++;
    if (measured.has(path)) scope.measured++;
    else scope.unmeasured++;
    scopes.set(name, scope);
  }

  return {
    eligible: candidates.length,
    measured: measuredPaths.length,
    unmeasured: unmeasuredPaths.length,
    measuredPaths,
    unmeasuredPaths,
    scopes: [...scopes.values()].sort((a, b) => a.scope.localeCompare(b.scope)),
  };
}

export function renderCoverageInventory(inventory, maxPaths = 40) {
  const shown = inventory.unmeasuredPaths.slice(0, maxPaths);
  const tick = String.fromCharCode(96);
  return [
    '### Unit coverage source inventory',
    '',
    '**' + inventory.measured + ' of ' + inventory.eligible +
      '** eligible production source files appear in the unit-test V8 coverage summary; **' +
      inventory.unmeasured + '** do not.',
    '',
    '| Scope | Eligible files | Measured files | Unmeasured files |',
    '| --- | ---: | ---: | ---: |',
    ...inventory.scopes.map(({ scope, eligible, measured, unmeasured }) =>
      '| ' + scope + ' | ' + eligible + ' | ' + measured + ' | ' + unmeasured + ' |',
    ),
    '',
    '#### Source files absent from unit coverage (first ' + shown.length + ')',
    '',
    ...(shown.length
      ? shown.map((path) => '- ' + tick + path + tick)
      : ['No eligible files are missing from the coverage report.']),
    ...(inventory.unmeasured > shown.length
      ? ['', (inventory.unmeasured - shown.length) +
          ' additional paths are in ' + tick + 'coverage/source-inventory.json' + tick + '.']
      : []),
    '',
    '> **Inventory, not zero coverage:** absent entries are not assumed to have 0% lines/branches. Some may be entry points or type-only modules. This report does not change Vitest thresholds or include patterns; integration/E2E coverage is separate.',
    '',
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const summary = JSON.parse(readFileSync(join(root, 'coverage/coverage-summary.json'), 'utf8'));
  const inventory = buildCoverageInventory(listProductionSourcePaths(root), summary);
  writeFileSync(
    join(root, 'coverage/source-inventory.json'),
    JSON.stringify(inventory, null, 2) + '\n',
  );

  const markdown = renderCoverageInventory(inventory);
  process.stdout.write(markdown + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
  }
}
