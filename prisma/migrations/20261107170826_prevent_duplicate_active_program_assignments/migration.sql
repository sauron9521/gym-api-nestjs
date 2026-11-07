/*
  Warnings:

  - A unique constraint covering the columns `[trainer_id,athlete_id]` on the table `trainer_athletes` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[version_id,athlete_id]` on the table `training_program_assignments` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "trainer_athletes_open_pair_key";

-- CreateIndex
CREATE UNIQUE INDEX "trainer_athletes_open_pair_key" ON "trainer_athletes"("trainer_id", "athlete_id") WHERE (status IN ('PENDING', 'ACTIVE'));

-- CreateIndex
CREATE UNIQUE INDEX "training_program_assignments_one_active_version_key" ON "training_program_assignments"("version_id", "athlete_id") WHERE (status = 'ACTIVE');
