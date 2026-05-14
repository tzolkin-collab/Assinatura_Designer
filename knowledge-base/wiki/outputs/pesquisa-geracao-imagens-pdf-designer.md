---
title: Pesquisa — Geração de Imagens e PDF no Designer
type: output
tags:
  - "designer"
  - "image-generation"
  - "pdf"
  - "gemini"
  - "fal.ai"
  - "flux"
  - "playwright"
  - "jspdf"
  - "research"
sources: []
created: 2026-04-24
updated: 2026-04-24
---

# Pesquisa — Geração de Imagens e PDF no Designer

## Resumo

Pesquisa de opções e recomendações para conectar a tool "Imagem" (stub) do Designer ao backend e adicionar exportação de PDF ao CanvasEditor. A análise considera o stack atual (Express + Next.js + Gemini) e a deprecação iminente do Gemini 2.0 Flash em junho de 2026.

---

## Contexto

O [[agente-designer]] tem duas ferramentas stub na Fábrica:

| Tool | Status |
|---|---|
| Imagem | ⚠️ Stub — não conectada ao backend |
| Animação | ⚠️ Stub — `ffmpegVideo.ts` previsto |

Além disso, o CanvasEditor não oferece exportação de PDF — a saída atual é apenas visual na tela.

**Urgência adicional:** o modelo `gemini-2.0-flash-lite` (Nano Banana atual) será descontinuado em **1 de junho de 2026**. A migração para 2.5 é obrigatória independente desta feature.

---

## Parte 1 — Geração de Imagens

### Opções avaliadas

#### A. Gemini 2.5 Flash Image (`gemini-2.5-flash-image`)

- **Custo:** ~$0.039/imagem
- **SDK:** `@google/genai` — mesmo SDK já usado no projeto
- **Como funciona:** envia prompt texto (+ brand context) → retorna imagem em base64
- **Vantagem principal:** zero nova dependência, mesma chave `GEMINI_API_KEY` ou `NANO_BANANA_API_KEY` já configuradas
- **Limitação:** menor controle de estilo artístico vs modelos especializados

```typescript
// Exemplo de integração no Express
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const response = await ai.models.generateImages({
  model: 'gemini-2.5-flash-image',
  prompt: `${brandContext.guidelines}\n\n${userPrompt}`,
  config: { numberOfImages: 1, outputMimeType: 'image/jpeg' },
});
// response.generatedImages[0].image.imageBytes → base64
```

#### B. Imagen 4 (via Vertex AI)

- **Custo:** $0.02–$0.06/imagem (3 tiers de qualidade)
- **Vantagem:** melhor qualidade fotorrealista, produção enterprise
- **Desvantagem:** requer setup Vertex AI (credenciais GCP além de API key), mais complexo para deploy no EasyPanel atual

#### C. fal.ai + FLUX

- **Custo:** FLUX Schnell $0.003/img (preview) · FLUX.2 Pro $0.03/megapixel (final)
- **SDK:** `@fal-ai/client` — JavaScript nativo, ~5 linhas de integração
- **Vantagem:** melhor qualidade artística para designs de marca, modelo especializado em imagem
- **Estratégia dual:** usar Schnell para preview rápido na Fábrica, Pro para exportação final

```typescript
import * as fal from '@fal-ai/client';

fal.config({ credentials: process.env.FAL_API_KEY });

const result = await fal.subscribe('fal-ai/flux/schnell', {
  input: { prompt: userPrompt, image_size: 'square_hd' },
});
// result.images[0].url → URL pública temporária
```

### Recomendação para Imagens

| Cenário | Escolha |
|---|---|
| MVP rápido, zero nova infraestrutura | **Gemini 2.5 Flash Image** — aproveita a migração obrigatória do 2.0 |
| Qualidade de marca superior | **fal.ai FLUX** — FLUX Schnell para preview, FLUX.2 Pro para exportação |

**Sugestão de caminho:** implementar Gemini 2.5 Flash Image primeiro (desbloqueia a feature e resolve a migração), avaliar qualidade com a Gabi, e oferecer fal.ai FLUX como upgrade se a qualidade não for suficiente para conteúdo de marca.

### Fluxo de integração proposto

```
Usuário descreve imagem na Fábrica
  → POST /api/ai/:slug/generate-image
    → getBrandContext(slug)           ← guidelines + cores + logo
    → Gemini 2.5 Flash Image          ← prompt enriquecido com brand context
    → upload para storage (ou base64) ← salvar URL acessível ao frontend
    → retorna { imageUrl }
  → Frontend insere como Layer { type: 'image', url: imageUrl }
    no CanvasEditor (mesmo modelo de layer já existente)
```

**Novo endpoint:** `POST /api/ai/:slug/generate-image`

---

## Parte 2 — Geração de PDF

### Opções avaliadas

#### A. html2canvas + jsPDF (client-side)

- **Onde roda:** no browser, sem mudança de backend
- **Como funciona:** captura o DOM do CanvasEditor → converte para imagem → incorpora no PDF
- **Prós:** instalação simples (`npm install html2canvas jspdf`), funciona com o CSS/canvas atual
- **Contras:** texto do design é rasterizado (não selecionável no PDF), arquivo maior

```typescript
// No CanvasEditor (frontend)
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const exportPdf = async () => {
  const canvas = await html2canvas(canvasRef.current);
  const imgData = canvas.toDataURL('image/jpeg', 0.95);
  const pdf = new jsPDF({ unit: 'px', format: [1080, 1080] });
  pdf.addImage(imgData, 'JPEG', 0, 0, 1080, 1080);
  pdf.save(`design-${postId}.pdf`);
};
```

#### B. @react-pdf/renderer (client-side, vetorial)

- **Onde roda:** browser ou Node.js
- **Como funciona:** você redescreve o DesignState como componentes `<Document>`, `<Page>`, `<Text>`, `<Image>` — gera PDF vetorial com texto selecionável
- **Prós:** PDF de qualidade profissional, texto real, arquivo menor
- **Contras:** requer reimplementar as layers como componentes React-PDF — trabalho significativo, nem todas as transformações CSS têm equivalente

#### C. Playwright (server-side)

- **Onde roda:** Express backend — novo endpoint
- **Como funciona:** Playwright sobe Chromium headless, navega para uma rota de renderização do design, captura como PDF
- **Prós:** pixel-perfect, renderiza tudo que o browser renderiza (fontes, sombras, gradientes), ~42ms warm / 3ms render
- **Benchmark 2026:** Playwright é 3× mais rápido e gera arquivos 2× menores que Puppeteer

```typescript
// Express — POST /api/posts/:id/export-pdf
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:3000/${slug}/render/${postId}`);
const pdfBuffer = await page.pdf({ width: '1080px', height: '1080px', printBackground: true });
await browser.close();
res.setHeader('Content-Type', 'application/pdf');
res.send(pdfBuffer);
```

Isso requer uma rota Next.js dedicada de "render-only" (sem sidebar, sem header) que o Playwright visita.

### Recomendação para PDF

| Prioridade | Abordagem |
|---|---|
| MVP (rápido) | **html2canvas + jsPDF** no frontend — botão "Exportar PDF" no CanvasEditor, sem tocar no backend |
| Produção | **Playwright no Express** — qualidade superior, funciona server-side para envio por e-mail/WhatsApp |

**Nota de consistência:** o formato de exportação mais importante para a Gabi provavelmente é imagem (JPEG/PNG para WhatsApp/Instagram), não PDF. Confirmar prioridade antes de investir em PDF.

---

## Plano de implementação sugerido

### Sprint 1 — Migração obrigatória + Image tool MVP (urgente)

1. Atualizar `nanoBanana.ts` e `ai.ts` para `gemini-2.5-flash-lite` (deprecação em 1 jun 2026)
2. Criar `POST /api/ai/:slug/generate-image` usando Gemini 2.5 Flash Image
3. Conectar a tool "Imagem" na Fábrica ao novo endpoint
4. Inserir resultado como layer `{ type: 'image', url }` no CanvasEditor

### Sprint 2 — Export PDF/PNG

1. Adicionar botão "Exportar" no CanvasEditor
2. Export PNG/JPEG: usar `canvas.toDataURL()` do elemento `<canvas>` nativo (já disponível no browser)
3. Export PDF: html2canvas + jsPDF como MVP; Playwright como V2 se necessário

### Sprint 3 — Upgrade de qualidade (opcional)

1. Avaliar qualidade das imagens geradas com a Gabi
2. Se insuficiente → adicionar `FAL_API_KEY` e integrar fal.ai FLUX como opção alternativa na Fábrica

---

## Comparativo rápido de custos

| Serviço | Modelo | Custo/imagem |
|---|---|---|
| Google AI | Gemini 2.5 Flash Image | ~$0.039 |
| Google AI | Imagen 4 (básico) | ~$0.020 |
| fal.ai | FLUX Schnell (preview) | ~$0.003 |
| fal.ai | FLUX.2 Pro | ~$0.030/megapixel |

---

## Relacionados

- [[agente-designer]] — feature alvo desta pesquisa
- [[designer-backend]] — onde os novos endpoints vivem
- [[designer-frontend]] — CanvasEditor e Fábrica

---

## Fontes

- [Google AI — Image Generation (Gemini API)](https://ai.google.dev/gemini-api/docs/image-generation)
- [Google AI — Imagen via Gemini API](https://ai.google.dev/gemini-api/docs/imagen)
- [Gemini 2.5 Flash Image — Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-image)
- [fal.ai — FLUX API](https://fal.ai/flux)
- [fal.ai — Pricing](https://fal.ai/pricing)
- [HTML to PDF benchmark 2026 — PDF4.dev](https://pdf4.dev/blog/html-to-pdf-benchmark-2026)
- [Playwright PDF Generation](https://pptr.dev/guides/pdf-generation)
