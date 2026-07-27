# syntax=docker/dockerfile:1
# Backend Assinatura Designer — Express + Prisma + Playwright (chromium) + sharp
FROM node:22-bookworm-slim

WORKDIR /app

# openssl/ca-certificates são exigidos pelo query engine do Prisma em runtime.
# unzip é necessário para o Puppeteer extrair o Chrome no passo 4.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# Impede o postinstall do Puppeteer de baixar o Chrome durante `npm ci`.
# O binário é instalado explicitamente na etapa 4 (após as libs de SO do
# playwright install-deps estarem disponíveis), o que é mais confiável.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# 1) Dependências (inclui devDeps: precisamos de tsc/prisma CLI no build e do
#    prisma CLI em runtime para `migrate deploy`). `npm ci` ignora NODE_ENV.
COPY package.json package-lock.json ./
RUN npm ci

# 2) Client do Prisma (precisa do schema antes de gerar)
COPY prisma ./prisma
RUN npx prisma generate

# 3) Código + build TypeScript -> dist/
COPY . .
RUN npm run build

# 4) Chromium para o Puppeteer (src/lib/htmlRaster.ts usa puppeteer-cluster, NÃO
#    playwright). Instalamos só as libs de SO do chromium via playwright
#    (install-deps não baixa browser) e garantimos o browser do Puppeteer.
#    `puppeteer browsers install chrome` é idempotente — no-op se o postinstall
#    do `npm ci` já baixou o binário.
RUN npx playwright install-deps chromium \
    && npx puppeteer browsers install chrome

EXPOSE 4000

# Aplica migrações pendentes e sobe o servidor.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
