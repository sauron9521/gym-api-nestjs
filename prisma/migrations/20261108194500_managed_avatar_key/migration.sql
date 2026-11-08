-- A nullable unique key identifies images uploaded through the API.
-- Existing HTTPS avatarUrl values remain external; no data is rewritten.
ALTER TABLE "profiles" ADD COLUMN "avatar_key" VARCHAR(48);

CREATE UNIQUE INDEX "profiles_avatar_key_key" ON "profiles"("avatar_key");
