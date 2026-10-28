/*
  Warnings:

  - The values [USER,CUSTOMER,STAFF] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `pass_hash` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `update_at` on the `users` table. All the data in the column will be lost.
  - Added the required column `password_hash` to the `users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('ATHLETE', 'TRAINER', 'ADMIN');
ALTER TABLE "public"."users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'ATHLETE';
COMMIT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "pass_hash",
DROP COLUMN "update_at",
ADD COLUMN     "deleted_at" TIMESTAMPTZ(3),
ADD COLUMN     "password_hash" TEXT NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL,
ALTER COLUMN "role" SET DEFAULT 'ATHLETE',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "birthday" DATE,
    "height" INTEGER,
    "weight" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
