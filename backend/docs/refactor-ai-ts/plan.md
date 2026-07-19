# Plano de refatoração — `routes/ai.ts` → módulo de feature com camada de serviço

> **Status:** preparado, aguardando sinal verde para execução
> **Autor:** Claude Code · **Data:** 2026-07-19
> **Branch atual:** `feat/html-pptx-canva` · **Suíte:** 184/184 verde · `tsc` limpo

---

## 1. Objetivo e definição de pronto

Transformar o god-file `routes/ai.ts` (**2.517 linhas**) num módulo de feature com **camada de serviço**: os handlers HTTP ficam finos (validar → autorizar → chamar service → responder/stream), e a lógica de negócio (pipeline de geração, edição, branding) vive em módulos testáveis fora do transporte.

**Pronto quando:**
- `routes/ai.ts` só contém registro de rotas + wiring fino (meta: < 500 linhas).
- Toda lógica de geração/edição está em `services/` (ou `lib/`), importável e testável sem subir o Express.
- O job store in-memory de geração vira um módulo próprio (passo para o EventBus `job:{id}`).
- `tsc` limpo, suíte verde, e o fluxo de geração validado ponta a ponta (não só testes).
- Zero mudança de contrato HTTP observável pelo frontend.

**Fora de escopo (fica para depois):** rotear os eventos de job pelo EventBus (multi-réplica da geração), deletar formatos/pipelines zumbis. Este plano só reorganiza; não muda comportamento.

---

## 2. Anatomia atual (o que existe hoje)

### 2.1 Endpoints (18) e responsabilidade

| Rota | Método | Concern |
|---|---|---|
| `/jobs/:jobId`, `/jobs/:jobId/stream` | GET | Job store de geração (SSE) |
| `/:slug/chat` | POST | Branding assistant |
| `/:slug/analyze-benchmark` | POST | Branding / referências |
| `/:slug/generate-briefing` | POST | Branding |
| `/:slug/generate-design-document` | POST | Design document |
| `/:slug/generate-design` (~245 ln) | POST | Pipeline nanoBanana (legado) |
| `/:slug/extract-from-logo` | POST | Branding |
| `/:slug/generate-image` (~180 ln) | POST | Geração de imagem IA |
| `/:slug/create-job` (83 ln) | POST | Geração (job recuperável) |
| `/:slug/create` (107 ln) | POST | Geração (SSE direto) |
| `/:slug/search-design-references` | POST | Branding / referências |
| `/:slug/patch-design` (~232 ln) | POST | Edição de design (IR/HTML) |
| `/:slug/fix-design-job`, `/fix-jobs/*` (4 rotas) | POST/GET | Fix pipeline (job store próprio) |
| `/:slug/fix-design` | POST | Fix pipeline (SSE) |

### 2.2 Lógica de negócio já isolada em funções (candidatas diretas a service)

Estas **já são unidades coesas** — só estão fisicamente no arquivo de rotas:

| Função | Linha | Destino proposto |
|---|---|---|
| `consultDesign` | 1303 | `services/designGeneration.ts` |
| `researchBrand` | 1352 | `services/designGeneration.ts` |
| `createHybridDesign` | 1423 | `services/designGeneration.ts` |
| `createDesign` | 1543 | `services/designGeneration.ts` |
| `resolveCreatePayload` | 1844 | `services/designGeneration.ts` |
| `generateTextLayers` | 126 | `services/designGeneration.ts` |
| `generateImageAssetForSlide` | 1179 | `services/imageGeneration.ts` |
| `runFixJob` | 2349 | `services/fixPipeline.ts` |

### 2.3 Estado in-memory (mover para módulo próprio)

`GenerationJob` (type, 35) + `jobStore` Map (48) + `createGenerationJob` (51), `getGenerationJob` (65), `broadcastGenerationEvent` (72), `addGenerationSseClient` (80), `completeGenerationJob` (96), `failGenerationJob` (107) → **`lib/generationJobStore.ts`** (nome reaproveitado; o antigo foi removido no EventBus). É o último dos Maps in-memory de job; extraí-lo aqui prepara o terreno para depois pendurá-lo no canal `job:{id}` do EventBus.

### 2.4 Helpers utilitários — **duplicação confirmada**

`ai.ts` tem cópias próprias de funções que **já existem** em `lib/generationUtils.ts`:

| Em `ai.ts` | Em `lib/generationUtils.ts` |
|---|---|
| `deduplicateLayerIds` (263) | ✅ já exportada |
| `ensureTextContrast` (302) | ✅ já exportada |
| `finalizeSlideContrast` (328) | ✅ já exportada |
| `normalizeHex` (273), `luminance` (284), `contrastRatio` (294) | ❌ (mover junto) |

→ **Fase 0**: deletar as cópias e importar de `generationUtils`. Risco quase zero, reduz o arquivo, valida o fluxo de commit/gate antes das fases pesadas. **Verificado em 2026-07-19**: `deduplicateLayerIds`, `ensureTextContrast` e `finalizeSlideContrast` são **byte-idênticas** entre `ai.ts` e `generationUtils.ts` — extração segura, sem reconciliação necessária. Falta mover `normalizeHex`/`luminance`/`contrastRatio` junto.

### 2.5 Acoplamento

19 imports, 9 de `lib/`/`agents/` (prisma, nanoBanana, designFixer, fixJobStore, imageNormalizer, geminiRetry, designDocument, brandContext, planner). Baixo acoplamento com o resto das rotas — a extração não toca outros routers.

---

## 3. A problemática (por que custa caro hoje)

1. **Sem camada de serviço:** a lógica de negócio mora dentro de handlers HTTP. Testar a geração exige subir o Express e mockar req/res; reusar em outro contexto (worker, script) é impossível sem arrastar o transporte junto.
2. **God-file:** 2.517 linhas num arquivo tornam qualquer navegação/alteração cara e arriscada (merge conflicts, blast radius). 4 de 6 arquitetos apontaram `ai.ts` como o epicentro do risco estrutural.
3. **Estado escondido:** o `jobStore` in-memory é o último bloqueio para a geração rodar em 2ª réplica.

---

## 4. Estrutura-alvo

```
routes/ai.ts                    ← só rotas + wiring fino (< 500 ln)
services/
  designGeneration.ts           ← consult/research/createHybrid/createDesign/resolvePayload/textLayers
  imageGeneration.ts            ← generateImageAssetForSlide + helpers de imagem
  fixPipeline.ts                ← runFixJob + orquestração do fix
lib/
  generationJobStore.ts         ← GenerationJob + jobStore + SSE helpers (novo)
  generationUtils.ts            ← + normalizeHex/luminance/contrastRatio (já tem os outros 3)
```

Handlers viram: `parseBody(schema) → (authz via aiRouter.param já existente) → service.fn(...) → stream/json`.

---

## 5. Fases incrementais (cada uma: mover → `tsc` → suíte → commit)

| Fase | O que move | Rede de segurança | Risco |
|---|---|---|---|
| **0** | Deletar helpers duplicados, importar de `generationUtils` (+ mover normalizeHex/luminance/contrastRatio) | Teste existente `designDocumentTokens`; diff byte-a-byte antes | 🟢 mínimo |
| **1** | `generationJobStore.ts` (job store + SSE) | Teste novo de smoke do job store (create→broadcast→get) | 🟢 baixo |
| **2** | `services/imageGeneration.ts` | Caracterização de `generateImageAssetForSlide` (mock Gemini) | 🟡 médio |
| **3** | `services/designGeneration.ts` (o núcleo) | **Testes de caracterização antes de mover** (ver §6) | 🟠 alto |
| **4** | `services/fixPipeline.ts` | Smoke do fix job + `fixJobStore` já testável | 🟡 médio |
| **5** | Adelgaçar handlers restantes (branding: chat, benchmark, briefing, logo, search-refs) | Contrato HTTP inalterado; verificação e2e | 🟡 médio |

Cada fase é um commit atômico e reversível. Parar entre fases é seguro.

---

## 6. Rede de testes — **pré-requisito da Fase 3**

**Este é o maior risco do projeto:** os fluxos de geração (`createDesign`, `createHybridDesign`, `patch-design`) **não têm testes de handler hoje**. Cobertura atual que toca ai: `aiCreateValidation` (só validação), `designDocumentTokens`, `designToSvgEscape`, `brandAccess`. Refatorar código sem teste comportamental é onde regressões nascem.

**Antes de mover o núcleo (Fase 3), adicionar testes de caracterização** que travem o comportamento atual:
- `createDesign` / `createHybridDesign`: dado um brief + brand mockada + Gemini mockado (respostas fixas), asserir a sequência de eventos `send()` emitida e o `postId`/content resultante.
- `resolveCreatePayload`: já coberto parcialmente por `aiCreateValidation`; estender para os caminhos de normalização (assets, chatHistory, dimensões).
- `patch-design`: asserir o mapeamento deviations→edits (reusar o padrão de `reviewEdits.test.ts`).

Esses testes são escritos contra a implementação **atual** (verde antes de mover), e devem continuar verdes **sem alteração** depois da extração — é isso que prova que a refatoração preservou o comportamento.

---

## 7. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Regressão silenciosa no pipeline (sem teste) | Testes de caracterização na Fase 3 (§6) + verificação e2e |
| SSE/streaming quebrar (ordem de eventos, `res.end`) | Manter a assinatura `send: (e) => void` idêntica; smoke test de stream |
| Import circular (service ↔ jobStore ↔ eventBus) | jobStore não importa services; services recebem `send` por parâmetro |
| Merge conflict com trabalho paralelo do Lucas | Fases pequenas e commitadas; sincronizar antes de começar |
| Divergência das cópias duplicadas (Fase 0) | Diff byte-a-byte; se divergiu, reconciliar e testar antes de deletar |

---

## 8. Checklist de preparação (antes de codar a Fase 1+)

- [ ] Confirmar sinal verde do Gustavo (refatoração de caminho quente, decisão dele)
- [ ] Sincronizar branch com qualquer trabalho pendente do Lucas em `backend/`
- [ ] Fase 0 executada e commitada (duplicados eliminados) — pode ir já, risco mínimo
- [ ] Testes de caracterização do núcleo escritos e verdes (pré-requisito da Fase 3)
- [ ] Definir se `services/` é a pasta canônica (novo diretório) ou se fica em `lib/` — decisão de convenção do repo

---

## 9. Estimativa

2–3 dias de trabalho focado. Fase 0+1 num dia (baixo risco); Fase 3 (núcleo + testes de caracterização) é o grosso; Fases 4–5 fecham. Nota esperada ao final: backend **~8,0**, arquitetura sobe ao destravar o caminho para multi-réplica da geração.
