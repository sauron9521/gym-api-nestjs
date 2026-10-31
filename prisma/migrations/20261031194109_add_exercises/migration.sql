/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `exercises` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "exercises" ADD COLUMN     "slug" VARCHAR(140);

-- CreateIndex
CREATE UNIQUE INDEX "exercises_slug_key" ON "exercises"("slug");
