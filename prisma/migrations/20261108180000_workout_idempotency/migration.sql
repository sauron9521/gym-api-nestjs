-- Allow legacy workouts without a key; PostgreSQL permits multiple NULL values
-- under a composite UNIQUE constraint.
ALTER TABLE "workouts"
  ADD COLUMN "idempotency_key" VARCHAR(128),
  ADD COLUMN "idempotency_fingerprint" VARCHAR(64);

CREATE UNIQUE INDEX "workouts_athlete_id_idempotency_key_key"
  ON "workouts"("athlete_id", "idempotency_key");
