# Native ESM imports and module boundaries (PR #48)

This application uses Node.js 22, TypeScript NodeNext, NestJS 12, Prisma 7,
and Vite/Vitest. Prefer **native Node package imports**, not aliases that
require a post-build rewrite or custom runtime loader.

## Alias conventions

- \`#src/*\` — application-wide imports when crossing architectural
  boundaries (feature modules, common, infra, app bootstrap).
- \`#prisma/*\` — generated Prisma Client exports (for example,
  \`#prisma/client\` and \`#prisma/enums\`).
- Relative \`./\` and \`../\` imports ending with \`.js\` — files belonging
  to the **same feature module** or same infrastructure package.
- Third-party packages use their normal package names.

Example:

\`\`\`ts
import { PrismaService } from '#src/infra/database/prisma.service';
import type { Prisma } from '#prisma/client';
import { userPublicSelect } from './selects/user.select.js';
\`\`\`

**Alias specifiers must not end in \`.js\`**. They use package.json
\`imports\` with TypeScript \`types\` and Node \`default\` conditions, plus
\`tsconfig.paths\` for Vite 8's existing \`resolve.tsconfigPaths\` setting.
The \`default\` condition points to **compiled dist JavaScript**; the
\`types\` condition and tsconfig paths resolve to **src TypeScript**.
Node resolves aliases natively after compilation without \`tsconfig-paths\`,
\`module-alias\`, import hooks or bundling.

Do not use \`@src/*\` purely as a TypeScript path alias: without a
runtime transform Node would not resolve it in built ESM. Node-native
internal import aliases must begin with \`#\`.


### Vitest identity and source resolution

Node's native imports map \`#src/*\` to compiled \`dist\` in production.
Vitest **must not** load these compiled modules while tests import others
via relative \`src\` paths: Nest DI uses class identity as its provider
token, and two copies of PrismaService are not interchangeable.

Both Vitest configs explicitly point \`#src\` and \`#prisma\` aliases to
their source locations using \`resolve.alias\`, in addition to
\`tsconfigPaths\`. The production build and the native Node smoke test
still use \`package.json#imports\` directly. Do not remove these Vitest
source aliases without an equivalent test that proves provider identity.

## Verification

After editing import boundaries, run:

\`\`\`sh
npm run db:generate
npm run lint
npm run build
npm run imports:smoke
npm run docs:openapi
npm test
npm run test:e2e
npm run test:cov
\`\`\`

The smoke command imports actual compiled files via \`#src/*\` and
\`#prisma/*\`. CI also tests the compiled production Docker runtime,
OpenAPI export and PostgreSQL-integrated HTTP flows.

The generated Prisma client stays under
\`src/infra/database/generated/prisma/\`, and source/generated files
remain gitignored. No Prisma migrations or HTTP API contract changes.

## Notes

- This PR changes import specifiers and related tooling only; it does not
  rearrange business service and repository files.
- Avoid importing private internals of another feature module when a
  clearly defined public service/module boundary exists. Aliases make
  a path convenient; they do not grant permission to bypass architecture.
- Keep type-only dependencies as \`import type\` to avoid extra runtime
  imports or unintended circular dependencies.
- Be careful with circular imports through \`index.ts\` barrels. Prefer
  explicit files for generated Prisma and deeply nested modules.
