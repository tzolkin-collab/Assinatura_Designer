---
title: "ADR-001 — Frontend Next.js separado do Backend Express"
type: decision
tags:
  - "adr"
  - "designer"
  - "next.js"
  - "express"
  - "arquitetura"
sources:
  - "architecture/designer-frontend.md"
  - "architecture/designer-backend.md"
created: 2026-05-03
updated: 2026-05-03
---

# ADR-001 — Frontend Next.js separado do Backend Express

## Resumo

Decisão de manter o frontend (Next.js App Router) e o backend (Express + Prisma) como dois processos e repositórios distintos para o Agente Designer, em vez de usar um monolito Next.js com API Routes.

## Contexto

O Agente Designer precisava de um backend com Prisma ORM, geração de JWT, upload de arquivos e chamadas de longa duração ao Gemini. Next.js API Routes seriam a opção "zero-config", mas apresentavam limitações relevantes.

## Decisão

Manter dois serviços separados:
- **Frontend:** Next.js App Router — responsável por UI, SSE streaming, roteamento por `[marca]`
- **Backend:** Express + Prisma — responsável por auth, geração de design (Gemini), upload R2, queries PostgreSQL

## Consequências

| Aspecto | Resultado |
|---|---|
| Deploy | Dois containers no EasyPanel; porta backend configurável via env var |
| CORS | `cors()` explícito no Express; frontend consome via `NEXT_PUBLIC_API_URL` |
| Streaming | SSE (`text/event-stream`) mais simples de manter no Express do que em Next.js Route Handlers |
| Escalabilidade | Backend pode escalar independentemente do frontend |
| Complexidade | Dois `package.json`, dois processos de dev, dois Dockerfiles |

## Alternativas rejeitadas

- **Next.js monolito com API Routes** — limitações de timeout (Vercel serverless), sem suporte nativo a SSE de longa duração, Prisma com edge runtime é problemático.
- **NestJS** — overhead de configuração desnecessário para o tamanho do projeto.

## Relacionados

- [[designer-backend]]
- [[designer-frontend]]
