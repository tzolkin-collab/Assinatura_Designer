---
name: ADR-0035-fabrica-auto-resize
description: Funcionalidade de Auto-Resize inteligente via IA para adaptar formatos (ex 16:9 para 9:16)
metadata:
  type: decision
  status: proposed
  priority: media
  created: 2026-06-30
---

# ADR-0035 — Auto-Resize Inteligente via IA

## Contexto

Um caso de uso muito comum no design de marketing é criar uma peça para o Feed do Instagram (1:1) e depois adaptá-la para os Stories (9:16) ou para um Banner de Site (16:9). Fazer isso manualmente envolve reposicionar e redimensionar todos os elementos.

## Problema

- Alterar as proporções do canvas (`ADR-0028`) apenas estica ou corta os elementos, quebrando o layout.
- A adaptação manual consome muito tempo.

## Decisão

Adicionar o recurso de **Auto-Resize via Agente**:
1. O usuário pode acionar um comando ou prompt: "Gere uma versão para Stories".
2. O sistema envia o JSON do layout atual e o novo Target Aspect Ratio para a IA.
3. O modelo (LLM) calcula novas posições (X, Y), tamanhos (Width, Height) e tamanhos de fonte, devolvendo um JSON adaptado.
4. O resultado é adicionado como um **novo slide** na apresentação atual, preservando a proporção original no slide 1.

## Consequências

- **Agilidade Extrema**: Resolve uma das maiores dores dos designers nas ferramentas convencionais.
- **Desafio de Geometria para o LLM**: Modelos de linguagem podem ter dificuldade com o raciocínio espacial absoluto, podendo necessitar de uma ferramenta auxiliar (algoritmo determinístico de flex-layout acoplado).
