---
title: Fábrica v2 — Redesign Procedural
type: feature
tags:
  - "fabrica"
  - "wizard"
  - "ai"
  - "design"
status: stable
created: 2026-04-27
updated: 2026-04-27
---

# 🏭 Fábrica v2 — Redesign Procedural

A Fábrica foi completamente reidealizada para abandonar o modelo de chat livre em favor de um **Workflow Procedural** (Wizard), focado em previsibilidade e qualidade de saída.

## 🚀 Motivação
O modelo anterior de chat puro era impreciso para configurações estruturais (tamanho, layouts específicos, assets). A v2 separa a *configuração técnica* do *input criativo*.

## 🛠️ Arquitetura do Componente

O fluxo é gerenciado pelo [[PresentationWizard]], um componente de estado complexo que divide a criação em 3 etapas:

1.  **Layout**: Seleção da estrutura visual base (Texto/Imagem, Timeline, Citação, etc).
2.  **Estrutura**: Configuração de metadados (Tamanho do slide, quantidade, densidade de conteúdo) e gestão de **Assets do Projeto** (imagens que a IA deve usar obrigatoriamente).
3.  **Insumos**: Interface estilo chat para input de texto e/ou imagem de referência.

### Sub-componentes Especializados
Para garantir a modularidade e evitar conflitos de estilo, os cards foram isolados:
- [[ChoiceCard]]: Cards da tela inicial (Imagem, Apresentação, Animação).
- [[LayoutCard]]: Seleção de layout no wizard.
- [[AssetCard]]: Gerenciamento de uploads de projeto.

## 👁️ Preview em Tempo Real
Implementamos um motor de preview visual no canvas que:
- Reflete o **Aspect Ratio** real (A4, 16:9, Post Instagram).
- Mostra uma representação esquemática do layout selecionado usando medidas percentuais (responsivo).
- Inclui a opção **"IA Decide"**, onde o motor [[nanoBanana]] escolhe o melhor layout por slide baseado no conteúdo.

## 🤖 Integração com IA
O motor [[nanoBanana]] (Gemini-3-Flash) agora recebe um contexto expandido:
- `layoutTemplateId`: ID do layout ou flag `ai-decide`.
- `projectAssets`: Lista de imagens enviadas especificamente para este design.
- `density`: Instrução de quão detalhado o conteúdo deve ser.

## 📁 Arquivos Relacionados
- Frontend: `src/app/[marca]/fabrica/page.tsx`, `src/components/Fabrica/PresentationWizard.tsx`
- Estilos: `fabrica.module.css`, `PresentationWizard.module.css`
- Backend: `src/routes/ai.ts`, `src/lib/nanoBanana.ts`

## ✅ Status
- [x] Wizard 3-steps
- [x] Preview responsivo
- [x] Gestão de Assets
- [x] Opção "IA Decide"
- [x] Vídeo de carregamento (110% scale)
