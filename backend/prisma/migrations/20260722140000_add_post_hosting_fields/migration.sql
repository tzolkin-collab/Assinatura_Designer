-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "hostingConfig" JSONB,
ADD COLUMN     "publicSlug" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Post_publicSlug_key" ON "Post"("publicSlug");

-- CreateIndex
CREATE INDEX "Post_publicSlug_idx" ON "Post"("publicSlug");
