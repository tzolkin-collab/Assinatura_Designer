---
title: "ADR-002 — Gemini como LLM principal do Agente Designer"
type: decision
tags:
  - "adr"
  - "designer"
  - "gemini"
  - "llm"
  - "openai"
sources:
  - "features/agente-designer.md"
  - "architecture/designer-backend.md"
created: 2026-05-03
updated: 2026-05-03
---

# ADR-002 — Gemini como LLM principal do Agente Designer

## Resumo

Escolha do Gemini (Google) como LLM principal do Agente Designer para geração de layouts JSON (`nanoBanana.ts`) e geração de imagens, em vez de GPT-4o da OpenAI.

## Contexto

O Agente Designer precisa gerar layouts estruturados em JSON (formato `DesignState`) e, em fases posteriores, gerar imagens. Dois LLMs foram considerados: Gemini (Google) e GPT-4o (OpenAI).

O Bot Gabi já usa Gemini para extração de dados de atas e transcrição de mídia, e GPT-4o para chat geral.

## Decisão

Usar **Gemini** como LLM primário do Designer:
- `gemini-2.5-flash` para geração de layouts JSON (modo JSON com schema Zod)
- `gemini-2.0-flash-exp` (ou equivalente) para geração de imagens inline (fases futuras)
- SDK migrado para `@google/genai` durante Sprint 0 (25/04/2026)

## Consequências

| Aspecto | Resultado |
|---|---|
| JSON Mode | Gemini suporta geração de JSON estruturado com schema — reduz alucinações de estrutura |
| Custo | Gemini Flash é significativamente mais barato que GPT-4o para volumes altos |
| Cotas | Limite 429 pode ocorrer no Free Tier — mitigar com retry/backoff (Sprint 2) |
| Dual-key | Projeto usa duas chaves Gemini separadas: uma para chat, outra para design — isola cotas |
| Vendor lock | Risco de dependência do Google; mitigável com adapter pattern na camada de LLM |

## Alternativas rejeitadas

- **GPT-4o exclusivo** — custo maior; JSON Mode menos robusto para schemas complexos de layout.
- **Claude (Anthropic)** — não avaliado formalmente; custo similar ao GPT-4o.

## Relacionados

- [[agente-designer]]
- [[designer-backend]]
- [[adr-001-next-express-separados]]
