-- CreateEnum
CREATE TYPE "WorkoutStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkoutSetStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WorkoutSetType" AS ENUM ('WARMUP', 'WORKING', 'DROP_SET', 'AMRAP');

-- CreateTable
CREATE TABLE "workouts" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "notes" TEXT,
    "athlete_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "status" "WorkoutStatus" NOT NULL DEFAULT 'PLANNED',
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_exercises" (
    "id" TEXT NOT NULL,
    "workout_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "exercise_name_snapshot" VARCHAR(120) NOT NULL,
    "exercise_type_snapshot" "ExerciseType" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sets" (
    "id" TEXT NOT NULL,
    "workout_exercise_id" TEXT NOT NULL,
    "set_number" INTEGER NOT NULL,
    "set_type" "WorkoutSetType" NOT NULL DEFAULT 'WORKING',
    "status" "WorkoutSetStatus" NOT NULL DEFAULT 'PENDING',
    "planned_reps" INTEGER,
    "planned_weight_kg" DECIMAL(8,2),
    "planned_duration_seconds" INTEGER,
    "planned_distance_meters" DECIMAL(10,2),
    "actual_reps" INTEGER,
    "actual_weight_kg" DECIMAL(8,2),
    "actual_duration_seconds" INTEGER,
    "actual_distance_meters" DECIMAL(10,2),
    "rest_seconds" INTEGER,
    "rpe" DECIMAL(3,1),
    "rir" INTEGER,
    "completed_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workout_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workouts_athlete_id_scheduled_at_idx" ON "workouts"("athlete_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "workouts_athlete_id_status_scheduled_at_idx" ON "workouts"("athlete_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "workouts_created_by_id_created_at_idx" ON "workouts"("created_by_id", "created_at");

-- CreateIndex
CREATE INDEX "workout_exercises_exercise_id_idx" ON "workout_exercises"("exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_exercises_workout_id_sort_order_key" ON "workout_exercises"("workout_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "workout_sets_workout_exercise_id_set_number_key" ON "workout_sets"("workout_exercise_id", "set_number");

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_exercise_id_fkey" FOREIGN KEY ("workout_exercise_id") REFERENCES "workout_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
