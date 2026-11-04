/*
  Warnings:

  - A unique constraint covering the columns `[trainer_id,athlete_id]` on the table `trainer_athletes` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TrainingProgramStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrainingProgramVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "TrainingProgramAssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'TERMINATED');

-- DropIndex
DROP INDEX "trainer_athletes_open_pair_key";

-- AlterTable
ALTER TABLE "workouts" ADD COLUMN     "program_assignment_id" TEXT,
ADD COLUMN     "program_workout_id" TEXT;

-- CreateTable
CREATE TABLE "training_programs" (
    "id" TEXT NOT NULL,
    "trainer_id" TEXT NOT NULL,
    "status" "TrainingProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_program_versions" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "duration_weeks" INTEGER,
    "status" "TrainingProgramVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_program_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_program_workouts" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "week_number" INTEGER NOT NULL,
    "day_number" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_program_workouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_program_exercises" (
    "id" TEXT NOT NULL,
    "workout_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "exercise_name_snapshot" VARCHAR(120) NOT NULL,
    "exercise_type_snapshot" "ExerciseType" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_program_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_program_sets" (
    "id" TEXT NOT NULL,
    "program_exercise_id" TEXT NOT NULL,
    "set_number" INTEGER NOT NULL,
    "set_type" "WorkoutSetType" NOT NULL DEFAULT 'WORKING',
    "planned_reps" INTEGER,
    "planned_weight_kg" DECIMAL(8,2),
    "planned_duration_seconds" INTEGER,
    "planned_distance_meters" DECIMAL(10,2),
    "rest_seconds" INTEGER,
    "target_rpe" DECIMAL(3,1),
    "target_rir" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_program_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_program_assignments" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "trainer_athlete_id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "assigned_by_id" TEXT NOT NULL,
    "status" "TrainingProgramAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "ended_by_id" TEXT,
    "end_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_program_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_programs_trainer_id_status_updated_at_idx" ON "training_programs"("trainer_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "training_program_versions_program_id_status_version_idx" ON "training_program_versions"("program_id", "status", "version");

-- CreateIndex
CREATE UNIQUE INDEX "training_program_versions_program_id_version_key" ON "training_program_versions"("program_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "training_program_versions_one_draft_key" ON "training_program_versions"("program_id") WHERE (status = 'DRAFT');

-- CreateIndex
CREATE INDEX "training_program_workouts_version_id_week_number_day_number_idx" ON "training_program_workouts"("version_id", "week_number", "day_number");

-- CreateIndex
CREATE UNIQUE INDEX "training_program_workouts_version_id_week_number_day_number_key" ON "training_program_workouts"("version_id", "week_number", "day_number");

-- CreateIndex
CREATE INDEX "training_program_exercises_exercise_id_idx" ON "training_program_exercises"("exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "training_program_exercises_workout_id_sort_order_key" ON "training_program_exercises"("workout_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "training_program_sets_program_exercise_id_set_number_key" ON "training_program_sets"("program_exercise_id", "set_number");

-- CreateIndex
CREATE INDEX "training_program_assignments_trainer_athlete_id_status_idx" ON "training_program_assignments"("trainer_athlete_id", "status");

-- CreateIndex
CREATE INDEX "training_program_assignments_athlete_id_status_assigned_at_idx" ON "training_program_assignments"("athlete_id", "status", "assigned_at");

-- CreateIndex
CREATE INDEX "training_program_assignments_version_id_idx" ON "training_program_assignments"("version_id");

-- CreateIndex
CREATE INDEX "training_program_assignments_assigned_by_id_idx" ON "training_program_assignments"("assigned_by_id");

-- CreateIndex
CREATE INDEX "training_program_assignments_ended_by_id_idx" ON "training_program_assignments"("ended_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_athletes_open_pair_key" ON "trainer_athletes"("trainer_id", "athlete_id") WHERE (status IN ('PENDING', 'ACTIVE'));

-- CreateIndex
CREATE INDEX "workouts_program_assignment_id_idx" ON "workouts"("program_assignment_id");

-- CreateIndex
CREATE INDEX "workouts_program_workout_id_idx" ON "workouts"("program_workout_id");

-- AddForeignKey
ALTER TABLE "training_programs" ADD CONSTRAINT "training_programs_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_program_versions" ADD CONSTRAINT "training_program_versions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "training_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_program_workouts" ADD CONSTRAINT "training_program_workouts_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "training_program_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_program_exercises" ADD CONSTRAINT "training_program_exercises_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "training_program_workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_program_exercises" ADD CONSTRAINT "training_program_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_program_sets" ADD CONSTRAINT "training_program_sets_program_exercise_id_fkey" FOREIGN KEY ("program_exercise_id") REFERENCES "training_program_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_program_assignments" ADD CONSTRAINT "training_program_assignments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "training_program_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_program_assignments" ADD CONSTRAINT "training_program_assignments_trainer_athlete_id_fkey" FOREIGN KEY ("trainer_athlete_id") REFERENCES "trainer_athletes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_program_assignments" ADD CONSTRAINT "training_program_assignments_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_program_assignments" ADD CONSTRAINT "training_program_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_program_assignments" ADD CONSTRAINT "training_program_assignments_ended_by_id_fkey" FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_program_assignment_id_fkey" FOREIGN KEY ("program_assignment_id") REFERENCES "training_program_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_program_workout_id_fkey" FOREIGN KEY ("program_workout_id") REFERENCES "training_program_workouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
