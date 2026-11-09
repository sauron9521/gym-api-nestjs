# Managed avatar upload hardening

## Upload contract

`POST /users/me/avatar` still accepts the multipart field `file` and
returns `{ "avatarUrl": "/avatars/<UUID>.<extension>" }`.

The existing client-visible extensions and MIME types are preserved:

| Upload | Stored content type | Extension |
| --- | --- | --- |
| PNG | `image/png` | `.png` |
| JPEG | `image/jpeg` | `.jpg` |
| WebP | `image/webp` | `.webp` |

The request is limited to 2 MiB before decoding. A header/sig/MIME/dimension
preflight is followed by actual libvips decoding with `sharp` and its
`limitInputPixels` protection. Files must be a single raster frame,
have width and height from 1–4096, and have at most 16,777,216 pixels.
Animation and corrupt/incomplete image streams are rejected with HTTP 400.

A valid image is oriented according to its EXIF rotation, resized *inside*
a 512-by-512 bounding box (never enlarged), then encoded again in the
corresponding format. Only the fresh encoded output is written to disk;
the original bytes and their EXIF, embedded ICC profiles, comments and
other ancillary metadata are not persisted.

Public `GET /avatars/:key` URLs, existing immutable UUID keys and the
`PATCH /users/me` external-HTTPS-avatar compatibility are unchanged.
Older managed images already on disk are still served normally; only
**new** uploads receive the additional hardening.

## Crash and cleanup recovery

The profile's managed avatar key is written in a PostgreSQL transaction.
On DB failure the new file is removed, and after a successful replacement
the old file is removed. Filesystem cleanup is not transactional, so a
crash or failed `unlink` can still leave an unreferenced file.

`AvatarOrphanCleanupService` runs daily at 04:00 `Europe/Kyiv`:

1. Scan at most 100 regular files with valid UUID avatar key names that
   have not been modified during the last 24 hours.
2. Re-check each file's key against the current profile reference in
   PostgreSQL. **Never delete a currently referenced file.**
3. Remove only orphaned files. Continue after per-file failures, so the
   next daily run can retry the rest.

The 24-hour grace period also prevents cleanup of a newly written file
while its profile update is still in progress. Symbolic links, unrelated
files and malformed names are skipped. Logs contain only stable event
names, never user IDs, storage paths, or filenames.

## Deployment notes

`sharp` ships native optional dependencies for the target OS/libc.
The checked-in lockfile includes Linux glibc and Alpine musl support for
CI and Docker builds.

The local filesystem adapter is intended for development/single-server
installations with **persistent** `AVATAR_STORAGE_DIR`. For multiple API
replicas or ephemeral containers, replace it with shared object storage
and a distributed-safe cleanup worker.

## Tests

- Format decoding and re-encoding for PNG, JPEG and WebP
- EXIF stripping, resize bounds, animated WebP rejection, corrupted images
- Existing rollback/replacement behavior and persistence of normalized bytes
- Directory scanning: age limit, symlink exclusion, invalid names and batches
- Cleanup: referenced keys kept, orphan removal, safe failure logs and retry
- HTTP/PostgreSQL: cleaned public JPEG output and corrupt upload rejection
