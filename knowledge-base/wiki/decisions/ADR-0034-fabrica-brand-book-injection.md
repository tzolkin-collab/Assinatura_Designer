---
name: ADR-0034-fabrica-brand-book-injection
description: Injetar automaticamente as diretrizes da marca (Brand Book) no contexto da IA
metadata:
  type: decision
  status: proposed
  priority: alta
  created: 2026-06-30
---

# ADR-0034 — Injeção de Brand Book no Contexto da Fábrica

## Contexto

A Fábrica atende múltiplas marcas (estrutura multi-tenant). Cada marca possui uma paleta de cores específica, tipografia padrão e diretrizes de tom de voz. Para que a IA gere designs que realmente pareçam "da marca", ela precisa ter conhecimento profundo dessas regras.

## Problema

- A IA, por padrão, gera designs genéricos ou inventa paletas se não for explicitamente instruída no prompt.
- O usuário não deveria precisar repetir "use a cor primária #FF0000" a cada novo prompt.

## Decisão

Implementar uma rotina de **Injeção de Brand Book**:
1. No início do pipeline do LangChain/Pipeline de IA (`backend/src/agents/pipeline.ts`), recuperar o objeto `BrandSettings` da marca atual do banco de dados.
2. Formatar essas diretrizes (Paleta de Cores, Fontes do Google Fonts, Tom de Voz) e incluí-las no `System Prompt` do Agente Designer (`backend/src/agents/brain/prompts.ts`).
3. Bloquear o agente (via prompt system rules) de usar fontes ou cores fora do brand book a menos que explicitamente solicitado.

## Consequências

- **Consistência de Marca**: Os templates gerados serão instantaneamente úteis e alinhados visualmente à marca do cliente.
- **Redução de Iterações**: O usuário não precisa corrigir as cores e fontes da geração inicial.
- **Consumo de Tokens**: Aumentará levemente o uso de tokens por requisição, pois o contexto inicial será maior.
