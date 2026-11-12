import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderCoverageSummary } from './coverage-report.mjs';

function entry(covered, total) {
  return Object.fromEntries(
    ['statements', 'branches', 'functions', 'lines'].map((metric) => [
      metric,
      { covered, total, pct: total ? (covered / total) * 100 : 100 },
    ]),
  );
}

describe('renderCoverageSummary', () => {
  it('aggregates covered/total counts across source files instead of averaging percentages', () => {
    const report = renderCoverageSummary({
      total: entry(17, 20),
      '/runner/src/modules/auth/auth.service.ts': entry(1, 2),
      '/runner/src/modules/auth/auth.store.ts': entry(9, 10),
      '/runner/src/modules/workouts/workouts.service.ts': entry(7, 8),
      '/runner/src/modules/training-programs/program.service.ts': entry(6, 8),
    });

    assert.match(report, /All measured source \| 85\.00% \|/);
    assert.match(report, /auth \| 83\.33% \| 83\.33%/);
    assert.match(report, /workouts \| 87\.50%/);
    assert.match(report, /training-programs \| 75\.00%/);
  });

  it('handles Windows-style paths and zero-total metrics', () => {
    const report = renderCoverageSummary({
      total: entry(0, 0),
      'C:\\repo\\src\\modules\\auth\\auth.service.ts': entry(0, 0),
      'C:\\repo\\src\\modules\\workouts\\workouts.service.ts': entry(0, 0),
      'C:\\repo\\src\\modules\\training-programs\\program.service.ts': entry(0, 0),
    });

    assert.match(report, /auth \| 100\.00%/);
  });

  it('fails if a critical module disappears from the coverage report', () => {
    assert.throws(
      () => renderCoverageSummary({
        total: entry(1, 2),
        '/runner/src/modules/auth/auth.service.ts': entry(1, 2),
        '/runner/src/modules/workouts/workouts.service.ts': entry(1, 2),
      }),
      /Missing coverage entries for critical module: training-programs/,
    );
  });
});
