---
name: ADR-0037-fabrica-component-extraction
description: Extração de elementos do canvas para salvar como componentes reutilizáveis na biblioteca da Fábrica
metadata:
  type: decision
  status: proposed
  priority: baixa
  created: 2026-06-30
---

# ADR-0037 — Extração de Componentes Reutilizáveis

## Contexto

Durante o processo generativo, a IA ou o usuário podem criar um botão muito bom, ou um card de depoimento excelente. Reutilizar esse bloco no futuro seria ideal.

## Problema

- Atualmente o design gerado é monolítico ou composto de partes que se perdem após o projeto acabar.
- A IA tem dificuldade em gerar designs complexos do zero a cada vez; seria mais fácil ela agrupar "Componentes da Marca".

## Decisão

Criar o conceito de **Componentes Salvos**:
1. O usuário pode selecionar um grupo de elementos (ex: Foto + Texto + Botão) e clicar em "Salvar como Componente".
2. O sistema extrai o sub-JSON, pede para a IA gerar uma descrição/tagging (ex: "Card de Depoimento Minimalista"), e salva no banco de dados da Marca.
3. No chat da Fábrica, o usuário pode pedir "insira o Card de Depoimento", e a IA terá acesso à biblioteca de componentes salvos da marca para injetar perfeitamente.

## Consequências

- **Efeito Composto de Valor**: Quanto mais a marca usa a Fábrica, mais rica fica sua biblioteca, e mais rápidas e precisas são as gerações seguintes.
- **Complexidade de JSON**: É preciso gerenciar IDs conflitantes ao injetar um componente salvo dentro de um novo layout (geração de UUIDs novos no momento da injeção).
