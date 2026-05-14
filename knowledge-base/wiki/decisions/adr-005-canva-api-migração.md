---
title: "ADR-005 — Canvas Editor próprio → Canva Connect API"
type: decision
tags:
  - "canva"
  - "api"
  - "editor"
  - "migration"
  - "design"
  - "oauth"
sources:
  - "designer/frontend/src/components/Editor/CanvasEditor.tsx"
  - "designer/frontend/package.json"
  - "designer/backend/src/lib/nanoBanana.ts"
created: 2026-05-05
updated: 2026-05-05
status: aceita
---

# ADR-005 — Canvas Editor próprio → Canva Connect API

## Contexto

O Agente Designer usa um editor visual construído do zero (`CanvasEditor.tsx`) com `react-rnd` para drag/resize e `html-to-image` + `html2canvas` + `jsPDF` para exportação. O editor suporta apenas camadas básicas (texto, forma, imagem) com propriedades limitadas. Exportação é feita via DOM screenshot no browser, o que causa bugs de CORS, fontes não carregadas e PDFs de baixa qualidade. O Nano Banana gera JSON de layers que o editor renderiza, mas a qualidade visual é muito inferior a ferramentas profissionais.

## Decisão

**Migrar 100% para a Canva Connect API** como motor de edição e exportação:

1. **Edição:** Delegar ao editor nativo do Canva via embed/redirect (Canva Button)
2. **Assets:** Upload de imagens geradas (Pollinations/Gemini) via Canva Assets API
3. **Templates:** Usar Canva Autofill API com templates pré-desenhados no Canva
4. **Exportação:** Canva Export API server-side (PNG, JPG, PDF, MP4)
5. **Galeria:** IDs do Canva no banco em vez de base64 inline

## Consequências

### Positivas

- **UX profissional imediata** — Usuários (Gabi) ganham acesso a todas as ferramentas do Canva (remoção de fundo, filtros, elementos, fontes premium, animações)
- **5 dependências NPM removidas** — `react-rnd`, `html-to-image`, `html2canvas`, `jspdf`, `@ffmpeg/ffmpeg`
- **~970 linhas de código eliminadas** — `CanvasEditor.tsx` (188L) + `editor/page.tsx` (682L) + `editor.module.css` (288L)
- **Export server-side** — Elimina bugs de CORS/fontes; suporta MP4 (resolve stub de Animação)
- **Performance do banco** — Posts param de armazenar base64 (MB) e passam a salvar IDs (bytes)

### Negativas

- **Nova dependência externa** — Canva como vendor; se API cair, edição para
- **OAuth2 necessário** — Complexidade adicional (fluxo de tokens, refresh, multi-marca)
- **Canva Enterprise** — Integrações privadas exigem plano Enterprise; MVP usa modo dev
- **Templates manuais** — Alguém precisa criar 5-10 templates base no Canva antes do Autofill funcionar
- **Custo potencial** — Canva API pode ter limites de uso ou cobranças no futuro

## Alternativas Consideradas

1. **Manter editor próprio + melhorar** — Descartado: custo de recriar ferramentas que o Canva já tem (meses de trabalho vs. integração de ~12 dias)
2. **Usar Polotno (open-source)** — Editor similar ao Canva mas self-hosted. Boa opção se Canva API se mostrar inviável, mas menor ecossistema de assets
3. **Usar Canva Apps SDK** — Cria plugin *dentro* do Canva, mas exige que o usuário já esteja no Canva. Connect API é mais adequada para integração *de fora para dentro*

## Relacionados

- [[designer-frontend]]
- [[designer-backend]]
- [[canva-connect-api]]
- [[agente-designer]]
