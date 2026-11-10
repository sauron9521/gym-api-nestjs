# Users module HTTP controller layout (PR #102)

## Structure

- `users.module.ts` stays at the feature root and registers `UsersController` then `AvatarPublicController`, preserving controller order.
- `controllers/users.controller.ts` implements authenticated `/users/me` reads/updates and avatar upload/removal. Its service, DTO and avatar imports use same-feature relative NodeNext `.js` paths.
- `controllers/avatar-public.controller.ts` implements anonymous `GET /avatars/:key` and imports the avatar service from `../avatar/avatar.service.js`. Avatar persistence, validation, encoding and cleanup remain in `avatar/`.
- `test/controllers/` verifies the five verb/path contracts, controller registration/order, avatar upload/delete HTTP 200 overrides and 5/min throttling, identity-safe service delegation, and the public avatar stream response's security headers.

## Preserved behavior

- The account routes still use Nest `@Authenticate()` and `@CurrentUser()`; the avatar read route keeps its distinct `@Public()` decorator.
- Upload still uses a single `file` multipart part with existing Multer size/part limits, image processing, 200 response and existing OpenAPI declarations.
- Public avatar reads remain scoped to current assignments in `AvatarService.readPublic` and continue to send `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` and `Cross-Origin-Resource-Policy: cross-origin`.
- No paths, status codes, user/profile DTOs, authorization decisions, business logic, database schema, storage semantics or dependencies change.

Keep running all CI gates including OpenAPI contracts, authenticated and anonymous E2E coverage, production Docker smoke, lint and security audits.
