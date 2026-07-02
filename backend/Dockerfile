# syntax=docker/dockerfile:1
# Backend Assinatura Designer — Express + Prisma + Playwright (chromium) + sharp
FROM node:22-bookworm-slim

WORKDIR /app

# openssl/ca-certificates são exigidos pelo query engine do Prisma em runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

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

# 4) Chromium + libs de SO para o Playwright (usado em src/lib/htmlRaster.ts)
RUN npx playwright install --with-deps chromium

EXPOSE 4000

# Aplica migrações pendentes e sobe o servidor.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
