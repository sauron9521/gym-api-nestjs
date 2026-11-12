import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const metrics = ['statements', 'branches', 'functions', 'lines'];
const criticalModules = ['auth', 'workouts', 'training-programs'];

function aggregate(summary, moduleName) {
  const marker = `src/modules/${moduleName}/`;
  const files = Object.entries(summary).filter(([path]) => {
    const normalized = path.replaceAll('\\', '/');
    return normalized.startsWith(marker) || normalized.includes(`/${marker}`);
  });

  if (files.length === 0) {
    throw new Error(`Missing coverage entries for critical module: ${moduleName}`);
  }

  return Object.fromEntries(
    metrics.map((metric) => [
      metric,
      files.reduce(
        (totals, [, entry]) => ({
          covered: totals.covered + entry[metric].covered,
          total: totals.total + entry[metric].total,
        }),
        { covered: 0, total: 0 },
      ),
    ]),
  );
}

function percentage(value) {
  if (!value || !Number.isFinite(value.covered) || !Number.isFinite(value.total)) {
    throw new Error('Invalid coverage metric');
  }
  if (value.total === 0) return '100.00%';
  return `${((value.covered / value.total) * 100).toFixed(2)}%`;
}

export function renderCoverageSummary(summary) {
  if (!summary || !summary.total) {
    throw new Error('Missing aggregate coverage total');
  }

  const rows = [
    ['All measured source', summary.total],
    ...criticalModules.map((name) => [name, aggregate(summary, name)]),
  ];

  return [
    '### Unit-test coverage (Vitest / V8)',
    '',
    '| Scope | Statements | Branches | Functions | Lines |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows.map(
      ([name, values]) =>
        `| ${name} | ${metrics.map((metric) => percentage(values[metric])).join(' | ')} |`,
    ),
    '',
    '> Coverage tracks source files instrumented by the unit-test run; integration/E2E tests run separately.',
    '',
  ].join('\\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
  const markdown = renderCoverageSummary(summary);

  process.stdout.write(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
}
