-- AlterTable
ALTER TABLE "BrandConfig" ADD COLUMN     "autoResearchEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoResearchInterval" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "lastAutoResearchAt" TIMESTAMP(3),
ADD COLUMN     "benchmarkSession" JSONB;

-- AlterTable
ALTER TABLE "Reference" ADD COLUMN     "galleryImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

