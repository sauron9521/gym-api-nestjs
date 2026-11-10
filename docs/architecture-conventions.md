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

## Domain-layer import and placement rules (PR #105)

The same architecture command now checks files directly in the feature's
`services/`, `repositories/`, `selects/` and `types/` directories, in
addition to module files and HTTP controller tests.

- Files named `*.service.ts`, `*.repository.ts`, `*.select.ts` and
  `*.types.ts` must be placed in their corresponding managed folder when
  declared at the feature root or directly inside one of these four layers.
- All TypeScript sources directly inside managed folders, including
  `index.ts` barrels and implementation helpers, must use relative
  `.js` extensions, native extensionless `#src/*` / `#prisma/*` aliases,
  and native aliases instead of `@src/*` / `@prisma/*`. Cross-feature
  relative imports are forbidden.
- Domain layers must never depend on same-feature HTTP controllers.
  Repositories, selects and types must not depend on their feature's
  `services/` layer. The guard recognizes both relative imports and
  same-feature `#src/modules/<feature>/...` aliases.
- Layer directories remain optional: Auth has no local `repositories/`,
  and Workout Analytics has no `selects/`. Files with general helper names
  are valid in their layers (for example `workout-locks.ts`), as are
  `index.ts` barrels. Independently organized nested subfeatures such as
  `users/avatar/` are intentionally not flattened into these root layers.

The scope is deliberate: this is not a blanket ban on cross-feature service
APIs, nor a forced repository/select convention for every future feature.
The initial audit covered **63** layer files across eight modules with no
existing native ESM or same-feature reverse-dependency violations. Five
additional dependency-free `node:test` fixtures cover permitted helpers
and the new failure cases.

Both existing commands (`npm run architecture:check` and
`npm run test:architecture`) run as part of the required CI quality job.
No changes to GitHub Actions, application runtime, Prisma or npm dependencies
are necessary.
