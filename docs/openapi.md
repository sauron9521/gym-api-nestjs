# Gym API OpenAPI and generated TypeScript types

The backend uses **NestJS 12**, **Zod 4 Standard Schema** and
`@nestjs/swagger@12.1.1`. Swagger reads `@Body({ schema: zodSchema })`
and `@Query({ schema: zodSchema })` metadata without duplicate DTO schemas.
`@nestjs/swagger` also lists the existing class-validator authentication
DTOs; further response schemas and examples can be added incrementally.

## Enable Swagger UI locally

By default, documentation endpoints are **disabled**. To enable in a
local, trusted development environment:

```powershell
$env:ENABLE_OPENAPI = "true"
npm run start:dev
```

- Swagger UI: `http://localhost:3000/api/docs`
- OpenAPI JSON: `http://localhost:3000/api/openapi.json`

The production server must not enable documentation unless explicitly intended.
Authentication, CSRF and endpoint permissions are unchanged. Swagger security
schemes describe Bearer JWT and the `__Host-sid` session cookie. Methods
accept whichever authentication mode their existing Nest authentication
middleware permits; the documentation does not grant access.

## Export the contract without running a server

```powershell
npm ci
npm run docs:openapi
```

Output: `openapi/openapi.json`. The script builds the app with TypeScript first (so Nest dependency injection
receives emitted decorator metadata), creates a Nest application, scans
registered routes and closes the app without opening an HTTP port.
The artifact is generated and gitignored. GitHub Actions validates the
export on every push.

## Generate types for Next.js / Expo

`openapi-typescript@7.13.0` has a peer requirement on **TypeScript 5**
and is not safe to install directly alongside this backend's TypeScript 6.
The script runs the CLI with an **isolated TypeScript 5.9.3 toolchain**, with
the versions pinned, without changing the backend's installed compiler:

```powershell
npm run docs:openapi
npm run docs:types
```

Output: `openapi/api-types.d.ts`. The generated file can be moved into a
future Nx `packages/api-types` shared package for Next.js and Expo.
Only declare a client contract authoritative when request and response
schemas for that operation are present and verified. Some dynamic Prisma
response shapes still require explicit `@ApiOkResponse` declarations
or response DTO schemas in follow-up work.

For a client app, consider `openapi-fetch` together with the generated
`paths` type; handle session cookies/CSRF or Bearer tokens intentionally.
Never ship backend secrets, session tokens or passwords as generated data.

## Maintenance

- Keep Zod request schemas as the single source of input validation.
- Explicitly document class-validator DTOs, multipart uploads, error
  responses and privacy-sensitive response schemas.
- Preserve access-control behavior: OpenAPI merely describes it.
- If a route changes, regenerate and review the contract during PR CI.
- No Prisma schema changes or migrations are required.
