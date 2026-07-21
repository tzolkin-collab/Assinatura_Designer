-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "postId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'upload',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Asset_source_idx" ON "Asset"("source");

-- CreateIndex
CREATE INDEX "Asset_postId_idx" ON "Asset"("postId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
