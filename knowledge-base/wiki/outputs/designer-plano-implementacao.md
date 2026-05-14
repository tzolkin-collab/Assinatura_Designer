---
title: Plano de Implementação — Agente Designer (MVP 3 e 4)
type: output
tags:
  - "designer"
  - "planejamento"
  - "mvp3"
  - "mvp4"
  - "implementação"
  - "roadmap"
  - "requisitos"
sources: []
created: 2026-04-24
updated: 2026-04-25
---

# Plano de Implementação — Agente Designer (MVP 3 e 4)

## Resumo

Planejamento detalhado para fechar os gaps críticos do Agente Designer e entregar os MVPs 3 e 4 contratados com a Gabi. O ponto de partida é o diagnóstico da [[designer-auditoria-jornada]]. Prazo final: 14/07/2026.

---

## Necessidades do Projeto

### Técnicas (o que precisa ser construído ou corrigido)

| # | Item | Tipo | Prioridade |
|---|---|---|---|
| T1 | Migrar `gemini-2.0-flash-lite` → `gemini-2.5-flash-lite` em todos os endpoints | Migração obrigatória | ✅ Feito (Sprint 0) |
| T2 | Implementar handler de save para `BrandConfig` no backend | Bug / Feature | ✅ Já existia — wiki estava incorreta |
| T3 | Conectar páginas `branding/`, `agent/`, `referencias/` ao endpoint de save | Bug / Feature | ✅ Já existia — wiki estava incorreta |
| T4 | Implementar handler de criação de nova marca | Bug | ✅ Feito |
| T5 | Substituir mock de benchmark pelo endpoint real `/api/ai/:slug/analyze-benchmark` | Bug | ✅ Feito |
| T6 | Criar `POST /api/ai/:slug/generate-image` (Gemini 2.5 Flash Image) | Feature nova | ✅ Feito (Sprint 0) |
| T7 | Conectar Tool "Imagem" da Fábrica ao novo endpoint real | Feature nova | ✅ Feito (Sprint 0) |
| T8 | Inserir imagem gerada como layer no CanvasEditor | Feature nova | ✅ Feito |
| T9 | Botão "Exportar PNG/JPEG" no CanvasEditor | Feature nova | ✅ Já estava funcional (`html-to-image`) |
| T10 | Botão "Exportar PDF" no CanvasEditor (`html2canvas + jsPDF`) | Feature nova | ✅ Feito |
| T11 | Completar auth middleware (aplicar em todas as rotas protegidas) | Bug / Segurança | ✅ Feito |
| T12 | Wizard de onboarding guiado para setup de marca | Feature nova | ✅ Feito |
| T13 | Toast/feedback visual após saves bem-sucedidos ou com erro | UX | ✅ Feito |
| T14 | Avaliar qualidade de geração com Gabi → upgrade para fal.ai FLUX se necessário | Decisão | Baixa |
| T15 | Integração `ffmpegVideo.ts` para export de animação (MP4/GIF) | Feature nova | Baixa |

### Técnicas — Auditoria de Libs e Configs (adicionadas em 2026-04-24)

Ver análise completa em [[auditoria-libs-configs]].

| # | Item | Severidade | Sprint |
|---|---|---|---|
| L1 | Migrar SDK `@google/generative-ai` → `@google/genai` | 🔴 → ✅ Resolvido | Sprint 0 |
| L2 | URL backend hardcoded `localhost:4000` no frontend | 🔴 → ✅ Resolvido | Sprint 0 |
| L3 | Renomear ou consolidar `GEMINI_API_KEY` vs `NANO_BANANA_API_KEY` (mesmo provider, mesma model, dois keys sem razão clara) | 🟡 Médio | Sprint 0 |
| L5 | Remover import de `ffmpegVideo.ts` do bundle — dependência pesada morta | 🟡 Médio | Sprint 1 |
| L6 | Tipos `DesignState`/`Layer` duplicados entre frontend e backend — sem contrato compartilhado | 🟡 Médio | Sprint 2 |
| L7 | Verificar versão não-canônica do Next.js (aviso no AGENTS.md) | 🟡 Médio | Sprint 2 |
| L4 | Consolidar Gemini + OpenAI no Bot Gabi (dois LLMs para tarefas sobrepostas) | 🟡 Médio | Backlog |

### Dependências de Pacotes (npm)

```bash
# Backend — migração de SDK Gemini (L1 + T1)
npm uninstall @google/generative-ai
npm install @google/genai

# Frontend — export PNG já disponível via canvas.toDataURL() nativo
# Frontend — export PDF (Sprint 1, T10)
npm install html2canvas jspdf

# Frontend — garantir que ffmpegVideo.ts não está sendo importado no bundle (L5)
# (remover import, não o arquivo — feature prevista para Sprint 2)

# Backend — geração de imagem alternativa (opcional Sprint 2)
npm install @fal-ai/client
```

### Variáveis de Ambiente (novas ou alteradas)

| Variável | Onde | Uso | Status |
|---|---|---|---|
| `GEMINI_API_KEY` | Backend | Reutilizada para generate-image com novo SDK | Já existe |
| `NANO_BANANA_API_KEY` | Backend | Reutilizada na migração do Nano Banana | Já existe — renomear futuramente |
| `NEXT_PUBLIC_API_URL` | Frontend | URL base do backend (substitui localhost hardcoded — L2) | **Nova — Sprint 0** |
| `FAL_API_KEY` | Backend | Apenas se upgrade para FLUX (Sprint 2, opcional) | Nova — condicional |

**Decisão pendente:** onde armazenar as imagens geradas pela IA?
- Opção A: Retornar base64 direto ao frontend (sem storage, simples para MVP)
- Opção B: Upload para cloud storage (S3/GCS) e salvar URL no `Post.content`
- **Recomendação MVP:** Opção A (base64) → Opção B ao escalar

---

## Plano de Implementação por Sprint

### Sprint 0 — ✅ Concluído em 2026-04-25

> Pré-requisito para o MVP 3. Executado em 2026-04-24/25.

**Objetivo:** app estável, brand config funcionando, migração de modelo executada.

| Task | Arquivo(s) alvo | Esforço |
|---|---|---|
| T1 — Migrar Gemini 2.0 → 2.5 | `backend/src/lib/nanoBanana.ts`, `backend/src/routes/ai.ts` | 2–3h |
| T2+T3 — Save BrandConfig | `backend/src/routes/brands.ts` (novo `PUT /:slug/config`), `frontend/src/app/[marca]/configuracoes/branding/page.tsx`, `agent/page.tsx`, `referencias/page.tsx` | 4–6h |
| T4 — Criar nova marca | `frontend/src/app/` (handler no botão), `backend/src/routes/brands.ts` | 2–3h |
| T5 — Remover mock benchmark | `frontend/src/app/[marca]/configuracoes/referencias/page.tsx` → chamar `POST /api/ai/:slug/analyze-benchmark` | 2–3h |

**Critério de aceite do Sprint 0:**
- Gabi consegue configurar cores, fontes, guidelines e salvar — dados persistem no banco
- App não depende do Gemini 2.0 (deadline 01/06)
- Análise de benchmark chama o backend real

---

### Sprint 1 — MVP 3: Gerador de Imagens (20/05 → 16/06/2026)

> Entregável contratual do Mês 3. Gerador funcional em ambiente de testes.

**Objetivo:** Tool "Imagem" funcional ponta a ponta — prompt → imagem → layer no canvas → export.

| Task | Arquivo(s) alvo | Esforço |
|---|---|---|
| T6 — Endpoint generate-image | `backend/src/routes/ai.ts` (novo handler), `backend/src/lib/imageGenerator.ts` (novo) | 3–4h |
| T7 — Conectar tool Imagem | `frontend/src/app/[marca]/fabrica/page.tsx` (substituir stub) | 2–3h |
| T8 — Inserir como layer | `frontend/src/components/Editor/CanvasEditor.tsx` | 2–3h |
| T9 — Export PNG/JPEG | `frontend/src/components/Editor/CanvasEditor.tsx` (botão + `canvas.toDataURL()`) | 2h |
| T10 — Export PDF | `frontend/src/components/Editor/CanvasEditor.tsx` (html2canvas + jsPDF) | 3–4h |

**Fluxo completo do Sprint 1:**
```
Gabi na Fábrica
  → seleciona Tool "Imagem"
  → descreve: "crie um post de lançamento com as cores da marca"
  → POST /api/ai/:slug/generate-image
    → getBrandContext(slug)          ← usa BrandConfig salvo no Sprint 0
    → Gemini 2.5 Flash Image         ← retorna base64 da imagem
  → imagem inserida como layer no CanvasEditor
  → Gabi ajusta posição/tamanho no editor
  → clica "Exportar PNG" → download imediato
```

**Critério de aceite do Sprint 1:**
- Gabi descreve uma imagem → IA gera usando brand context → imagem aparece no canvas
- Botão de export baixa PNG com qualidade 1080×1080
- PDF exporta o layout completo com todas as layers

---

### Sprint 2 — MVP 4: Qualidade e Lançamento (17/06 → 14/07/2026)

> Validação final + polimento para lançamento oficial.

**Objetivo:** produto robusto, inteligente e com experiência de configuração fluida.

| Task | Arquivo(s) alvo | Esforço |
|---|---|---|
| T11 — Auth completo | `backend/src/middleware/auth.ts`, todas as rotas protegidas | 2–3h |
| T12 — Wizard onboarding | Nova página `frontend/src/app/onboarding/` com 4 passos: Marca → Visual → Tom de Voz → Preview | 6–8h |
| T13 — Toast de feedback | Componente `Toast` no design system, integrado em todos os saves | 2–3h |
| T14 — Avaliar FLUX | Teste qualitativo com a Gabi → integrar `@fal-ai/client` se aprovado | 4–6h (condicional) |
| T15 — Animação (se tempo) | `frontend/src/lib/ffmpegVideo.ts` + backend endpoint | 6–8h (condicional) |

**Critério de aceite do Sprint 2 (lançamento):**
- Gabi configura marca nova em < 10 min com wizard guiado
- Toda ação de save tem feedback visual (sucesso/erro)
- Todas as rotas exigem autenticação
- Design gerado é coerente com a identidade visual da Assinatura

---

## Cronograma Visual

```
Abril/2026         Maio/2026              Junho/2026              Julho/2026
|                  |                      |                       |
|-- Sprint 0 ✅ --|--- Sprint 1 (MVP 3) --|--- Sprint 2 (MVP 4) --|
24/04 → 25/04       05/05  →  16/06         17/06  →  14/07
Urgências           Gerador Imagens          Qualidade + Launch
```

> ⚠️ **Cronograma atualizado:** Sprint 0 foi concluído em 25/04/2026 (não em 19/05 como planejado originalmente). Sprint 1 pode iniciar a partir de 05/05/2026.

---

## Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Gemini 2.5 Flash Image com qualidade insuficiente para marca | Alto | Ter fal.ai FLUX como fallback já pesquisado e documentado |
| Armazenamento de imagens geradas escalar e encarecer | Médio | ~~Começar com base64~~ **Decisão tomada:** persistir no `Post.content` (PostgreSQL) — monitorar tamanho se imagens forem grandes |
| Wizard de onboarding complexo atrasar o MVP 4 | Médio | Pode ser simplificado para uma única página com scroll guiado no lugar de multi-step |
| Auth incompleta expor dados de outras marcas | Alto | Priorizar T11 (auth) no início do Sprint 2, não no fim |
| ffmpegVideo.ts para animações ser inviável no frontend | Baixo | Mover para server-side com Playwright se necessário; não é bloqueante para launch |

---

## Decisões Tomadas (2026-04-24)

| # | Decisão | Escolha | Impacto |
|---|---|---|---|
| D1 | Formato prioritário de export | **PNG** | Sprint 1 foca em `canvas.toDataURL('image/png')` — PDF fica fora do escopo do Sprint 1 |
| D2 | Armazenamento das imagens geradas | **Persistir no banco** | Imagem gerada → salvar como campo `imageUrl` (ou base64) dentro de `Post.content` no PostgreSQL |
| D3 | Validação de qualidade do modelo | **Após conexões e UI mínima prontas** | Não bloqueia Sprint 1 — validação com a Gabi acontece no Sprint 2 como parte do MVP 4 |

---

## Relacionados

- [[designer-auditoria-jornada]] — canvas visual de onde este plano deriva
- [[pesquisa-geracao-imagens-pdf-designer]] — opções técnicas detalhadas
- [[agente-designer]] — estado atual do código
- [[designer-backend]] — onde os novos endpoints vivem
- [[designer-frontend]] — CanvasEditor e Fábrica
- [[secretaria-ai-gabi]] — cronograma contratual
