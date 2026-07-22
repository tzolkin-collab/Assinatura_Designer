-- Baseline: estas 3 colunas já existem no banco real (aplicadas fora do
-- histórico de migrations em algum momento anterior — provável `db push`).
-- Esta migration só formaliza o histórico; ela é marcada como já aplicada
-- via `prisma migrate resolve --applied`, nunca executada de fato aqui.
-- Sem isto, um `migrate deploy` num banco NOVO nunca criaria estas colunas.

-- AlterTable
ALTER TABLE "Reference" ADD COLUMN     "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoSyncInterval" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);
