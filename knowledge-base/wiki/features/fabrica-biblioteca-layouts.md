---
title: Fábrica — Biblioteca de Layouts com Ícones
type: feature
tags:
  - "fabrica"
  - "layouts"
  - "biblioteca"
  - "template-first"
  - "prompt-hint"
sources:
  - ".trae/documents/biblioteca-layouts-com-icones-fabrica.md"
created: 2026-05-04
updated: 2026-05-04
---

# Fábrica — Biblioteca de Layouts com Ícones

## Resumo
Especificação da biblioteca de layouts selecionáveis na Fábrica. Cada layout tem um `layoutKey` canônico, ícone pictograma, uso típico e `prompt hint` para guiar os modelos de IA. Compatíveis com 16:9, 4:3 e A4. Reduz ambiguidade entre LLMs e mantém consistência visual.

## Detalhes

### Regras gerais
- `layoutKey`: curto, estável, "prompt-friendly" (`texto-esq/imagem-dir`)
- Ícone: pictograma minimalista da estrutura (não da estética)
- Todo layout funciona em 16:9, 4:3 e A4
- Safe-area: sempre 5–8% do frame para texto e elementos críticos

### Conjunto MVP

| layoutKey | Nome exibido | Uso típico | Prompt hint |
|---|---|---|---|
| `texto-esq/imagem-dir` | Texto à esquerda / Imagem à direita | Explicação + evidência visual | Coluna esq: título + bullets; col dir: imagem principal |
| `imagem-esq/texto-dir` | Imagem à esquerda / Texto à direita | Produto + mensagem | Imagem grande à esq; heading + 3 bullets à dir |
| `imagem-topo/texto-base` | Imagem em cima / Texto embaixo | Capa/hero + contexto | Imagem no topo; abaixo: título + parágrafo curto |
| `titulo/bullets` | Título + bullets | Slide de lista | Título curto; 3–5 bullets; evitar texto longo |
| `2-colunas-texto` | Duas colunas de texto | Comparação | Duas colunas equilibradas; cada uma com subtítulo + 2–3 bullets |
| `antes/depois` | Antes / Depois | Transformação | Duas metades; rótulos Antes/Depois; manter simetria |

### Metadados por layout
```ts
interface LayoutMeta {
  layoutKey: string;
  minTextDensity: 'breve' | 'media' | 'detalhada';
  supportsImages: boolean;
  slots: string[];  // ['title', 'body', 'image', 'caption']
  fallbackLayoutKey: string;
}
```

### Presets de formato suportados
- Apresentação: `presentation_16_9`, `presentation_4_3`
- Documento: `a4_portrait`, `a4_landscape`

### Integração com fontes na geração
Ao chamar o modelo, incluir: `headingFontAssetId`, `bodyFontAssetId`, `fallbackFamily`.
Se fallback ocorrer, retornar `warnings: FONT_NOT_SUPPORTED`.

### Benchmarking de modelos (matriz de teste)
Para evolução da biblioteca — comparar modelos sem depender de opinião:
1. Fidelidade ao layout: respeita slots/colunas? (0–2)
2. Tipografia: aplica fonte ou falha com fallback previsível? (0–2)
3. Overflow: evita texto fora da safe-area? (0–2)
4. Consistência: resultado estável em 3 execuções iguais? (0–2)
5. Tempo/custo: latência e custo por geração

## Decisões Tomadas
- Display como grid 3–4 colunas (desktop), cada item com ícone + nome
- nomes canônicos em inglês técnico (`texto-esq/imagem-dir`) para compatibilidade com prompts

## Relacionados
- [[fabrica-v2]]
- [[fabrica-redesign]]
- [[benchmarking-fabrica-ux]]
- [[agente-multimodelo]]
