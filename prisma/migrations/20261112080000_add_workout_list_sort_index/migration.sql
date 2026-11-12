-- One statement per migration: CREATE INDEX CONCURRENTLY must run outside
-- a transaction block. Do not add BEGIN, COMMIT, or other SQL statements.
CREATE INDEX CONCURRENTLY "workouts_athlete_id_created_at_id_idx"
  ON "workouts"("athlete_id", "created_at" DESC, "id" DESC);
