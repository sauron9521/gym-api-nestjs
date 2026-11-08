CREATE TABLE "body_measurements" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "weight_kg" DECIMAL(5,2),
  "body_fat_pct" DECIMAL(5,2),
  "chest_cm" DECIMAL(5,2),
  "waist_cm" DECIMAL(5,2),
  "hips_cm" DECIMAL(5,2),
  "arm_cm" DECIMAL(5,2),
  "thigh_cm" DECIMAL(5,2),
  "notes" VARCHAR(500),
  "measured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "body_measurements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "body_measurements_at_least_one_metric" CHECK (
    "weight_kg" IS NOT NULL OR
    "body_fat_pct" IS NOT NULL OR
    "chest_cm" IS NOT NULL OR
    "waist_cm" IS NOT NULL OR
    "hips_cm" IS NOT NULL OR
    "arm_cm" IS NOT NULL OR
    "thigh_cm" IS NOT NULL
  )
);

CREATE INDEX "body_measurements_user_id_measured_at_id_idx"
  ON "body_measurements"("user_id", "measured_at" DESC, "id" DESC);

ALTER TABLE "body_measurements"
  ADD CONSTRAINT "body_measurements_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
