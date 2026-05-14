---
title: Qualidade — Lint e Build (Designer)
type: workflow
tags:
  - "qualidade"
  - "eslint"
  - "lint"
  - "build"
  - "next.js"
  - "express"
sources:
  - "designer/frontend/eslint.config.mjs"
  - "designer/backend/eslint.config.mjs"
created: 2026-04-27
updated: 2026-04-27
---

# Qualidade — Lint e Build (Designer)

## Resumo

Padronização de qualidade para o Designer (frontend + backend): lint e build passando de forma reproduzível. O objetivo foi eliminar erros do ESLint/TypeScript e reduzir ruído de warnings.

## O que mudou

### Frontend (Next.js)

- `eslint` passa sem warnings
- `next build` passa (checagem de TypeScript incluída)
- Migração de `<img>` para `next/image` para cumprir `@next/next/no-img-element`
- Ajustes de dependências de hooks (`react-hooks/exhaustive-deps`) e remoção de imports não usados

### Backend (Express)

- ESLint foi instalado e configurado (`eslint.config.mjs`)
- `eslint src/` passa sem erros
- Ajustes de tipagem para evitar `any` e de tratamento de erros (`unknown` + narrowing)

## Evidências

- Frontend: `npm run lint` (OK) e `npm run build` (OK)
- Backend: `npm run lint` (OK) e `npm run build` (OK)

## Arquivos tocados (principais)

- Frontend
  - `designer/frontend/src/lib/api.ts`
  - `designer/frontend/src/lib/hooks.ts`
  - `designer/frontend/src/components/Editor/CanvasEditor.tsx`
  - `designer/frontend/src/app/[marca]/editor/page.tsx`
  - `designer/frontend/src/app/[marca]/galeria/page.tsx`
  - `designer/frontend/src/app/[marca]/fabrica/page.tsx`
  - `designer/frontend/src/app/[marca]/configuracoes/branding/page.tsx`
  - `designer/frontend/src/app/[marca]/configuracoes/referencias/page.tsx`
  - `designer/frontend/src/components/Sidebar/Sidebar.tsx`

- Backend
  - `designer/backend/eslint.config.mjs`
  - `designer/backend/package.json`
  - `designer/backend/src/routes/ai.ts`
  - `designer/backend/src/routes/posts.ts`
  - `designer/backend/src/routes/brands.ts`
  - `designer/backend/src/routes/folders.ts`
  - `designer/backend/src/routes/settings.ts`
  - `designer/backend/src/lib/nanoBanana.ts`

## Learnings

- No frontend, `next build` é o guard-rail final: mesmo com `eslint` limpo, o TypeScript do build pega incompatibilidades finas (ex.: valores vindos de `select` e tipos literais).
- No backend, `Prisma.*JsonValue` normalmente precisa de cast via `unknown` quando o dado vem de objetos tipados (p.ex. `DesignState[]`).
- Se aparecer spam de `GET /icons/icon-192.png 404`, o `manifest.json` estava referenciando ícones inexistentes. A correção é alinhar os caminhos do `icons[]` com arquivos reais em `public/icons/`.
- Se `next dev` acusar *"Another next dev server is already running"* e/ou trocar para outra porta, existe um processo antigo no mesmo diretório. Encerrar o PID resolve.
- Se surgir erro de typecheck apontando para `.next/dev/types/routes.d.ts`, pode ser artefato corrompido do build. Limpar `.next/` e rebuildar tende a resolver.

## Relacionados

- [[designer-frontend]] — contexto de páginas e componentes
- [[designer-backend]] — contexto de rotas e tipagem Prisma
- [[agente-designer]] — feature impactada por estabilidade de build/lint
