import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';

dotenv.config({ path: '.env.test' });

export default defineConfig({
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
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
  },
});
