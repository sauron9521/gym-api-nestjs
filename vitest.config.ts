import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    env: {
      JWT_SECRET: 'cAJVaf+PZ/XsS8My+YtdamtYlm2msoU2tVeCN3mQomc',
    },
    root: './',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/*.e2e-spec.ts'],
    coverage: {
      exclude: ['generated/**', '**/index.ts'],
    },
  },
});
