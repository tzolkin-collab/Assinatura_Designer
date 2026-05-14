---
title: Arquitetura Backend — Designer
type: architecture
tags:
  - "express"
  - "prisma"
  - "postgresql"
  - "typescript"
  - "auth"
  - "gemini"
  - "nano-banana"
  - "backend"
  - "retry"
  - "fal"
sources:
  - "designer/backend/src/app.ts"
  - "designer/backend/src/routes/ai.ts"
  - "designer/backend/src/lib/geminiRetry.ts"
  - "designer/backend/prisma/schema.prisma"
created: 2026-04-22
updated: 2026-05-11
---

# Arquitetura Backend — Designer

## Resumo

API REST em Express + TypeScript, servindo na porta 4000. Conecta ao PostgreSQL via Prisma ORM. Autenticação por JWT. Rotas agrupadas por domínio (`auth`, `brands`, `posts`, `folders`, `settings`, `ai`, `upload`, `health`). A lib `nanoBanana.ts` encapsula chamadas ao Gemini para geração de designs em JSON. `geminiRetry.ts` adiciona retry com fallback de modelo (2.5-flash-lite → 2.0-flash-lite → 1.5-flash).

## Detalhes

### Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express 5 |
| ORM | Prisma + PostgreSQL |
| Auth | JWT (middleware `auth.ts`) |
| LLM (chat/briefing/análise/texto) | Google Gemini 2.5 Flash Lite (`@google/genai` SDK v1) |
| LLM (design JSON background) | Gemini 2.5 Flash Lite em JSON mode — alias "Nano Banana" |
| LLM (geração de imagem) | Nano Banana Image via Gemini image models → FAL AI apenas como fallback opcional |

### Estrutura de rotas

```
POST   /api/auth/login
POST   /api/auth/register

GET    /api/brands
POST   /api/brands
GET    /api/brands/:slug
PUT    /api/brands/:slug
DELETE /api/brands/:slug
GET    /api/brands/:slug/posts

GET    /api/posts/:id
PUT    /api/posts/:id              ← atualiza content (layers), status, folderId
DELETE /api/posts/:id

GET    /api/folders/:slug          ← lista pastas da marca
POST   /api/folders/:slug          ← cria pasta
DELETE /api/folders/:id            ← exclui pasta (posts → sem pasta)

GET    /api/settings/:slug/config
PUT    /api/settings/:slug/config

GET    /api/settings/:slug/referencias
POST   /api/settings/:slug/referencias
DELETE /api/settings/:slug/referencias/:id

POST   /api/ai/:slug/chat              ← SSE streaming
POST   /api/ai/:slug/analyze-benchmark
POST   /api/ai/:slug/generate-briefing
POST   /api/ai/:slug/generate-design   ← SSE: pipeline 3-passos (brief → text layers → NanoBanana; opcionalmente gera imagens por slide)
POST   /api/ai/:slug/generate-image    ← Nano Banana Image → FAL opcional
POST   /api/ai/:slug/extract-from-logo ← extrai cores e estilo do logo via Gemini Vision
GET    /api/ai/jobs/:jobId             ← polling de job assíncrono

POST   /api/upload/image               ← upload de imagem para base64

GET    /health
```

*Rotas `/api/canva/*` existem no código mas estão em stand-by — Canva descartado por ADR-006.*

### Middleware pipeline

```
requestLogger → (auth) → route handler → errorHandler
```

### nanoBanana.ts — Design Engine v2

Gemini 2.5 Flash Lite com `responseMimeType: 'application/json'`. Retorna `DesignState[]` (layers JSON com coordenadas, cores, tipos).

**Novidades v2:**
- `referenceAssets` — imagens inline passadas ao Gemini para contexto visual (ex: logo, referência de concorrente)
- `projectAssets` — até 8 imagens do projeto; URLs `asset://N` no JSON são resolvidas para base64
- `textAreasContext` — quando as camadas de texto já foram geradas pelo Gemini, instrui o NanoBanana a não criar layers de texto (só shapes e imagens), deixando as áreas livres

```typescript
interface DesignState {
  format: 'carousel' | 'single' | 'story';
  width: number; height: number; backgroundColor: string; layers: Layer[];
}
```

### Pipeline generate-design (3 passos)

```
POST /api/ai/:slug/generate-design
  │
  ├─ Passo 1: Gemini streaming → roteiro detalhado slide a slide (SSE: type='thinking')
  │
  ├─ Passo 2: Gemini JSON mode → camadas de texto por slide { textLayers: Layer[] }
  │           (modelo: gemini-2.5-flash-lite; falha silenciosa → NanoBanana assume tudo)
  │
  └─ Passo 3: NanoBanana → fundos, shapes e imagens (instrução: NÃO criar texto)
              Merge: { ...slide, layers: [...nanoBananaLayers, ...textLayersFromGemini] }
              finalizeSlideContrast(): garante contraste de texto e box translúcido quando necessário
              Salva no banco → SSE: type='done', postId, pages
```

**Criação assíncrona — implementada em 2026-05-14:**
- Fábrica inicia criação com `POST /api/ai/:slug/create-job`, que retorna `jobId` imediatamente (`202 Accepted`).
- Frontend acompanha com `GET /api/ai/jobs/:jobId/stream`, stream SSE com replay por índice (`?from=N`) e eventos `started`, `thinking`, `plan`, `plan-step`, `reference`, `status`, `slide-ready`, `done` e `error`.
- `GET /api/ai/jobs/:jobId` retorna status recuperável: `pending|running|done|error`, `postId`, `pages`, `eventCount`, `error`, `expiresAt`.
- `/api/ai/:slug/create` permanece como rota SSE legada/compatível, mas o frontend principal usa `create-job`.
- O jobStore agora mantém eventos e clientes SSE em memória por até 2h; ainda não é persistido em banco, mas já permite reconexão/replay enquanto o processo vive na instância Node.
- `createDesign()` retorna `{ postId, pages }`, permitindo preencher o job ao terminar.

### Processo de revisão/correção IA — job recuperável em 2026-05-14

- Editor inicia revisão com `POST /api/ai/:slug/fix-design-job`, que cria job no `fixJobStore` e retorna `jobId` (`202 Accepted`).
- Frontend (`useDesignFixer`) acompanha por `GET /api/ai/fix-jobs/:jobId/stream`, mantendo os modos `planOnly=true` e `selectedFixes`.
- `GET /api/ai/fix-jobs/:jobId` retorna status, páginas corrigidas, eventos e eventual `waitingFor`.
- `POST /api/ai/fix-jobs/:jobId/input` permite enviar input humano para o job quando `designFixer` emitir `user-input-needed`.
- `fixJobStore` agora é o store ativo para revisão: guarda memória, eventos, clientes SSE, status `running|waiting|done|error|cancelled` e replay por índice.
- Rota legada `/api/ai/:slug/fix-design` permanece como SSE compatível.
- Persistência final ainda é manual no Editor: usuário aplica `correctedPages` no estado local e salva o post.

### Regra global de contraste

- `generateTextLayers()` instrui explicitamente: branco em fundo escuro, preto em fundo claro, e box translúcido obrigatório sobre foto/imagem/gradiente complexo.
- `finalizeSlideContrast()` roda após merge das layers e aplica correção defensiva: se houver layer `image` ou contraste insuficiente com `backgroundColor`, marca o texto com `contrastBackground=true` e define box preto/branco translúcido.
- O canvas renderiza esses campos como fundo relativo do próprio texto, mantendo a configuração editável pelo usuário no painel de texto.

### generate-image / imagens nos slides

- `generate-image` usa Nano Banana Image via Gemini como primário e extrai imagem de `response.data` ou `candidates[].content.parts[].inlineData`.
- Modelos tentados em sequência: `gemini-3-pro-image-preview` e `gemini-2.5-flash-image`.
- FAL (`fal-ai/flux/dev`) permanece apenas como fallback opcional; erro `Forbidden`/saldo esgotado não deve mascarar a falha principal.
- Logo enviado em `projectAssets` com `source='logo'` é tratado como identidade visual/paleta/assinatura, não como imagem comum.
- Quando `/generate-design` recebe `generateImages=true`, a IA não gera imagem no clique; primeiro monta roteiro e zonas de texto, depois gera imagens contextuais por slide quando necessário, convertendo o dataUrl em asset para o `generateDesign()`.
- Salva `previewUrl: dataUrl` no banco para posts de imagem direta (base64 direto no PostgreSQL — trade-off de MVP).
- ⚠️ **Bug corrigido (2026-05-11):** `fullPrompt` undefined → `imageGenPrompt` na linha do fallback Pollinations.

### geminiRetry.ts

Fallback chain automático para erros 503/429:

```
gemini-2.5-flash-lite → gemini-2.0-flash-lite → gemini-1.5-flash
```

Por modelo: 3 tentativas com backoff exponencial (1s, 2s, 4s). Exporta `generateWithRetry` e `generateStreamWithRetry`.

### imageNormalizer.ts

Normaliza formatos não suportados pelo Gemini Vision antes de enviar como `inlineData`:
- SVG → PNG via `sharp`
- HEIC/HEIF → JPEG via `sharp`
- Formatos suportados passam direto

### canvaClient.ts

OAuth wrapper para Canva Connect API (código existente, em stand-by — ADR-006 descartou Canva).

### Schema Prisma — modelos relevantes

```prisma
model Post {
  id            String     @id @default(uuid())
  type          PostType   // CAROUSEL | SINGLE_IMAGE | ANIMATION
  status        PostStatus // DRAFT | GENERATING | READY | FAILED
  content       Json?      // DesignPage[] (layers JSON) ou { type: 'image', dataUrl }
  previewUrl    String?    // base64 dataUrl para posts de imagem
  canvaDesignId String?    // (stand-by)
  canvaExportUrl String?   // (stand-by)
  folderId      String?    // FK → Folder
  brandId       String     // FK → Brand
}

model Folder {
  id      String @id @default(uuid())
  name    String
  brandId String
  posts   Post[]
}

model BrandConfig {
  // ... campos existentes
  presentationConfig Json? // config de dimensões/formato padrão da Fábrica
}

model Reference {
  // ... campos existentes
  sourceType SourceType @default(WEBSITE) // WEBSITE | INSTAGRAM
}
```

### Configuração (`config.ts`)

- `DATABASE_URL` — connection string PostgreSQL
- `JWT_SECRET` — segredo para assinar tokens
- `GEMINI_API_KEY` — key para chat + briefing + analyse + text layers
- `NANO_BANANA_API_KEY` — key separada para NanoBanana (controle de cota independente)
- `FAL_API_KEY` — key para FAL AI (geração de imagem via Flux)
- `PORT` — default 4000
- `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`, `CANVA_REDIRECT_URI` — (stand-by, não usados)

## Decisões Tomadas

- **Dois API keys Gemini** — `GEMINI_API_KEY` para chat/análise, `NANO_BANANA_API_KEY` para design. Permite throttle independente.
- **Prisma `Json` field** para `Post.content` — evita migrations a cada iteração do schema de layers.
- **SSE** para `/chat` e `/generate-design` — nativo no browser via `fetch + ReadableStream`.
- **Pipeline 3-passos** — separar brief (texto), camadas de texto (Gemini JSON) e design visual (NanoBanana) permite melhor qualidade: NanoBanana sabe exatamente onde não colocar shapes para não obstruir o texto.
- **FAL AI → Pollinations fallback** — FAL tem qualidade superior (Flux); Pollinations é gratuito e funciona como backstop.

## Learnings

- Gemini pode retornar JSON dentro de bloco markdown mesmo com `responseMimeType: 'application/json'` — aplicar `.replace(/\`\`\`json/g, '')` como fallback.
- Rate limit 429 no Free Tier é frequente; `geminiRetry.ts` mitiga com fallback de modelo.
- **SDK `@google/genai` v1**: `chunk.text` é propriedade (não método); `ai.models.generateContent()` em vez de `model.generateContent()`.
- **Ownership gap histórico em settings.ts**: `getBrandId(slug)` verificava existência da marca sem validar pertencimento ao usuário autenticado; revalidar antes de marcar como definitivamente fechado.
- **2026-05-13 — Ownership P0 em posts/folders:** `GET`, `PUT` e `DELETE /api/posts/:id` agora filtram por `brand.userId`; `PUT /api/posts/:id` valida que `folderId` pertence à mesma brand; `GET/POST /api/folders/:slug` e `DELETE /api/folders/:id` validam ownership.
- **2026-05-11 — Bug `fullPrompt`:** variável definida apenas no handler `generate-design` era referenciada no handler `generate-image` (ReferenceError no fallback Pollinations). Corrigido para `imageGenPrompt`. 
- **Null layers crash:** Gemini ocasionalmente retorna `null` dentro do array `layers`. Qualquer `.sort()` em `layer.zIndex` crasha. Fix: `filter(Boolean)` antes de `sort()`.

## Relacionados

- [[agente-designer]]
- [[designer-frontend]]
- [[adr-006-editor-visual-alternativas-canva]]
- [[adr-002-gemini-llm-designer]]
- [[infraestrutura-tecnica]]
- [[qualidade-lint-build]]
