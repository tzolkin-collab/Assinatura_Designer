---
title: Arquitetura Frontend — Designer
type: architecture
tags:
  - "next.js"
  - "react"
  - "typescript"
  - "app-router"
  - "canvas-editor"
  - "branding"
  - "dynamic-routes"
  - "sse"
sources:
  - "designer/frontend/src/app/[marca]/fabrica/page.tsx"
  - "designer/frontend/src/lib/api.ts"
  - "designer/frontend/src/components/Editor/CanvasEditor.tsx"
created: 2026-04-22
updated: 2026-05-13
---

# Arquitetura Frontend — Designer

## Resumo

Next.js com App Router e TypeScript. A rota dinâmica `[marca]` isola o contexto de cada brand — todas as páginas dentro dela recebem o `slug` da marca via `useParams()`. A "Fábrica" é o hub de criação (chat com IA + Nano Banana). O **CanvasEditor** é o editor visual embarcado (react-rnd), reativado em 2026-05-11 após ADR-006. Comunicação com backend em `localhost:4000` via `fetch` + SSE para streaming.

## Detalhes

### Estrutura de páginas

```
/                          ← landing / redirect
/login                     ← autenticação
/galeria                   ← galeria global de posts

/[marca]/
  configuracoes/           ← hub de config da marca (página estática com 3 links)
    branding/              ← cores, fontes, logo — chama PUT /api/settings/:slug/config ✅
    agent/                 ← agentPrompt, guidelines — chama PUT /api/settings/:slug/config ✅
    referencias/           ← CRUD completo: cria → polling 5s → exibe insights ✅
    canva/                 ← conexão OAuth com Canva (código existente, Canva descartado — ADR-006)
  fabrica/                 ← chat IA (Gemini + Nano Banana pipeline 3-passos)
  editor/                  ← landing: grid de designs disponíveis para editar
  editor/[postId]/         ← CanvasEditor completo com LayerPropertiesPanel + save
  galeria/                 ← galeria de posts da marca (pastas, drag-and-drop, preview, delete)

/extras/docs/              ← documentação interna
```

### Componentes principais

| Componente | Localização | Papel | Status |
|---|---|---|---|
| `AppShell` | `components/AppShell/` | Layout base com sidebar + conteúdo | ✅ |
| `Sidebar` | `components/Sidebar/` | Navegação entre seções da marca (inclui link Editor) | ✅ |
| `CanvasEditor` | `components/Editor/CanvasEditor.tsx` | Editor visual: drag/resize (`react-rnd`), multi-select, marquee, multi-drag | ✅ (ADR-006) |
| `LayerPropertiesPanel` | `components/Editor/LayerPropertiesPanel.tsx` | Painel de edição do layer selecionado (único); passa `onPreviewAnimation` para `AnimationPanel` | ✅ (ADR-006) |
| `MultiSelectPanel` | `components/Editor/panels/MultiSelectPanel.tsx` | Painel de alinhamento/distribuição para seleção múltipla (≥2 layers) | ✅ (2026-05-12) |
| `ShortcutsPanel` | `components/Editor/ShortcutsPanel.tsx` | Modal de atalhos: referência + configuração (gravação de teclas, sequências) | ✅ (2026-05-12) |
| `DesignRenderer` | `components/Fabrica/DesignRenderer.tsx` | Visualizador read-only de `DesignPage[]` (thumbnails, galeria, preview) | ✅ |
| `Button`, `Card`, `Input`, `PageHeader` | `components/ui/` | Design system interno | ✅ |

### CanvasEditor — arquitetura interna

```
editor/[postId]/page.tsx
  ├── header: back, info, inserir (shapes/texto), ações (grade, atalhos, salvar, JSON)
  ├── sidebar: Designs | Camadas | Assets | Propriedades
  │     ├── LayerPropertiesPanel (1 layer selecionado) + botão Play na AnimationPanel
  │     ├── MultiSelectPanel (≥2 layers selecionados)
  │     └── BackgroundPanel (nenhum layer selecionado)
  ├── canvas: CanvasEditor (seleção múltipla ↔ sidebar sincronizados; previewLayerId/previewKey)
  └── footer: slide nav
```

**Tabs do sidebar — montagem persistente (2026-05-13):**
- Todas as 4 abas (Designs, Camadas, Propriedades, Assets) ficam **sempre montadas** — controladas por `display: none/block` em vez de renderização condicional.
- Antes disso, trocar de aba causava unmount/remount e perda de inputs não commitados (valores digitados mas não confirmados com blur/Enter).
- Os `NumInput` ainda usam `key={id}` para resetar quando o layer muda — comportamento correto preservado.

**Fluxo de edição (multi-select — 2026-05-12):**
1. Página carrega `GET /posts/:id` → extrai `DesignPage[]` do campo `content`
2. `CanvasEditor` recebe `selectedLayerIds: string[]` — array de IDs selecionados
3. Clique simples → `[layerId]`; Ctrl+clique → toggle no array; drag no fundo → marquee
4. Drag de um layer selecionado com múltiplos → multi-drag: delta aplicado a todos via `onDragStart` + `onDragStop`
5. `MultiSelectPanel` exibe bounding box + alinhamento + distribuição → `handleMultiSelectChange(Map<id, Partial<Layer>>)`
6. Quando a seleção contém apenas camadas de texto (≥2), `MultiSelectPanel` exibe “Texto em lote”: fonte, tamanho, peso, cor, alinhamento, line-height, espaçamento, estilo e contraste são aplicados a todas via `Map<id, Partial<Layer>>`.
7. Atalhos (Delete, Ctrl+D, Arrows) operam em todos os layers selecionados
8. Botão Salvar → `PUT /posts/:id` com `content: pages` completo

**Escala dinâmica:**
- Outer div: `width: 100%` + `aspectRatio` inline → altura calculada pelo browser
- `ResizeObserver` mede largura do outer → `scale = containerWidth / canvasWidth`
- Inner div: `width: canvasWidth, height: canvasHeight, transform: scale(scale), transformOrigin: top left`
- `Rnd` recebe `scale={scale}` — corrige coordenadas de mouse em canvas escalado

### Layer — tipo canônico

`DesignRenderer.Layer` é o tipo compartilhado entre `DesignRenderer` e `CanvasEditor`. Campos adicionados para o editor:

```typescript
// Campos editor-only (opcionais, ignorados pelo DesignRenderer)
borderWidth?: number; borderColor?: string;
shadowColor?: string; shadowBlur?: number; shadowOffsetX?: number; shadowOffsetY?: number;
gradientType?: 'linear' | 'radial' | 'none'; gradientColor2?: string; gradientAngle?: number;
```

**Contraste e robustez do canvas (2026-05-13):**
- `CanvasEditor` normaliza defensivamente layers antes do `react-rnd`: `x`, `y`, `width`, `height` e `zIndex` nunca chegam como `null`/`undefined` ao Rnd, evitando `Cannot read properties of null (reading 'toString')`.
- Layers de texto suportam `contrastBackground`, `contrastBackgroundColor`, `contrastBackgroundOpacity` e `contrastBackgroundRadius`; renderização acontece em `layerStyle.ts` e edição fica no `TextPanel`.
- Fundo relativo do texto é editável no canvas e deve ser usado quando texto estiver sobre foto, imagem, gradiente forte ou fundo visualmente complexo.

**Preview de animação no editor (2026-05-13):**
- `AnimationPanel` ganhou botão Play (ativo só quando `animationIn !== 'none'`).
- Clicar chama `onPreview → handlePreviewAnimation` na editor page, que incrementa `previewKey` e seta `previewLayerId`.
- `CanvasEditor` recebe esses dois props. Para o layer correspondente, aplica o CSS keyframe (mesmos `@keyframes` do `globals.css` usados por `AnimatedLayerView`) num wrapper `<div key={isPreview ? 'anim-N' : 'static'}>` interno ao `Rnd`.
- A troca de `key` força remount do wrapper, reiniciando a animação a cada clique em Play.
- Mapa de keyframes: `lyrFade`, `lyrSlideUp/Down/Left/Right`, `lyrZoomIn/Out`, `lyrBlurIn`.

### Revisão/correção IA no Editor — job recuperável (2026-05-14)

1. Botão “Corrigir IA” abre `AIFixPanel` e chama `useDesignFixer.startPlanOnly(pages, marca)`.
2. Hook inicia job com `POST /api/ai/:slug/fix-design-job` e recebe `jobId`.
3. Hook consome SSE recuperável em `GET /api/ai/fix-jobs/:jobId/stream`.
4. Painel entra em `review`, mostra issues e plano de correções selecionáveis.
5. Usuário marca correções e clica Aplicar → `applySelected(pages, marca)` cria novo job com `selectedFixes`.
6. Backend aplica patches via `fixJobStore`, verifica resultado e retorna `correctedPages` no evento `complete`.
7. Usuário ainda precisa clicar “Aplicar Correção” para colocar `correctedPages` no estado local e depois salvar o post no editor.

Observações:
- `fixJobStore` agora é o store ativo para revisão, com memória, replay SSE, status e input humano via `/api/ai/fix-jobs/:jobId/input`.
- Persistência automática da correção no post ainda não foi ativada por decisão de UX: o usuário revisa/aplica no canvas e salva manualmente.

### Fábrica — fluxo de chat

1. Usuário seleciona ferramenta (Gemini / Nano Banana / Imagem / Animação)
2. `sendMessage()` faz `POST /api/ai/:slug/chat`, `/generate-design` ou `/generate-image`
3. Para Gemini: lê SSE stream (`fetch + ReadableStream`), atualiza mensagem chunk a chunk
4. Para Nano Banana/criação completa: inicia `POST /api/ai/:slug/create-job` e consome `GET /api/ai/jobs/:jobId/stream`, permitindo replay enquanto o job existir em memória
5. Para imagens no chat de insumos: botão “IA nos slides” apenas ativa `generateImages`; a imagem não é gerada imediatamente. Durante `/generate-design`, a IA entende o roteiro e o backend gera imagens contextuais por slide quando necessário.
6. Input manual de imagens permanece separado: upload/drop adiciona `projectAssets`; logo entra com `source='logo'` e deve ser tratado como identidade visual, não imagem decorativa comum.
7. `/penpot` no slash menu abre modal de escolha: layout/estrutura, imagem/export ou cores/tipografia, adicionando a seleção ao contexto `/btw`.
8. Animação: stub com timeout — não conectada ao backend

### Galeria — features

- Grid e list view com toggle
- Pastas: criar, excluir, drag-and-drop de posts entre pastas
- Preview modal para imagens e para designs (DesignRenderer)
- Exclusão de posts
- Design posts (sem previewUrl) mostram thumbnail via DesignRenderer

### Autenticação no frontend

- Token JWT guardado em `localStorage` como `auth_token`
- Enviado como `Authorization: Bearer <token>` em cada request
- `middleware.ts` na raiz do Next.js controla redirecionamentos de rota

### Regra de slug em APIs

- Rotas dinâmicas `[marca]` devem usar o valor bruto `params.marca` como slug em chamadas API (`/brands/:slug`, `/folders/:slug`, `/ai/:slug`).
- `decodeURIComponent(params.marca)` deve ser usado apenas para exibição textual na UI.
- Correção 2026-05-14: Editor e Galeria deixaram de passar nome decodificado para `useBrandPosts()` e rotas de folders, evitando `Brand not found` quando o slug codificado/diferente do nome era enviado ao backend.
- Correção 2026-05-14: `middleware.ts` protege rotas top-level reservadas (`equipe`, `extras`, `galeria`, `login`, `onboarding`). Acessos como `/equipe/galeria` são redirecionados para `/equipe`, evitando que caiam em `[marca]/galeria` e façam `/folders/equipe`.

### Libs auxiliares

| Arquivo | Uso | Status |
|---|---|---|
| `src/lib/api.ts` | Wrapper de fetch para o backend — usa `NEXT_PUBLIC_API_URL` env var | ✅ |
| `src/lib/hooks.ts` | Custom hooks React (`useBrands`, `useBrand`, `useBrandPosts`, `useConfig`) | ✅ |
| ~~`src/lib/canva.ts`~~ | ~~Helpers para URLs e estados do Canva~~ | 🗑️ Não implementado — Canva descartado |
| ~~`src/lib/ffmpegVideo.ts`~~ | ~~Exportação de vídeo~~ | 🗑️ Removido |

## Decisões Tomadas

- **`[marca]` dynamic route** como escopo — cada marca é isolada sem estado global, simplifica multi-tenancy.
- **SSE em vez de WebSocket** — nativo no browser via `fetch + ReadableStream`, zero dependências extras.
- **localStorage para token** — trade-off: simples de implementar, menos seguro que httpOnly cookie. Aceitável para MVP.
- **CanvasEditor reativado (ADR-006)** — editor próprio em vez de Canva/Penpot/Fabric.js.

## Learnings

- **Correção 2026-04-25:** as páginas de configuração JÁ tinham handlers de save corretos.
- **Markdown no chat:** mensagens da Fábrica são renderizadas como texto puro (`<p>`). Links não viram âncoras.
- **2026-05-05 — ADR-005:** tentativa de migrar para Canva Connect API.
- **2026-05-06 — ADR-006:** Canva bloqueado por iframe (`X-Frame-Options: SAMEORIGIN`).
- **2026-05-11 — ADR-006 aceita:** CanvasEditor reativado. `filter(Boolean)` antes do `.sort()` em `layers` previne crash quando Gemini retorna null dentro do array de layers. TDZ clássico com `const` — `currentPage` deve ser declarado antes de `selectedLayer`.
- **2026-05-12 — Multi-select:** `selectedLayerId: string | null` → `selectedLayerIds: string[]`. Marquee usa `ResizeObserver` + `window` mousemove/mouseup; posição calculada em canvas-space (`(clientX - rect.left) / scale`). Multi-drag: `onDragStart` captura posições iniciais de todos os selecionados; `onDragStop` aplica delta ao Map inteiro. `MultiSelectPanel` usa `Map<string, Partial<Layer>>` para bulk updates sem precisar conhecer todos os layers. Atalhos de teclado agora operam em array (nudge, delete, duplicate, zIndex).
- **2026-05-13 — Animation preview + tab persistence:** Botão Play na `AnimationPanel` dispara animação CSS diretamente no canvas do editor (via `previewLayerId`/`previewKey` → wrapper `key` remount). Abas do sidebar convertidas de renderização condicional para `display: none/block` — inputs não commitados sobrevivem à troca de aba. Fábrica page: `handleGenerate` (dead code) e `dims` useMemo (unused) removidos.

## Relacionados

- [[agente-designer]]
- [[designer-backend]]
- [[adr-006-editor-visual-alternativas-canva]]
- [[adr-005-canva-api-migração]]
- [[qualidade-lint-build]]
