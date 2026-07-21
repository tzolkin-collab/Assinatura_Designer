-- AlterTable
ALTER TABLE "User" ADD COLUMN     "asanaOauthState" TEXT,
ADD COLUMN     "asanaOauthStateAt" TIMESTAMP(3),
ADD COLUMN     "asanaRefreshToken" TEXT,
ADD COLUMN     "asanaTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "googleOauthState" TEXT,
ADD COLUMN     "googleOauthStateAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_asanaOauthState_idx" ON "User"("asanaOauthState");

-- CreateIndex
CREATE INDEX "User_googleOauthState_idx" ON "User"("googleOauthState");
