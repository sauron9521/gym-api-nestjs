-- Separately track the nonblocking index build for unfiltered athlete lists.
CREATE INDEX CONCURRENTLY "training_program_assignments_athlete_id_assigned_at_id_idx"
  ON "training_program_assignments"("athlete_id", "assigned_at" DESC, "id" DESC);
