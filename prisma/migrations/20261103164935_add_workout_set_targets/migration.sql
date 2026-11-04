/*
  Warnings:

  - A unique constraint covering the columns `[trainer_id,athlete_id]` on the table `trainer_athletes` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "trainer_athletes_open_pair_key";

-- AlterTable
ALTER TABLE "workout_sets" ADD COLUMN     "target_rir" INTEGER,
ADD COLUMN     "target_rpe" DECIMAL(3,1);

-- CreateIndex
CREATE UNIQUE INDEX "trainer_athletes_open_pair_key" ON "trainer_athletes"("trainer_id", "athlete_id") WHERE (status IN ('PENDING', 'ACTIVE'));
