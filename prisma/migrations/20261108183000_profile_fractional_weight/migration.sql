-- Existing integer weights remain valid after conversion.
ALTER TABLE "profiles"
  ALTER COLUMN "weight" TYPE DECIMAL(5,2)
  USING "weight"::DECIMAL(5,2);
