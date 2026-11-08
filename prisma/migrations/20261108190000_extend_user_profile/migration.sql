-- Extend the existing profile without dropping or renaming legacy columns.
ALTER TABLE "profiles"
  ADD COLUMN "first_name" TEXT,
  ADD COLUMN "last_name" TEXT,
  ADD COLUMN "display_name" TEXT,
  ADD COLUMN "avatar_url" VARCHAR(2048),
  ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC';

-- Preserve names written by existing /users/me clients.
UPDATE "profiles"
SET "display_name" = "name"
WHERE "name" IS NOT NULL AND "display_name" IS NULL;
