# Managed profile avatars

Authenticated endpoints:

- `POST /users/me/avatar`: multipart/form-data, single `file` part, PNG/JPEG/WebP, <= 2 MiB.
- `DELETE /users/me/avatar`: clear the current avatar and remove the former managed file.
- `GET /avatars/:key`: unauthenticated read of **only** the avatar currently referenced by an active user.

Both upload and delete return `{ "avatarUrl": "/avatars/<uuid>.<extension>" }` (or null on delete).
The existing `GET /users/me` returns the URL in `profile.avatarUrl`;
no internal avatar key is exposed.

## Security and lifecycle

- The server checks file bytes, supported signature, MIME type and dimensions
  (1 to 4096 pixels each). SVG is not supported.
- UUID-based names, no user supplied filenames, no path traversal.
- Explicit per-user upload/delete throttling.
- Unknown, replaced and deleted keys return HTTP 404.
- The prior managed file is removed only after successful DB commit.
  If DB update fails, the newly written file is removed.
- Existing external HTTPS avatarUrl values are supported via PATCH.
  Updating avatarUrl via PATCH clears the managed key.
- Profile data, including weight and birthday, is unaffected.
- The public route has `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`.

## Production notes

The initial adapter saves files under `AVATAR_STORAGE_DIR` (default:
`./uploads/avatars`). Persist that directory across restarts. For cloud
containers or multiple API instances use shared S3/R2-compatible object
storage, with CDN routing of `/avatars/:key` and a cleanup reconciliation
job. Regularly sweep unreferenced keys after a grace period.

This implementation validates headers but does **not** re-encode images or
strip EXIF metadata. Production deployments accepting untrusted camera
uploads should transcode/sanitize with a hardened image processor and scan
uploads. A failure to delete an old file is logged for later cleanup.
