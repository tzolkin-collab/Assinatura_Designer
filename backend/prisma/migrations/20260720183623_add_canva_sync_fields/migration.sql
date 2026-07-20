-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "canvaDesignName" TEXT,
ADD COLUMN     "canvaLastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "canvaSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
