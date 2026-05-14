---
title: Agente Designer
type: feature
tags:
  - "designer"
  - "gemini"
  - "nano-banana"
  - "canva-api"
  - "next.js"
  - "express"
  - "prisma"
  - "branding"
  - "posts"
sources:
  - "designer/backend/src/routes/ai.ts"
  - "designer/backend/src/lib/nanoBanana.ts"
  - "designer/frontend/src/app/[marca]/fabrica/page.tsx"
  - "designer/backend/prisma/schema.prisma"
created: 2026-04-22
updated: 2026-05-12
---

# Agente Designer

## Resumo

App web de geração de designs visuais com IA, construído em Next.js (frontend) + Express (backend) + PostgreSQL via Prisma. Cada marca tem seu próprio agente configurado (guidelines, prompt, cores, fontes). O usuário descreve o que quer na "Fábrica" e o backend chama o Nano Banana (Gemini 2.5 Flash Lite) que devolve um JSON de camadas (layers); ~~o editor visual renderiza e exporta as camadas~~ **[DEPRECATED — ADR-005]** a edição visual migra para a Canva Connect API. Sprint 0 concluído em 2026-04-25. **ADR-005 (2026-05-05):** CanvasEditor substituído pela Canva Connect API — edição, assets e export delegados ao Canva.

## Detalhes

### Fluxo Principal (Fábrica → Design) — Pipeline 3 Passos

```
Usuário descreve na Fábrica (wizard 3-steps)
  → POST /api/ai/:slug/generate-design (SSE streaming)
    [Passo 1] Gemini streams brief narrativo → cliente recebe eventos 'thinking'
      • Prompt "DECISIVO": forçar HEX por slide, LAYOUT VISUAL preciso,
        COR DE FUNDO/TEXTO/DESTAQUE, DECISÃO VISUAL PRINCIPAL
    [Passo 2] generateTextLayers() → Gemini JSON mode
      • Prompt pixel-precise: altura = fontSize × lineHeight × nLinhas
      • Margem segura 60px; verificação de sobreposição entre layers
      • Retorna Array<{ textLayers: Layer[] }> com coordenadas exatas
    [Passo 3] generateDesign() [nanoBanana.ts]
      • Recebe textZonesPerSlide: TextZonesPerSlide (JSON estruturado)
        — não mais texto plano; cada zona tem {id,x,y,w,h,color}
      • NanoBanana recebe zonas como JSON → zero parsing textual
      • Cria shapes/images evitando zonas com opacity ≤ 0.35
      • validateLayers(): clampa todas as layers ao canvas antes de retornar
    [Merge] textLayers (Gemini) + designLayers (NanoBanana)
      • clamp() aplicado às textLayers antes do merge
    → prisma.post.create (status: DRAFT, content: pages)
    → SSE 'done' com postId + pages completo

Fluxo de imagens no chat de insumos:
  → Usuário ativa “IA nos slides” ou envia imagens manuais no painel de insumos
    → imagens manuais entram como projectAssets; logo entra com source='logo' e é tratado como identidade visual, não asset comum
    → POST /api/ai/:slug/generate-design recebe generateImages=true
    → Passo 1: IA entende briefing/roteiro
    → Passo 2: IA gera zonas/camadas de texto
    → Passo 3: durante cada slide, se necessário, backend pede imagem ao Nano Banana Image
    → imagem gerada vira asset contextual do slide e entra no generateDesign()
    → layout final posiciona a imagem com base na composição, referências e marca

Fluxo alternativo — geração direta de imagem:
  → POST /api/ai/:slug/generate-image
    → BrandConfig + referências + assets + logo separado
    → Nano Banana Image (Gemini image) como primário
    → FAL apenas como fallback opcional; erro de saldo retorna mensagem clara
    → prisma.post.create (status: READY, content: { type: 'image', dataUrl })
```

### Endpoints de IA (`/api/ai/:slug/`)

| Endpoint | Método | Descrição |
|---|---|---|
| `/:slug/chat` | POST | Chat streaming com Gemini (SSE) — usa brand context como system instruction |
| `/:slug/analyze-benchmark` | POST | Análise de referência/concorrente → insights em Markdown |
| `/:slug/generate-briefing` | POST | Gera guidelines + agentPrompt + suggestedColors (JSON) |
| `/:slug/generate-design` | POST | Gera DesignState[] via Nano Banana → salva como Post DRAFT |
| `/:slug/generate-image` | POST | Gera imagem via Gemini 2.5 Flash Image → salva como Post READY com dataUrl |

### Modelos de Dados (Prisma)

| Model | Campos principais |
|---|---|
| `User` | id, email, password, name, role (ADMIN/DESIGNER) |
| `Brand` | id, slug, name, color, userId |
| `BrandConfig` | agentPrompt, primaryFonts, colors[], guidelines, logoUrl — 1:1 com Brand |
| `Reference` | name, status (PENDING/ANALYZED/FAILED), insights, insightsText |
| `Post` | type (CAROUSEL/SINGLE_IMAGE/ANIMATION), status (DRAFT/GENERATING/READY/FAILED), content (Json layers) |

### Nano Banana — Gerador de Design Visual

- **Modelo:** `gemini-2.5-flash-lite` com `responseMimeType: 'application/json'`
- **Output:** Array de `DesignState` — cada item tem `format`, `width`, `height`, `backgroundColor`, `layers[]`
- **Layer types:** `text`, `image`, `shape` — cada uma com `x, y, width, height, zIndex, color, fontFamily, fontSize`
- **Dimensões:** carousel/single = 1080×1080; story = 1080×1920
- **Validação pós-geração:** `validateLayers()` clampa `x/y/width/height` dentro dos limites do canvas (sem layers off-screen)
- **Regra global de contraste (2026-05-13):** textos precisam contrastar sempre com o fundo; branco em fundo escuro, preto em fundo claro; sobre foto/imagem/gradiente complexo o backend ativa `contrastBackground` com box preto/branco translúcido editável no canvas.
- **Zonas de texto:** recebe `TextZonesPerSlide` (JSON estruturado por slide) — proibido shapes opacas (opacity > 0.35) sobre essas zonas
- **Paleta de cores:** prompt extrai as cores da marca do brandContext e instrui uso exclusivo delas
- **Consistência entre slides:** instruído a variar composição mas manter mesma paleta, família de formas e linguagem visual

### Auditoria de Qualidade (2026-05-12)

Problemas identificados e corrigidos:

| Problema | Severidade | Correção aplicada |
|---|---|---|
| Zonas de texto passadas como texto plano (parsing frágil) | Alta | `TextZonesPerSlide` JSON estruturado |
| Layers podiam extrapolar o canvas | Alta | `validateLayers()` + `clamp()` no merge |
| Brief vago — cores e layout deixados para NanoBanana decidir | Alta | Prompt "DECISIVO" com HEX por slide e LAYOUT VISUAL preciso |
| Text layer sem cálculo de altura real | Média | `height = fontSize × lineHeight × nLinhas` explícito no prompt |
| Slides visualmente inconsistentes | Média | NanoBanana instruído: mesma paleta, variar composição não identidade |
| NanoBanana sem paleta explícita | Média | Cores extraídas do brandContext e fornecidas como lista |

### Ferramentas disponíveis na Fábrica (frontend)

| Tool | Status | Backend |
|---|---|---|
| Gemini (chat) | ✅ Funcional | `/chat` SSE streaming |
| Fábrica v2 (Wizard) | ✅ Estável (27/04) | [[fabrica-v2]] — Fluxo procedural 3-steps |
| Nano Banana (design) | ⚠️ Em transição (ADR-005) | `/generate-design` → futuro: Canva Autofill |
| Imagem | ⚠️ Em transição (ADR-005) | `/generate-image` → futuro: upload para Canva Assets |
| Galeria (Gestão) | ✅ Estável (27/04) | [[galeria-gestao]] — DND + Exclusão |
| **Canva Editor (embed)** | ⏳ Planejado (ADR-005) | Canva Connect API — edição nativa |
| **Canva Export** | ⏳ Planejado (ADR-005) | Canva Export API — PNG/JPG/PDF/MP4 server-side |
| Animação (vídeo) | ⏳ Planejado (ADR-005) | Canva Export API suporta MP4 nativamente |

### Gaps UI ↔ Backend — Estado Atual (2026-04-25)

> ⚠️ **Correção:** a afirmação anterior de que as páginas de configuração "não chamam o backend" estava incorreta. As páginas `branding/`, `agent/` e `referencias/` já chamavam o backend corretamente antes do Sprint 0.

- **Configurações de marca:** páginas `branding/` e `agent/` chamam `PUT /api/settings/:slug/config` corretamente. `referencias/` tem CRUD completo com análise em background via Gemini.
- **Post de imagem no editor:** quando a Gabi abre no editor um post gerado pela tool Imagem, o canvas fica vazio — o editor faz `content.layers || []` mas posts de imagem têm `content.type === 'image'`, sem `layers`. > ⚠️ CONFLITO: `auditoria-ux-logica-designer.md` (2026-04-25) marca N1 como ✅ Feito via commit de 25/04 — confirmar se ainda está aberto.
- **Markdown nos balões da Fábrica:** links `[Editor](...)` são exibidos como texto literal. > ⚠️ CONFLITO: `auditoria-ux-logica-designer.md` (2026-04-25) marca N3 como ✅ Feito — confirmar se ainda está aberto.
- **Toast de feedback:** saves de configuração funcionam mas não exibem confirmação visual. > ⚠️ CONFLITO: `auditoria-ux-logica-designer.md` (2026-04-25) marca N4 como ✅ Feito — confirmar se ainda está aberto.
- **Ownership check ausente:** qualquer usuário autenticado pode ler/escrever config de qualquer marca pelo slug. > ⚠️ CONFLITO: `auditoria-ux-logica-designer.md` (2026-04-25) marca N5 como ✅ Feito — confirmar se ainda está aberto.
- **Criação de nova marca:** botão sem handler implementado. > ⚠️ CONFLITO: `designer-plano-implementacao.md` (2026-04-25) marca T4 como ✅ Feito — confirmar se ainda está aberto.

## Decisões Tomadas

- **Nano Banana** = alias para Gemini 2.0 Flash Lite com API key separada, specializado em geração de JSON de design — separação de keys permite controle de cota independente.
- **JSON mode (`responseMimeType: 'application/json'`)** garante output parseável sem pós-processamento de markdown.
- **Content como `Json` no Prisma** — flexibilidade de schema de layers sem migrations a cada mudança de formato.
- **SSE para chat** em vez de WebSockets — mais simples, suficiente para streaming unidirecional.

## Learnings

- Gemini ainda pode envolver JSON em blocos markdown mesmo com JSON mode — `rawText.replace(/\`\`\`json/g, '')` como fallback em `generate-briefing`.
- Rate limit 429 do Gemini Free Tier ocorre frequentemente — tratar explicitamente com mensagem amigável.
- `ffmpegVideo.ts` existe no frontend mas a tool de Animação ainda é stub — indica intenção futura de exportação de vídeo.

## Relacionados

- [[designer-backend]] — Express, rotas, auth middleware, Prisma
- [[designer-frontend]] — Next.js App Router, [marca] dynamic routes
- [[canva-connect-api]] — novo motor de edição e export (ADR-005)
- [[adr-005-canva-api-migração]] — decisão da migração
- [[qualidade-lint-build]] — estabilidade de lint/build e evidências
- [[secretaria-ai-gabi]] — este app é a base do Agente Designer mencionada no diagnóstico
- [[infraestrutura-tecnica]] — estado das integrações
