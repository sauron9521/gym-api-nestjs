import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
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
      exclude: ['generated/**', '**/index.ts'],
      // Baseline on main before PR #36:
      // statements 68.49%, branches 59.55%, functions 65.32%, lines 68.98%.
      // Enforce an initial regression floor; raise it as coverage improves.
      thresholds: {
        statements: 65,
        branches: 55,
        functions: 60,
        lines: 65,
      },
    },
  },
});
