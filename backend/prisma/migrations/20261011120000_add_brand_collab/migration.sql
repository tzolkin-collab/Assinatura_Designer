-- CreateEnum
CREATE TYPE "BrandKind" AS ENUM ('BASE', 'INTERNAL', 'PARTNERSHIP');

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "kind" "BrandKind" NOT NULL DEFAULT 'BASE',
ADD COLUMN     "parentBrandId" TEXT,
ADD COLUMN     "collab" JSONB;

-- CreateIndex
CREATE INDEX "Brand_parentBrandId_idx" ON "Brand"("parentBrandId");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_parentBrandId_fkey" FOREIGN KEY ("parentBrandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
