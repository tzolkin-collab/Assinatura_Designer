---
title: Arquitetura — Agente Multimodelo (proposta histórica não implementada)
type: architecture
tags:
  - "agente"
  - "vercel-ai-sdk"
  - "tool-calling"
  - "multimodelo"
  - "gemini"
  - "designer"
sources:
  - "Projeto Assinatura/wiki/concepts/arquitetura-agente-multimodelo.md"
created: 2026-05-04
updated: 2026-05-13
---

# Arquitetura — Agente Multimodelo

> ⚠️ **Status em 2026-05-13:** este documento é uma proposta histórica migrada da KB anterior, não uma implementação ativa. O código atual do Designer não usa Vercel AI SDK nem dependências `ai`/`@ai-sdk/*`. A implementação real é Next.js + Express, com rotas próprias em `/api/ai/:slug/*`, BrandConfig por marca e Gemini/FAL/NanoBanana.

## Resumo
Pattern proposto de orquestração para um Designer multimodelo: um LLM "cérebro" receberia o briefing, planejaria em passos e chamaria **tools** especializadas até produzir o output final. A proposta citava Vercel AI SDK, mas isso não foi adotado no código atual; portanto não deve ser usado como evidência de pendência do MVP.

## Detalhes

### O pattern

```
[Briefing humano]
       │
       ▼
[ LLM principal (Gemini 2.5 Pro recomendado) ]
       │  system prompt = BrandConfig.agentPrompt
       │  tools registradas com schema Zod
       │  maxSteps: 10
       ▼
   ┌─────────── loop ───────────┐
   │ 1. LLM planeja: "preciso de X"  │
   │ 2. Chama tool com args      │
   │ 3. Tool executa             │
   │ 4. Resultado volta ao LLM   │
   │ 5. LLM observa, ajusta      │
   └────────────────────────────┘
       │
       ▼
   [Output final + Post.content JSONB]
```

### Tools definidas

| Tool | O que faz | Modelo/serviço |
|------|-----------|----------------|
| `generate_layout` | JSON de layers | Gemini 2.5 Flash Lite (`nanoBanana.ts`) |
| `generate_image` | Imagem fotorealista | FLUX 1.1 Pro via Replicate |
| `edit_image` | Edição contextual | Gemini 2.5 Flash Image |
| `generate_vector` | SVG ilustração | Recraft V3 |
| `remove_background` | Alpha removal | rembg / Bria.ai |
| `render_design` | JSON → PNG | Satori + Resvg |
| `analyze_reference` | Vision sobre referência | Gemini Pro Vision |
| `extract_palette` | Paleta programática | node-vibrant |
| `fetch_brand_asset` | Asset do R2 | Cloudflare R2 |
| `export_pdf` | Render PDF | `@react-pdf/renderer` |
| `export_pptx` | Render PPTX | `pptxgenjs` |

### Implementação proposta (não adotada no código atual)

```ts
import { generateText, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const result = await generateText({
  model: anthropic('claude-3-5-sonnet-latest'),
  system: brand.config.agentPrompt,
  messages: [{ role: 'user', content: briefing }],
  tools: {
    generate_layout: tool({
      description: 'Gera estrutura JSON de camadas para um post',
      parameters: z.object({
        prompt: z.string(),
        format: z.enum(['single', 'carousel', 'story']),
      }),
      execute: async ({ prompt, format }) => generateDesign(prompt, brandContext, format),
    }),
    generate_image: tool({
      description: 'Gera imagem fotorealista via FLUX',
      parameters: z.object({
        prompt: z.string(),
        aspectRatio: z.enum(['1:1', '4:5', '9:16']),
      }),
      execute: async ({ prompt, aspectRatio }) =>
        replicate.run('black-forest-labs/flux-1.1-pro', { input: { prompt, aspect_ratio: aspectRatio } }),
    }),
  },
  maxSteps: 10,
});
```

### Escolha do LLM cérebro

| Modelo | Custo | Quando usar |
|--------|-------|-------------|
| Claude 3.5 Sonnet | ~$3/MTok input | Qualidade de raciocínio máxima |
| Gemini 2.5 Pro | ~$0,6/MTok input | Custo (5× mais barato), já no ecossistema |
| Claude 3.5 Haiku | ~$0,8/MTok input | Tarefas simples, mais rápido |

**Recomendação: Gemini 2.5 Pro** — pelo custo + ecossistema já adotado no projeto.

## Decisões Tomadas
- Esta arquitetura permanece como referência/proposta, não como decisão implementada.
- No código atual, o equivalente prático de contexto por marca é `BrandConfig` + slug em rotas `/api/ai/:slug/*`, não um agente Vercel AI SDK.
- A decisão ativa continua sendo Gemini/NanoBanana/FAL via backend Express, conforme [[designer-backend]] e [[agente-designer]].

## Learnings
- **Loops infinitos:** `maxSteps` é a salvaguarda. Sempre setar
- **Custo escalando:** uma tarefa pode disparar 5–10 chamadas. Logar custo por step
- **Tool poisoning:** sanitizar saídas de tools que vêm de input externo
- **Determinismo:** para casos críticos, `temperature: 0` + seeds

## Relacionados
- [[render-layout-as-data]]
- [[designer-frontend]]
- [[designer-backend]]
- [[adr-002-gemini-llm-designer]]
