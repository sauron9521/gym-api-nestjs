-- Supports bounded athlete-only completed workout analytics by completion date.
-- Run the forward-only migration during a planned production rollout.
CREATE INDEX "workouts_athlete_id_status_completed_at_idx"
  ON "workouts"("athlete_id", "status", "completed_at" DESC);
