# Feature architecture guard (PR #104)

## Goal

The eight business modules now consistently keep HTTP controllers under `src/modules/<feature>/controllers/`, with focused tests under `test/controllers/`. The automated architecture guard protects that investment as new features and refactors land.

Run locally:

```sh
npm run architecture:check
npm run test:architecture
```

Both run without Prisma generation, a database, Docker or any new npm dependencies. GitHub Actions executes them inside the existing **Lint, build and tests** job, before lint/build; the required-gates job therefore blocks a merge if a convention breaks.

## Enforced conventions

1. Each discovered feature (`src/modules/<feature>/<feature>.module.ts`) keeps all its `*.controller.ts` files directly in `controllers/`, not at the feature root or nested in an implementation folder.
2. Every controller exports a `*Controller` class, is directly imported and registered once in its own Nest module, and has a corresponding `test/controllers/<name>.controller.spec.ts`.
3. Every feature has a dedicated `test/controllers/*controller-registry.spec.ts`. Orphan controller specs and duplicate or unknown controller registrations are rejected.
4. Relative imports in module files, HTTP controllers and their focused tests use native NodeNext `.js` suffixes. Cross-feature dependencies use native `#src/*` rather than relative traversals; `#src/*` and `#prisma/*` omit suffixes. TypeScript-only `@src/*` and `@prisma/*` aliases are rejected at these boundaries.

The script returns all violations in one run with paths and rule descriptions. Its own `node:test` fixtures cover both accepted and rejected structures, keeping regressions testable without a full application bootstrap.

## Scope and compatibility

The guard discovers feature directories rather than hard-coding the current eight. It checks the **controller/module/test boundaries**, not arbitrary internals in repositories, services, migrations, generated Prisma code or infrastructure; those broader rules can be adopted after their own baseline audit.

The guard is non-mutating: it does not rewrite imports or reorganize files. There is no runtime code or HTTP API change, no schema migration, and no dependency update. The existing `controllers/index.ts` compatibility exports and non-controller barrels remain allowed, while module controller imports use explicit files.
