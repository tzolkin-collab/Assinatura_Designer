---
title: Benchmarking — UX Ferramentas de Criação (Fábrica)
type: output
tags:
  - "fabrica"
  - "benchmarking"
  - "ux"
  - "canva"
  - "gamma"
  - "beautiful-ai"
  - "pitch"
  - "layout"
sources:
  - ".trae/documents/benchmarking-ferramentas-ui-e-layout-fabrica.md"
created: 2026-05-04
updated: 2026-05-04
---

# Benchmarking — UX Ferramentas de Criação (Fábrica)

## Resumo
Análise comparativa de Canva, Beautiful.ai, Pitch, Gamma, Slidebean e PowerPoint/Copilot para orientar o redesign da Fábrica. Foco em: fluxo de entrada, guardrails, brand kit, editor, preview e export. Resultado: 5 padrões recorrentes entre os melhores que devem guiar a UI.

## Detalhes

### Os 5 padrões que se repetem nos melhores

1. **3 painéis**: biblioteca/outline (esq.) + canvas (centro) + inspector (dir.)
2. **Presets em vez de números livres**: escolhas discretas (layout, densidade, tema, estilo de imagem)
3. **Config antes de gerar**: tamanho/formato/densidade claros *antes* do botão Gerar (padrão Gamma)
4. **Guardrails por layout**: smart templates (Beautiful.ai) ou arrange-with-AI (Slidebean) para consistência
5. **Brand kit separado**: estilos do projeto (cores/fontes/logo) ficam num nível acima dos slides

### Por ferramenta

| Ferramenta | Padrão | O que copiar |
|---|---|---|
| Canva | template-first | Biblioteca esq + canvas + toolbar; presets e menus contextuais |
| Beautiful.ai | smart layout / guardrails | Auto-reorganiza spacing; escolhas discretas em vez de sliders |
| Pitch | slides + layouts | Estilo do deck separado do conteúdo; biblioteca de layouts por slide |
| Gamma | outline-first | Passo "configurar antes de gerar"; controles tipo densidade breve/média/detalhada |
| Slidebean | IA para arranjo | Botão "Reorganizar layout" como ação segura |

### O que NÃO colocar
- Inputs numéricos livres (dimensões, grid/colunas, tamanho de fonte, espaçamentos) — devem ser consequência de preset + template
- Controles fora de faixas comuns (999 slides, 20.000×20.000px, margens negativas)

### Proposta de layout recomendada para a Fábrica

```
Top bar: tipo (Apresentação/Imagem/Animação) | preset formato | [Gerar] [Salvar preset] [Exportar]

Coluna esquerda (~24%):
  Estrutura: lista de slides/cards
  Templates: galeria
  Assets: biblioteca + uploads

Centro (~52%):
  Canvas na proporção do preset
  Badge: dimensões + toggle Safe-area

Coluna direita (~24%):
  Brief (Objetivo, Tema, Público, Tom, CTA, Restrições)
  Brand Kit / Fontes
  Configurações (apenas presets/dropdowns)
  [Gerar] sticky no rodapé
```

## Decisões Tomadas
- Máximo 6–10 controles por tipo na coluna de config
- Poder via templates de layout, não via valores livres
- Preview sempre mostra dimensão e safe area antes de gerar

## Relacionados
- [[fabrica-v2]]
- [[fabrica-redesign]]
- [[fabrica-biblioteca-layouts]]
