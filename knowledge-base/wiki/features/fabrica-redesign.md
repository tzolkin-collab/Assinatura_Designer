---
title: Fábrica — Redesign (PRD + Arquitetura Trae)
type: feature
tags:
  - "fabrica"
  - "redesign"
  - "prd"
  - "supabase"
  - "react"
  - "no-wizard"
sources:
  - ".trae/documents/prd-reidealizacao-pagina-fabrica.md"
  - ".trae/documents/arquitetura-tecnica-reidealizacao-fabrica.md"
  - ".trae/documents/page-design-fabrica.md"
created: 2026-05-04
updated: 2026-05-04
---

# Fábrica — Redesign (PRD + Arquitetura Trae)

## Resumo
Proposta de redesign da Fábrica gerada pelo Trae IDE. Define uma nova UX **sem wizard procedural** (tela única por tipo) e uma arquitetura alternativa baseada em React + Supabase Edge Functions. Ainda não implementada — representa uma direção de evolução futura a ser decidida.

> ⚠️ CONFLITO: Esta proposta contradiz a [[fabrica-v2]], que usa wizard 3-steps (Next.js + Express + Prisma). A decisão de qual arquitetura seguir está pendente — ver ADR necessário.

## Detalhes

### UX: dois estados no mesmo route `/fabrica`

**Estado A — Intro/Escolha do tipo**
- Animação inicial (4–8s lottie/vídeo)
- 3 cards: Imagem / Apresentação / Animação
- Clique transita para Estado B

**Estado B — Configuração (tela única, sem wizard)**
- Layout editor 3 painéis:
  - Esquerda (~24%): Estrutura/Templates/Assets (condicional por tipo)
  - Centro (~52%): Canvas na proporção do preset + badge dimensões + safe-area overlay
  - Direita (~24%): Brief guiado + Brand Kit + Configs (só presets/dropdowns) + [Gerar] sticky

### Arquitetura proposta (Trae)

```
React@18 + TypeScript (Frontend)
     ↓
Supabase Edge Functions (API de geração — mantém segredos fora do browser)
     ↓
External GenAI Model API
     +
Supabase Storage (fontes, thumbs, saídas)
Supabase PostgreSQL
```

### API proposta

```ts
POST /api/generate
// Request
type GenerateRequest = {
  contentType: 'image' | 'presentation' | 'animation';
  format: string;  // preset
  layout?: 'texto-esq/imagem-dir' | 'imagem-esq/texto-dir' | ...;
  prompt: { objetivo?; tema?; publico?; tom?; cta?; restricoes?; raw? };
  options?: { densidade?: 'breve'|'media'|'detalhada'; slides?: 5|6|7|8 };
  brand?: { headingFontAssetId?; bodyFontAssetId?; fallbackFamily? };
};
// Response
type GenerateResponse = {
  jobId: string;
  status: 'queued'|'running'|'succeeded'|'failed';
  output?: { previewUrl?; downloadUrl? };
  warnings?: Array<{ code: 'FONT_NOT_SUPPORTED'|'FONT_MISSING'|'LAYOUT_FALLBACK' }>;
};
```

### Data model proposto

```sql
CREATE TABLE projects ( id UUID, name TEXT, created_at TIMESTAMPTZ );
CREATE TABLE font_assets ( id UUID, project_id UUID, display_name TEXT, storage_path TEXT, file_ext TEXT );
CREATE TABLE generation_jobs (
  id UUID, project_id UUID, content_type TEXT, format_preset TEXT,
  layout_key TEXT, template_key TEXT, status TEXT,
  output_preview_url TEXT, output_download_url TEXT, warnings JSONB
);
```

## Decisões Tomadas
- Sem wizard procedural entre etapas (diferença central vs fabrica-v2)
- Supabase em vez de Express + Prisma + PostgreSQL próprio
- Máx. 6–10 controles por tipo; nenhum número livre

## Learnings
- Proposta Trae usa Supabase — reduz ops mas gera lock-in
- A rota sem wizard é mais simples para o usuário final mas requer layout condicional mais complexo no frontend

## Relacionados
- [[fabrica-v2]] — implementação atual (wizard, Next.js+Express)
- [[benchmarking-fabrica-ux]]
- [[fabrica-biblioteca-layouts]]
- [[adr-001-next-express-separados]]
