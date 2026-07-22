-- Remove o valor ANIMATION do enum PostType — código morto: zero linha no banco
-- usava esse tipo (nenhum caminho do produto criava post ANIMATION) e zero
-- código cria esse tipo hoje. Verificado antes de escrever esta migration.
-- Postgres não suporta DROP VALUE em enum: recria o tipo sem o valor.

BEGIN;
CREATE TYPE "PostType_new" AS ENUM ('CAROUSEL', 'SINGLE_IMAGE', 'PRESENTATION');
ALTER TABLE "Post" ALTER COLUMN "type" TYPE "PostType_new" USING ("type"::text::"PostType_new");
ALTER TYPE "PostType" RENAME TO "PostType_old";
ALTER TYPE "PostType_new" RENAME TO "PostType";
DROP TYPE "PostType_old";
COMMIT;
