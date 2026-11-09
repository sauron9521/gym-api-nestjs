# Infrastructure layout (structural refactor)

The application uses separate infrastructure and feature-module roots.

- `src/infra/database/` — Prisma module/service and generated Prisma Client.
- `src/infra/health/` — liveness and PostgreSQL readiness.
- `src/infra/openapi/` — Nest OpenAPI generation, exported response schemas and their tests.
- `src/modules/` — business features (unchanged in this PR).
- `src/common/` — reusable guards, filters and request context (unchanged in this PR).
- `src/config/` — application environment validation (will be moved to common in a later PR).

The Prisma schema, SQL migrations and seed remain in the root `prisma/`
folder. Client generation output changes from `src/generated/prisma/`
to `src/infra/database/generated/prisma/`; it remains gitignored.

## Safe local upgrade

After switching branches, run:

```bash
npm ci
npm run db:generate
npm run build
npm run db:validate
npm run docs:openapi
npm run docs:types
npm test
npm run test:e2e
npm run test:cov
```

Existing `dist/` contents are removed by Nest build. An old generated
`src/generated/` directory from the previous branch may remain on
developers' local machines; it is ignored by Git and can be deleted manually
after generating the new client. No database migration, table rename or
data migration is required for this source-path-only change.

Production Docker builds already regenerate the Prisma Client before
compilation and copy compiled code from `dist/`. The OpenAPI command now
invokes `dist/infra/openapi/export-openapi.js`; its outputs remain
`openapi/openapi.json` and `openapi/api-types.d.ts` at the repo root.

The public HTTP API, health routes, JSON response formats, auth and
business logic must remain unchanged. Full CI (including the production
Docker smoke test) guards the move. Native ESM aliases / package imports
are intentionally a separate PR and are **not** introduced here.

Do not move `src/mail/templates` without reviewing Nest asset copying:
`nest-cli.json` and the mail transport resolve them beneath
`dist/mail/templates`. This change leaves them intact.
