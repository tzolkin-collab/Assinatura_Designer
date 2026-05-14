---
title: Arquitetura — Render Layout-as-Data (Satori + Resvg)
type: architecture
tags:
  - "render"
  - "satori"
  - "resvg"
  - "layout-as-data"
  - "json-layers"
  - "tipografia"
  - "marca"
sources:
  - "Projeto Assinatura/wiki/concepts/render-layout-as-data.md"
created: 2026-05-04
updated: 2026-05-04
---

# Render Layout-as-Data

## Resumo
Pattern central do Designer: o layout de um post é representado como **JSON estruturado** (camadas tipadas com posição, tamanho, fonte, cor) e renderizado por uma engine determinística (Satori → SVG → Resvg → PNG). Fontes e identidade de marca ficam fora do modelo de IA, garantindo consistência visual perfeita. Mesmo JSON sempre produz mesmo PNG.

## Detalhes

### Por que esse pattern

```
❌ Errado (comum em ferramentas amadoras):
Briefing → Modelo de imagem → PNG final
Problema: tipografia errada, cores fora da paleta, texto ilegível

✅ Certo (o que o Designer já faz):
Briefing → LLM → JSON de layers → Render engine → PNG final
                                        ├── usa fontes reais (.woff2)
                                        ├── usa cores exatas da marca
                                        └── usa templates JSX
```

### Schema de camada (implementado em `nanoBanana.ts`)

```ts
interface Layer {
  id: string;
  type: 'text' | 'image' | 'shape';
  content?: string;
  url?: string;
  x: number; y: number;
  width: number; height: number;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  zIndex: number;
}

interface DesignState {
  format: 'carousel' | 'single' | 'story';
  width: number;   // 1080
  height: number;  // 1080 ou 1920
  backgroundColor: string;
  layers: Layer[];
}
```

### Pipeline de render

```ts
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const jsx = layersToJsx(designState);          // adapter: JSON → JSX
const svg = await satori(jsx, {                // JSX → SVG
  width: designState.width,
  height: designState.height,
  fonts: [{ name: 'Playfair Display', data: playfairBuffer, weight: 700 }],
});
const pngBuffer = new Resvg(svg).render().asPng(); // SVG → PNG
await r2.put(`posts/${postId}.png`, pngBuffer);    // upload R2
```

### Múltiplos outputs do mesmo JSON

```
        ├── Satori + Resvg       → PNG (Instagram)
JSON ───┼── @react-pdf/renderer  → PDF (apresentação comercial)
        ├── pptxgenjs            → PPTX (deck PowerPoint)
        └── ffmpeg + frames      → MP4 (Reels)
```

**Mesma fonte de verdade, 4 outputs** — argumento central para o pattern.

### Peça faltante: fontes no R2

`BrandConfig.primaryFonts` guarda só o nome. Satori precisa do binário. Modelagem proposta:

```sql
CREATE TABLE app."BrandFont" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "brandId"    UUID NOT NULL REFERENCES app."Brand"("id") ON DELETE CASCADE,
  "family"     TEXT NOT NULL,
  "weight"     INTEGER NOT NULL,
  "style"      TEXT NOT NULL DEFAULT 'normal',
  "fileR2Url"  TEXT NOT NULL
);
```

### Versionamento de schema

`Post.content` é JSONB. Quando o formato de layer mudar (rotation, opacity, gradient), posts antigos quebram. Proposta:

```sql
ALTER TABLE app."Post" ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 1;
```

Dispatcher por versão no renderer: `switch (post.contentVersion) { case 1: renderV1(...) }`.

## Decisões Tomadas
- Satori foi avaliado por suporte a fontes custom, Edge runtime e licença MIT; a referência antiga à Vercel AI SDK era parte da proposta histórica, não da implementação atual do Designer.
- Resvg para SVG→PNG: rust + Node bindings, rápido, determinístico, sem browser
- Layout por coordenadas absolutas (não flow CSS) para controle pixel-perfect

## Learnings
- **Fluidez visual:** layouts por coordenadas são menos fluidos que design humano — compensar com templates JSX bem desenhados
- **Blend modes e sombras complexas:** limitados em Satori vs Canvas/Konva
- **Animação:** Satori é estático. Reels precisam de rota ffmpeg separada

## Relacionados
- [[agente-multimodelo]]
- [[designer-backend]]
- [[fabrica-v2]]
