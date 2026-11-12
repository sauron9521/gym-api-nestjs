import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: {
    // Native package imports point to dist at runtime. Vitest must resolve
    // the aliases to source to preserve Nest provider/class identity.
    tsconfigPaths: true,
    alias: {
      '#src': fileURLToPath(new URL('./src', import.meta.url)),
      '#prisma': fileURLToPath(
        new URL('./src/infra/database/generated/prisma', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    env: {
      JWT_SECRET: 'cAJVaf+PZ/XsS8My+YtdamtYlm2msoU2tVeCN3mQomc',
      JWT_ISSUER: 'http://localhost:3000',
    },
    root: './',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/*.e2e-spec.ts'],
    coverage: {
      exclude: ['**/generated/**', '**/index.ts'],
      reporter: ['text', 'html', 'clover', 'json', 'json-summary'],
      // Measured from successful main CI run 43107255423 (2026-11-11):
      // statements 79.11%, branches 69.96%, functions 77.05%, lines 79.53%.
      // Critical-module floors are calculated from the same coverage report.
      thresholds: {
        statements: 77,
        branches: 68,
        functions: 75,
        lines: 77,
        'src/modules/auth/**/*.ts': {
          statements: 73,
          branches: 61,
          functions: 61,
          lines: 73,
        },
        'src/modules/workouts/**/*.ts': {
          statements: 77,
          branches: 66,
          functions: 80,
          lines: 78,
        },
        'src/modules/training-programs/**/*.ts': {
          // Verified by successful PR #167 CI (run 43289865381):
          // statements 97.53%, branches 92.45%, functions 97.92%, lines 97.48%.
          // Leave a small buffer for routine, test-covered refactoring.
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
});
