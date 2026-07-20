-- Canva vira conector do DESIGNER (por usuário), igual Asana/Drive.
-- Os tokens saem da tabela por-marca CanvaIntegration e passam a viver no User.

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "canvaTokenExpiry" TIMESTAMP(3),
  ADD COLUMN "canvaUserId" TEXT,
  ADD COLUMN "canvaCodeVerifier" TEXT,
  ADD COLUMN "canvaOauthState" TEXT;

-- CreateIndex
CREATE INDEX "User_canvaOauthState_idx" ON "User"("canvaOauthState");

-- DropTable (modelo por-marca aposentado; tokens antigos eram por-marca e serão
-- reconectados por cada designer)
DROP TABLE "CanvaIntegration";
