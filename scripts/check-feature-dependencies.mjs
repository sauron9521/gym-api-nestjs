import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseModuleImports } from './import-parser.mjs';

// Explicitly reviewed shared implementation contracts. Other features must
// use a module/service/type API rather than reaching into private internals.
const APPROVED_INTERNAL_IMPORTS = new Map([
  ['users/repositories/users.repository', new Set(['auth', 'trainer-athletes'])],
  ['exercises/policies/exercise-access.policy', new Set(['workouts'])],
  ['exercises/selects/exercise.select', new Set(['workouts'])],
  ['workouts/policies/workout-access.policy', new Set(['workout-analytics'])],
]);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
    }).sort();
}

function outside(directory, target) {
  const path = relative(directory, target);
  return path === '..' || path.startsWith('..' + sep) || isAbsolute(path);
}

function addEdge(graph, from, to) {
  if (from !== to) graph.get(from).add(to);
}

function firstCycle(graph) {
  const visited = new Set();
  const active = new Set();
  const stack = [];

  const visit = (node) => {
    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const target of [...graph.get(node)].sort()) {
      if (active.has(target)) {
        return [...stack.slice(stack.indexOf(target)), target];
      }
      if (!visited.has(target)) {
        const found = visit(target);
        if (found) return found;
      }
    }
    active.delete(node);
    stack.pop();
    return null;
  };

  for (const node of [...graph.keys()].sort()) {
    if (!visited.has(node)) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Checks the source-level runtime dependency graph separately from type-only
 * references; checks Nest module imports and direct cross-feature boundaries.
 * No project compilation, Prisma, database or runtime imports are necessary.
 */
export function checkFeatureDependencies(repositoryRoot) {
  const modulesRoot = join(resolve(repositoryRoot), 'src', 'modules');
  if (!existsSync(modulesRoot)) return ['src/modules: feature directory is missing'];

  const modules = readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(modulesRoot, name, name + '.module.ts')))
    .sort();
  if (modules.length === 0) return ['src/modules: no feature modules found'];

  const known = new Set(modules);
  const runtime = new Map(modules.map((name) => [name, new Set()]));
  const nestModules = new Map(modules.map((name) => [name, new Set()]));
  const moduleSources = new Map(modules.map((name) => [
    name,
    readFileSync(join(modulesRoot, name, name + '.module.ts'), 'utf8'),
  ]));
  const errors = [];

  for (const name of modules) {
    const files = walk(join(modulesRoot, name)).filter((file) =>
      file.endsWith('.ts') && !relative(join(modulesRoot, name), file).split(sep).includes('test'),
    );

    for (const file of files) {
      const display = relative(resolve(repositoryRoot), file).split(sep).join('/');
      for (const imported of parseModuleImports(readFileSync(file, 'utf8'), file)) {
        if (imported.path === null) {
          errors.push(display + ':' + imported.line +
            ': computed dynamic import cannot be checked statically; use a string literal');
          continue;
        }
        let targetFeature;
        let targetPath;
        let relativeCrossFeature = false;

        const alias = /^#src\/modules\/([^/]+)\/(.+)$/.exec(imported.path);
        if (alias) {
          targetFeature = alias[1];
          targetPath = alias[2];
        } else if (imported.path.startsWith('./') || imported.path.startsWith('../')) {
          const target = resolve(dirname(file), imported.path);
          if (!outside(modulesRoot, target)) {
            const parts = relative(modulesRoot, target).split(sep);
            if (parts[0] !== name) {
              targetFeature = parts[0];
              relativeCrossFeature = true;
            }
          }
        }

        if (!targetFeature || targetFeature === name) continue;

        if (relativeCrossFeature) {
          errors.push(display + ": cross-feature relative import '" +
            imported.path + "'; use #src/modules/<feature>/...");
        }

        if (!known.has(targetFeature)) {
          errors.push(display + ": unknown feature '" + targetFeature +
            "' in import '" + imported.path + "'");
          continue;
        }

        if (!imported.typeOnly) {
          addEdge(runtime, name, targetFeature);
          if (file === join(modulesRoot, name, name + '.module.ts') &&
              targetPath === targetFeature + '.module') {
            addEdge(nestModules, name, targetFeature);
          }
        }

        // Only the foreign module class, services and exported types are
        // general-purpose interfaces. Other paths need a narrowly scoped
        // reviewed exception, independent of whether the import is type-only.
        if (targetPath) {
          const isModule = targetPath === targetFeature + '.module';
          const isServiceOrType = targetPath.startsWith('services/') ||
            targetPath.startsWith('types/');
          const approved = APPROVED_INTERNAL_IMPORTS.get(
            targetFeature + '/' + targetPath,
          )?.has(name);
          if (!isModule && !isServiceOrType && !approved) {
            errors.push(display + ": private cross-feature import '" +
              imported.path + "'; expose a service/type contract or review an exception");
          }

          const isDependencyInjected = !imported.typeOnly &&
            (targetPath.startsWith('services/') ||
             targetPath.startsWith('repositories/'));
          if (isDependencyInjected) {
            const moduleImports = parseModuleImports(moduleSources.get(name), name + '.module.ts');
            if (!moduleImports.some((entry) =>
              entry.path === '#src/modules/' + targetFeature + '/' + targetFeature + '.module' &&
              !entry.typeOnly)) {
              errors.push(display + ": runtime provider import from '" + targetFeature +
                "' requires its Nest module in " + name + '.module.ts');
            }
          }
        }
      }
    }
  }

  const moduleCycle = firstCycle(nestModules);
  if (moduleCycle) {
    errors.push('Nest module dependency cycle: ' + moduleCycle.join(' -> '));
  }
  const runtimeCycle = firstCycle(runtime);
  if (runtimeCycle) {
    errors.push('Runtime feature dependency cycle: ' + runtimeCycle.join(' -> '));
  }

  return [...new Set(errors)].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkFeatureDependencies(process.cwd());
  if (errors.length > 0) {
    console.error('Feature dependency violations:\n' + errors.map((error) => ' - ' + error).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Feature dependency graph and import boundaries: OK');
  }
}
