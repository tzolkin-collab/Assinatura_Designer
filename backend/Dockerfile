# syntax=docker/dockerfile:1
# Backend Assinatura Designer — Express + Prisma + Playwright (chromium) + sharp
FROM node:22-bookworm-slim

WORKDIR /app

# openssl/ca-certificates são exigidos pelo query engine do Prisma em runtime.
# unzip é necessário para o Puppeteer extrair o Chrome no passo 4.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*

# Impede o postinstall do Puppeteer de baixar o Chrome durante a instalação.
# O binário é instalado explicitamente na etapa 4 (após as libs de SO do
# playwright install-deps estarem disponíveis), o que é mais confiável.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# 0) pnpm. O corepack já vem na imagem do Node 22 e lê o campo `packageManager`
#    do package.json, então a versão usada aqui é exatamente a mesma do dev —
#    não há "funciona na minha máquina" por divergência de gerenciador.
RUN corepack enable

# 1) Dependências. `pnpm install` pula devDependencies quando NODE_ENV=production
#    (TypeScript, @types/*, vitest, supertest etc.), o que quebraria o `tsc` do
#    passo 3. `--prod=false` força as devDeps independente do ambiente.
#
#    O pnpm-workspace.yaml carrega o `allowBuilds`: o pnpm bloqueia postinstall
#    de dependência por padrão, e sem esse arquivo o bcrypt, o sharp, o esbuild e
#    os engines do Prisma chegariam sem binário — falhando só em runtime.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# 2) Client do Prisma (precisa do schema antes de gerar)
COPY prisma ./prisma
RUN pnpm exec prisma generate

# 3) Código + build TypeScript -> dist/ (tests já excluídos no tsconfig.json)
COPY . .
RUN pnpm run build

# Apenas agora definimos NODE_ENV=production para que o runtime do Express
# rode em modo produção (sem stack traces, modos otimizados, etc.).
ENV NODE_ENV=production

# 4) Chromium para o Puppeteer (src/lib/htmlRaster.ts usa puppeteer-cluster, NÃO
#    playwright). Instalamos só as libs de SO do chromium via playwright
#    (install-deps não baixa browser) e garantimos o browser do Puppeteer.
#    `puppeteer browsers install chrome` é idempotente — no-op se o postinstall
#    da instalação já baixou o binário.
RUN pnpm exec playwright install-deps chromium \
    && pnpm exec puppeteer browsers install chrome

EXPOSE 80

# Aplica migrações pendentes e sobe o servidor.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/server.js"]
