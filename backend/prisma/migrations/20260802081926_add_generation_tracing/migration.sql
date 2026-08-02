-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "StepKind" AS ENUM ('MODEL', 'TOOL', 'IMAGE');

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "brandId" TEXT NOT NULL,
    "sessionId" TEXT,
    "requestId" TEXT,
    "feature" TEXT NOT NULL,
    "brief" TEXT,
    "format" TEXT,
    "aspectRatio" TEXT,
    "status" "GenerationStatus" NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "StepKind" NOT NULL,
    "role" TEXT,
    "name" TEXT,
    "model" TEXT,
    "tier" TEXT,
    "attemptedModels" TEXT[],
    "promptText" TEXT,
    "responseText" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationRun_postId_idx" ON "GenerationRun"("postId");

-- CreateIndex
CREATE INDEX "GenerationRun_brandId_startedAt_idx" ON "GenerationRun"("brandId", "startedAt");

-- CreateIndex
CREATE INDEX "GenerationStep_runId_seq_idx" ON "GenerationStep"("runId", "seq");

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationStep" ADD CONSTRAINT "GenerationStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "GenerationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
