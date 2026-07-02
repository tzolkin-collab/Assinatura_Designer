---
name: ADR-0036-fabrica-copywriting-suggestions
description: Integração de edição e refatoração de copy via IA diretamente no canvas
metadata:
  type: decision
  status: proposed
  priority: media
  created: 2026-06-30
---

# ADR-0036 — Refatoração e Sugestão de Copywriting via IA

## Contexto

Além do design visual, a cópia (texto) é fundamental. Muitas vezes um texto fornecido pelo cliente não cabe no card, ou está longo demais, ou o tom não está persuasivo o suficiente.

## Problema

- Ajustar textos significa sair do editor, ir para um ChatGPT externo, gerar opções e colar de volta.
- É difícil iterar os textos mantendo o encaixe visual perfeito no layout.

## Decisão

Implementar ferramentas de **Copywriting Contextual**:
1. Ao selecionar um texto no editor (ou via Modo Inspecionar `/edit` da Fábrica), o usuário ganha opções de IA: "Encurtar", "Alongar", "Tornar mais formal", "Corrigir Gramática", "Gerar Variantes".
2. A IA recebe o texto atual e as restrições visuais (largura e altura da caixa de texto).
3. As sugestões podem ser aplicadas diretamente no layout com um clique.

## Consequências

- **Ferramenta All-in-One**: Mantém o fluxo de trabalho inteiro da criação da peça na mesma tela.
- **Integração Frontend**: Necessita a criação de um menu flutuante próximo ao elemento de texto selecionado para acionar os sub-prompts.
