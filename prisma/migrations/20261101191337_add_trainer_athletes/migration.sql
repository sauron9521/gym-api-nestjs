-- CreateEnum
CREATE TYPE "TrainerAthleteStatus" AS ENUM ('PENDING', 'ACTIVE', 'DECLINED', 'CANCELLED', 'TERMINATED');

-- CreateTable
CREATE TABLE "trainer_athletes" (
    "id" TEXT NOT NULL,
    "trainer_id" TEXT NOT NULL,
    "athlete_id" TEXT NOT NULL,
    "initiated_by_id" TEXT NOT NULL,
    "status" "TrainerAthleteStatus" NOT NULL DEFAULT 'PENDING',
    "responded_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "ended_by_id" TEXT,
    "end_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trainer_athletes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trainer_athletes_trainer_id_status_created_at_idx" ON "trainer_athletes"("trainer_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "trainer_athletes_athlete_id_status_created_at_idx" ON "trainer_athletes"("athlete_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "trainer_athletes_initiated_by_id_created_at_idx" ON "trainer_athletes"("initiated_by_id", "created_at");

-- CreateIndex
CREATE INDEX "trainer_athletes_ended_by_id_idx" ON "trainer_athletes"("ended_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_athletes_open_pair_key" ON "trainer_athletes"("trainer_id", "athlete_id") WHERE (status IN ('PENDING', 'ACTIVE'));

-- AddForeignKey
ALTER TABLE "trainer_athletes" ADD CONSTRAINT "trainer_athletes_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_athletes" ADD CONSTRAINT "trainer_athletes_athlete_id_fkey" FOREIGN KEY ("athlete_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_athletes" ADD CONSTRAINT "trainer_athletes_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_athletes" ADD CONSTRAINT "trainer_athletes_ended_by_id_fkey" FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
