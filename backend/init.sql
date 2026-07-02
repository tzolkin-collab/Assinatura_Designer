-- Criação do banco de dados (Execute essa parte isoladamente caso o SGBD exija)
-- CREATE DATABASE assinatura;

-- Conecte-se ao banco 'assinatura' antes de rodar os comandos abaixo:
-- \c assinatura;

-- Criação do schema
CREATE SCHEMA IF NOT EXISTS app;

-- Definir o search_path padrão para incluir o novo schema
SET search_path TO app, public;

-- ==========================================
-- Tabelas do sistema (Baseado no Prisma Schema)
-- ==========================================

CREATE TABLE IF NOT EXISTS app."User" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" TEXT UNIQUE NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'DESIGNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS app."Brand" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug" TEXT UNIQUE NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT DEFAULT '#171717',
    "userId" UUID NOT NULL REFERENCES app."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS app."BrandConfig" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "brandId" UUID UNIQUE NOT NULL REFERENCES app."Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "agentPrompt" TEXT NOT NULL,
    "primaryFonts" TEXT[] NOT NULL DEFAULT '{}',
    "colors" TEXT[] NOT NULL DEFAULT '{}',
    "guidelines" TEXT NOT NULL,
    "logoUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS app."Reference" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "brandId" UUID NOT NULL REFERENCES app."Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "insights" INTEGER NOT NULL DEFAULT 0,
    "analysisUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS app."Post" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "brandId" UUID NOT NULL REFERENCES app."Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "content" JSONB,
    "previewUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
