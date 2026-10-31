-- CreateEnum
CREATE TYPE "ExerciseSource" AS ENUM ('GLOBAL', 'ATHLETE_CUSTOM', 'TRAINER_CUSTOM');

-- CreateEnum
CREATE TYPE "ExerciseVisibility" AS ENUM ('PRIVATE', 'SELECTED_TRAINERS');

-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('STRENGTH', 'CARDIO', 'MOBILITY', 'PLYOMETRIC', 'OTHER');

-- CreateEnum
CREATE TYPE "MuscleRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateTable
CREATE TABLE "exercises" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "source" "ExerciseSource" NOT NULL,
    "visibility" "ExerciseVisibility",
    "exerciseType" "ExerciseType" NOT NULL DEFAULT 'STRENGTH',
    "created_by_id" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "copied_from_exercise_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muscle_groups" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,

    CONSTRAINT "muscle_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_muscle_groups" (
    "exercise_id" TEXT NOT NULL,
    "muscle_group_id" TEXT NOT NULL,
    "role" "MuscleRole" NOT NULL DEFAULT 'SECONDARY',

    CONSTRAINT "exercise_muscle_groups_pkey" PRIMARY KEY ("exercise_id","muscle_group_id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_equipments" (
    "exercise_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,

    CONSTRAINT "exercise_equipments_pkey" PRIMARY KEY ("exercise_id","equipment_id")
);

-- CreateTable
CREATE TABLE "exercise_trainer_access" (
    "id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "trainer_id" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "exercise_trainer_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_athlete_assignments" (
    "id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "assigned_by_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "exercise_athlete_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exercises_source_is_archived_idx" ON "exercises"("source", "is_archived");

-- CreateIndex
CREATE INDEX "exercises_created_by_id_idx" ON "exercises"("created_by_id");

-- CreateIndex
CREATE INDEX "exercises_name_idx" ON "exercises"("name");

-- CreateIndex
CREATE INDEX "exercises_copied_from_exercise_id_idx" ON "exercises"("copied_from_exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "muscle_groups_name_key" ON "muscle_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "muscle_groups_slug_key" ON "muscle_groups"("slug");

-- CreateIndex
CREATE INDEX "exercise_muscle_groups_muscle_group_id_exercise_id_idx" ON "exercise_muscle_groups"("muscle_group_id", "exercise_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_name_key" ON "equipment"("name");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_slug_key" ON "equipment"("slug");

-- CreateIndex
CREATE INDEX "exercise_equipments_equipment_id_exercise_id_idx" ON "exercise_equipments"("equipment_id", "exercise_id");

-- CreateIndex
CREATE INDEX "exercise_trainer_access_trainer_id_revoked_at_idx" ON "exercise_trainer_access"("trainer_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_trainer_access_exercise_id_trainer_id_key" ON "exercise_trainer_access"("exercise_id", "trainer_id");

-- CreateIndex
CREATE INDEX "exercise_athlete_assignments_athlete_id_revoked_at_idx" ON "exercise_athlete_assignments"("athlete_id", "revoked_at");

-- CreateIndex
CREATE INDEX "exercise_athlete_assignments_assigned_by_id_idx" ON "exercise_athlete_assignments"("assigned_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_athlete_assignments_exercise_id_athlete_id_key" ON "exercise_athlete_assignments"("exercise_id", "athlete_id");

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_copied_from_exercise_id_fkey" FOREIGN KEY ("copied_from_exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_muscle_groups" ADD CONSTRAINT "exercise_muscle_groups_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_muscle_groups" ADD CONSTRAINT "exercise_muscle_groups_muscle_group_id_fkey" FOREIGN KEY ("muscle_group_id") REFERENCES "muscle_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_equipments" ADD CONSTRAINT "exercise_equipments_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_equipments" ADD CONSTRAINT "exercise_equipments_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_trainer_access" ADD CONSTRAINT "exercise_trainer_access_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_trainer_access" ADD CONSTRAINT "exercise_trainer_access_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_athlete_assignments" ADD CONSTRAINT "exercise_athlete_assignments_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_athlete_assignments" ADD CONSTRAINT "exercise_athlete_assignments_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_athlete_assignments" ADD CONSTRAINT "exercise_athlete_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
