---
name: ADR-0033-fabrica-history-undo
description: Implementar histórico visual e versão de designs na Fábrica permitindo Desfazer/Refazer contextual via IA
metadata:
  type: decision
  status: proposed
  priority: alta
  created: 2026-06-30
---

# ADR-0033 — Versionamento e Histórico de Designs na Fábrica (Undo/Redo)

## Contexto

A iteração com uma IA generativa costuma ser de tentativa e erro. Se o usuário pedir para "mudar a cor para azul" e não gostar, ele precisa de uma forma fácil de voltar ao estado anterior. Atualmente, se a IA sobrescrever o JSON do layout, não há garantia de que o estado anterior esteja perfeitamente acessível sem um sistema de versionamento.

## Problema

- Comandos na Fábrica são destrutivos em relação ao estado atual do preview.
- A frustração de perder um bom design gerado após um prompt ruim.
- O prompt para a IA "volte como estava" nem sempre recupera o JSON com 100% de precisão.

## Decisão

Criar um sistema de **Histórico de Versões baseado em Snapshots**:
1. Antes de cada resposta/ação da IA que altere o design, o frontend ou backend tira um snapshot do JSON atual (`state_id`).
2. A interface do chat terá um componente visual de "Timeline de Versões" ou botões "Desfazer / Refazer" atrelados ao estado do gerador.
3. Se o usuário digitar "desfaça isso", a IA é treinada para acionar uma tool de "Reverter Snapshot" em vez de tentar adivinhar e gerar o layout anterior.

## Consequências

- **Confiabilidade**: O usuário se sente mais seguro para experimentar prompts exóticos, sabendo que pode retroceder sem risco.
- **Armazenamento**: Maior consumo de Redis/DB para guardar snapshots de JSON temporários por sessão de chat.
- **Integração UI**: Será necessário adicionar controles de navegação de histórico no painel do chat ou no header do preview.
