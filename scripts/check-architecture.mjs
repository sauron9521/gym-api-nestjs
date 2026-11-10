import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseModuleImports } from './import-parser.mjs';

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
    })
    .sort();
}

function isOutside(directory, target) {
  const path = relative(directory, target);
  return path === '..' || path.startsWith('..' + sep) || isAbsolute(path);
}

/**
 * Non-mutating, dependency-free guard for structural conventions in src/modules.
 * Returns actionable diagnostics, allowing isolated filesystem fixtures in tests.
 */
export function checkArchitecture(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const modulesRoot = join(root, 'src', 'modules');
  const errors = [];

  if (!existsSync(modulesRoot)) {
    return ['src/modules: feature module directory is missing'];
  }

  const modules = readdirSync(modulesRoot, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .filter((name) => existsSync(join(modulesRoot, name, `${name}.module.ts`)))
    .sort();

  if (modules.length === 0) {
    return ['src/modules: no feature modules found'];
  }

  for (const name of modules) {
    const directory = join(modulesRoot, name);
    const moduleFile = join(directory, `${name}.module.ts`);
    const controllerDir = join(directory, 'controllers');
    const testDir = join(directory, 'test', 'controllers');
    const moduleSource = readFileSync(moduleFile, 'utf8');
    const featureFiles = filesUnder(directory);
    // Helper files and index barrels are legitimate members of domain layers.
    const domainLayers = ['services', 'repositories', 'selects', 'types'];
    const domainFiles = domainLayers.flatMap((layer) =>
      filesUnder(join(directory, layer)).filter(
        (file) => dirname(file) === join(directory, layer) && file.endsWith('.ts'),
      ),
    );
    const controllers = filesUnder(controllerDir)
      .filter((path) => dirname(path) === controllerDir && path.endsWith('.controller.ts'));
    const controllerNames = new Set(controllers.map((path) => basename(path)));
    const testFiles = filesUnder(testDir)
      .filter((path) => dirname(path) === testDir && path.endsWith('.spec.ts'));

    const display = (file) => relative(root, file).split('\\').join('/');

    // Enforce role suffix locations at the feature root and in managed
    // domain directories only; nested subfeatures such as users/avatar/
    // deliberately manage their own implementation layout.
    const roleFolders = [
      ['.service.ts', 'services'],
      ['.repository.ts', 'repositories'],
      ['.select.ts', 'selects'],
      ['.types.ts', 'types'],
    ];
    for (const file of featureFiles) {
      const parent = dirname(file);
      if (parent !== directory && !domainLayers.some(
        (layer) => parent === join(directory, layer),
      )) continue;

      for (const [suffix, folder] of roleFolders) {
        if (basename(file).endsWith(suffix) && parent !== join(directory, folder)) {
          errors.push(`${display(file)}: ${suffix} file must live in ${folder}/`);
        }
      }
    }

    if (controllers.length === 0) {
      errors.push(`${name}: expected controllers/*.controller.ts`);
    }

    for (const file of featureFiles) {
      if (file.endsWith('.controller.ts') && !controllerNames.has(basename(file))) {
        // Check the absolute directory too: files with equal names in a
        // different directory must still be reported.
        if (dirname(file) !== controllerDir) {
          errors.push(`${display(file)}: controller must live directly in controllers/`);
        }
      } else if (file.endsWith('.controller.ts') && dirname(file) !== controllerDir) {
        errors.push(`${display(file)}: controller must live directly in controllers/`);
      }
    }

    const registered = moduleSource.match(/\bcontrollers\s*:\s*\[([\s\S]*?)\]/);
    if (!registered) {
      errors.push(`${display(moduleFile)}: missing @Module controllers array`);
    }

    const registeredNames = registered
      ? registered[1].split(',').map((value) => value.trim()).filter(Boolean)
      : [];

    if (new Set(registeredNames).size !== registeredNames.length) {
      errors.push(`${display(moduleFile)}: duplicate controller registrations`);
    }

    for (const controller of controllers) {
      const filename = basename(controller);
      const source = readFileSync(controller, 'utf8');
      const className = source.match(/\bexport\s+class\s+(\w+Controller)\b/)?.[1];
      const expectedImport = `./controllers/${filename.replace(/\.ts$/, '.js')}`;
      const expectedSpec = join(testDir, filename.replace(/\.ts$/, '.spec.ts'));

      if (!className) {
        errors.push(`${display(controller)}: missing exported controller class`);
      } else if (!registeredNames.includes(className)) {
        errors.push(`${display(moduleFile)}: ${className} not registered`);
      }

      if (!parseModuleImports(moduleSource, moduleFile).some((entry) =>
        entry.path === expectedImport && !entry.typeOnly)) {
        errors.push(`${display(moduleFile)}: import controller directly from '${expectedImport}'`);
      }

      if (!existsSync(expectedSpec)) {
        errors.push(`${display(expectedSpec)}: missing controller unit test`);
      }
    }

    for (const className of registeredNames) {
      const found = controllers.some((path) => {
        const source = readFileSync(path, 'utf8');
        return source.match(/\bexport\s+class\s+(\w+Controller)\b/)?.[1] === className;
      });
      if (!found) {
        errors.push(`${display(moduleFile)}: unrecognized registered controller '${className}'`);
      }
    }

    if (!testFiles.some((path) => basename(path).endsWith('controller-registry.spec.ts'))) {
      errors.push(`${name}: expected test/controllers/*controller-registry.spec.ts`);
    }

    for (const testFile of testFiles.filter((path) => path.endsWith('.controller.spec.ts'))) {
      const expectedController = basename(testFile).replace(/\.spec\.ts$/, '.ts');
      if (!controllerNames.has(expectedController)) {
        errors.push(`${display(testFile)}: no matching controller in controllers/`);
      }
    }

    // Validate imports in domain layers as well as HTTP/controller boundaries.
    for (const file of [moduleFile, ...controllers, ...testFiles, ...domainFiles]) {
      const sourceLayer = domainLayers.find(
        (layer) => dirname(file) === join(directory, layer),
      );
      for (const imported of parseModuleImports(readFileSync(file, 'utf8'), file)) {
        if (imported.path === null) {
          errors.push(`${display(file)}:${imported.line}: computed dynamic import cannot be checked statically; use a string literal`);
          continue;
        }
        const specifier = imported.path;
        if (specifier.startsWith('@src/') || specifier.startsWith('@prisma/')) {
          errors.push(`${display(file)}: use native #src/#prisma instead of '${specifier}'`);
        } else if (specifier.startsWith('#src/') || specifier.startsWith('#prisma/')) {
          if (specifier.endsWith('.js') || specifier.endsWith('.ts')) {
            errors.push(`${display(file)}: native alias must omit .js/.ts: '${specifier}'`);
          }
        } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
          if (!specifier.endsWith('.js')) {
            errors.push(`${display(file)}: relative ESM import needs .js: '${specifier}'`);
          }
          if (isOutside(directory, resolve(dirname(file), specifier))) {
            errors.push(`${display(file)}: cross-feature relative import '${specifier}'; use #src/*`);
          }
        }

        if (sourceLayer) {
          let targetLayer;
          if (specifier.startsWith('./') || specifier.startsWith('../')) {
            const target = resolve(dirname(file), specifier);
            if (!isOutside(directory, target)) {
              targetLayer = relative(directory, target).split(sep)[0];
            }
          } else {
            const sameFeatureAlias = `#src/modules/${name}/`;
            if (specifier.startsWith(sameFeatureAlias)) {
              targetLayer = specifier.slice(sameFeatureAlias.length).split('/')[0];
            }
          }

          const forbidden = targetLayer === 'controllers' ||
            (sourceLayer !== 'services' && targetLayer === 'services');
          if (forbidden) {
            errors.push(`${display(file)}: ${sourceLayer}/ must not import ${targetLayer}/: '${specifier}'`);
          }
        }
      }
    }
  }

  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkArchitecture(process.cwd());
  if (problems.length > 0) {
    console.error('Feature architecture violations:\n' + problems.map((p) => ` - ${p}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Feature architecture conventions: OK');
  }
}
