# Plano de Consolidação — Designer IA

> **Data:** 2026-07-20 · **Branch de referência:** `feat/html-pptx-canva` · **Responsável:** Saleco
> **O que é este documento:** o plano único que junta a extinção dos motores legados, a
> unificação dos conectores, o Brand Kit (mídia + fontes) e a exportação editável pro Canva —
> mais os dois bugs concretos achados investigando o código ao vivo. Tudo abaixo foi
> **verificado no código**, não deduzido. Onde há hipótese, está marcado 🟡.

---

## 0. Tese: mídia, fontes e conectores são a MESMA feature com três máscaras

O Drive e o Asana **já baixam arquivos reais em base64** (`routes/google.ts:285`,
`routes/asana.ts:172`). A biblioteca de Mídia é uma tabela `Asset` **morta** (nada no pipeline
lê `prisma.asset`). A geração **não lê imagem nenhuma**. As fontes estão meio-ligadas. São
quatro faces de uma coisa só que falta: um **Brand Kit / pool de assets** — para onde imagens e
fontes entram (upload, Drive, Asana), ficam guardadas como assets da marca, e de onde a geração
puxa fontes de imagem reais. O Canva é o lado da **saída** do mesmo fluxo.

Por isso "cai como luva": não são quatro problemas, é um. Mas **antes** é preciso consolidar o
motor de geração — não dá pra fiar mídia/fontes em dois motores.

---

## 1. Estado atual verificado

### 1.1 Motores de design (existem três; o produto vivo usa um)

| Motor | Arquivos | Gera hoje? | Situação |
|---|---|---|---|
| **html-design** | `lib/htmlDesign.ts` | ✅ **Único** | `pipeline.ts` chama só `generateHtmlDesignBatched`, emite `kind:'html-design'` (`pipeline.ts:179,287,344`). O modelo escreve HTML/CSS direto. |
| **ir-design** | `lib/irDesign.ts`, `lib/designIR/*`, front `DesignIR/IRSlideView.tsx` | ⚠️ **Não** | `generateIRDesignProgressive` só é chamado por um teste (`__tests__/irPromptFormat.test.ts`). Sobrevive como render/edição de posts legados. Motor **zumbi**. |
| **DesignDocument** | `lib/designDocument.ts`, `lib/designToSvg.ts`, `lib/contrast.ts`, front `DesignDocument/DesignDocumentRenderer.tsx`, `lib/designDocument/*` | ❌ **Deletado** | Removido no working tree desta branch (ainda não commitado). |

**Fatos que provam a virada (e comentários mentirosos a corrigir):**
- Editor já migrado: `editor/[postId]/page.tsx:11` diz *"posts migrados para html-design em
  2026-07-18"* e trata IR como "formato legado". Só renderiza `html-design` via `HtmlSlideRenderer`.
- `renderableDeck.ts:8` **mente**: afirma que ir-design é "o formato principal gerado hoje".
- `designContent.ts:235` **mente**: afirma que "ir-design é hoje o único formato que o produto gera".

### 1.2 Conectores (compartilham a casca do Asana, divergiram em qualidade)

Os três copiaram a mesma casca (`auth-url` / `callback` / `status`) e divergiram. **O OAuth do
Canva é o mais robusto dos três** — o "podre" do Canva NÃO está no OAuth (ver §1.4).

| Conector | Token | State (CSRF) | Refresh | Veredito |
|---|---|---|---|---|
| **Asana** (`routes/asana.ts`) | **texto puro** (`asanaToken`) | `state = userId` cru | ❌ nenhum | Mais inseguro |
| **Google Drive** (`routes/google.ts`) | **texto puro** | `state = userId` cru | ✅ `getValidGoogleToken` (buffer 5 min) | Funciona, mas inseguro |
| **Canva** (`routes/canva.ts` + `lib/canvaClient.ts`) | **criptografado** (`encryptToken`) | nonce aleatório + expiração 10 min | ✅ `getValidAccessToken` + limpa tokens ao revogar | OAuth correto |

### 1.3 Como branding/mídia/benchmarking/fontes agem na geração HOJE

Resolvido em `lib/brandContext.ts` (`resolveBrandContext`, `buildBrandContextSummary`,
`buildBrandAssistantInstruction`).

- **Branding — cores/fontes/guidelines/logo:** vão **direto** ao objeto `brand` do
  `htmlDesign.ts:29-33` que escreve o CSS de cada slide. **Agem no pixel.**
- **Branding — `presentationConfig`** (vibe visual, ousadia, direção de paleta, preferência de
  fotos): chega ao **planner e ao reviewer** via texto, mas **NÃO** ao objeto `brand` do
  `htmlDesign.ts`. Só `autoMode` tem efeito real (liga revisão automática, `fabrica.ts:68`).
  → O designer mexe no slider de "ousadia" e não vê efeito no CSS.
- **Mídia:** biblioteca **morta**. `Asset` só é lido em `routes/assets.ts` e `routes/brands.ts`.
  Zero referência no pipeline. O designer sobe imagem e ela não entra em nada.
- **Benchmarking (Referências):** análise assíncrona real por Gemini extrai
  `archetype/toneOfVoice/density/palette/insightsText`, marca `status:'ANALYZED'`. Só ANALYZED
  (máx 8) entram no contexto — mas, como o `presentationConfig`, chegam ao planner/reviewer,
  não ao artista que escreve o CSS.
- **Fontes:** único dos quatro **aplicado no resultado visual** — vira `<link>` real do Google
  Fonts no HTML renderizado (`htmlDesign.ts:83-90,96-99`). Ressalva: o check estrutural de
  "fonte fora da paleta" só existe no reviewer **IR** (`reviewer/index.ts:357`) — motor que vamos
  deletar. O reviewer html-design ativo (visual) não tem esse check.

### 1.4 Cadastro de marca é raso por construção

`onboarding/page.tsx` coleta: nome, uma cor, uma fonte, e um textarea de diretrizes. A opção "IA"
gera diretrizes a partir de **setor/público/palavras-chave digitados** — não pesquisa a marca
real. Default: `#171717` + `Inter` + "Siga um tom profissional e moderno". A pesquisa web real
(`fabricaLegacy.ts:33` `researchBrand`, com Google Search grounding) roda em **cada geração**
(`pipeline.ts:122`) e é **descartada** — nunca vira conhecimento durável da marca. O
`extract-from-logo` e as Referências (pesquisa boa) estão fora do cadastro.

---

## 2. Bugs concretos achados (fora do plano de arquitetura)

### 🐛 BUG 1 — Export "HTML" é um ZIP com extensão `.html` → arquivo "ilegível"

**Sintoma:** o download do deck em HTML gera um "documento HTML enorme não-renderizável".
**Causa raiz (verificada com arquivo real `deck-21bb66a2.html`):** o arquivo é um **ZIP válido**
(começa com `PK`) contendo 50 arquivos `slide-01.html`…`slide-50.html`, cada um ~2KB e limpo. O
`exportarHtml` sempre empacotou num `ZipArchive` (`deckExport.ts:126`) e o MIME já é
`application/zip` (`deckExport.ts:43`). Mas o nome ganha a extensão errada:

```ts
// deckExport.ts:179 — ERRADO: usa a CHAVE do formato como extensão
const fileName = `${titulo}.${format}`;   // format 'html' → deck-xxx.html (mas os bytes são ZIP)
```

O usuário abre `deck-xxx.html`, o navegador tenta renderizar os bytes do ZIP como HTML → lixo.

**Correção (~2 linhas):** derivar a extensão de um mapa, não da chave do formato.
```ts
const EXT_BY_FORMAT: Record<DeckExportFormat,string> = { pdf:'pdf', zip:'zip', pptx:'pptx', html:'zip' };
const fileName = `${titulo}.${EXT_BY_FORMAT[format]}`;
```
Como `zip` (PNGs) e `html` (HTMLs) passariam a gerar dois `.zip`, nomear distinto:
`${titulo}-html.zip` vs `${titulo}-png.zip`. E renomear o rótulo do botão no `ArtifactPanel`
para "HTML (zip)". **Isolado e seguro — não depende do resto do plano.**

**Descartado:** as hipóteses de base64 inline e SVG gigante **não eram o caso** (slides têm 2KB).
Não criar guarda de base64/SVG por conta deste sintoma.

### 🐛 BUG 2 — "Exportar para Canva" manda PNG chapado, não monta apresentação editável

**Sintoma (relatado pelo dono):** o botão não envia HTML/fotos pro Canva montar a apresentação.
**Causa (verificada):** o fluxo é PNG → asset → `createDesign({asset_id})` → `createDesignMerge`
(`canvaClient.ts`). Resultado: fotos, não design editável. Texto vira pixel.
**Fato decisivo (Canva Connect API, verificado em canva.dev):** a Design Import API **não aceita
HTML** — aceita PPTX, DOCX, PDF, Keynote, XLSX, AI, PSD, ODP. O "importar HTML" do Canva é
recurso **manual da UI**, não automatizável via API. Logo, mandar HTML não resolve.
**Correção = caminho PPTX** (ver Fase 4). O gerador de PPTX **já existe**: `lib/htmlToPptx.ts`
("scan de DOM → elementos nativos, texto continua texto", `deckExport.ts:172`).

---

## 3. Plano por fases

Ordem de dependência: **0 → 1 → 2 → 3**, com **4** em paralelo depois da 1.
Os dois bugs do §2 são **quick wins** independentes (podem ir antes de tudo).

### Fase 0 — Extinguir os motores legados (pré-requisito de tudo)

Objetivo: **um motor só** (html-design), sem código morto reutilizável.

- [ ] **DesignDocument:** finalizar a remoção já iniciada. Varrer órfãos —
  `components/DesignDocument/IRSlideRenderer.tsx`, e a pasta `components/DesignDocument/` (hoje só
  guarda o `HtmlSlideRenderer` vivo → **renomear** a pasta, o nome ficou mentiroso). Commitar.
- [ ] **IR:** deletar `lib/irDesign.ts`, `lib/designIR/*`, `components/DesignIR/IRSlideView.tsx`,
  os guards de IR em `lib/designContent.ts`, o ramo IR em `lib/renderableDeck.ts`, e o teste
  `__tests__/irPromptFormat.test.ts`.
- [ ] **Corrigir os comentários mentirosos:** `renderableDeck.ts:8` e `designContent.ts:235`.
- [ ] **⚠️ Antes de deletar o compilador IR:** checar no banco se sobrou `kind:'ir-design'` (o
  compiler é o que renderiza posts legados). Se sobrou → script one-shot IR→html-design, ou
  aceitar que viram read-only. 🟡 O comentário do editor sugere que a migração de 18/07 já rodou.
- [ ] **Guard-rail:** teste/lint que **falha se `ir-design` ou `design-document` reaparecerem** —
  é isso que cumpre o "não reutilizar".

**Pronto quando:** build + testes verdes sem `irDesign`/`designDocument`; galeria e editor
funcionam; nenhum motor além do html-design no código.

### Fase 1 — Núcleo único de conector

Objetivo: parar de repetir o Asana divergindo; subir Asana e Drive ao nível de segurança do Canva.

- [ ] Extrair `lib/connectorOAuth.ts`: handshake genérico + **cofre de token criptografado**
  (reusar `lib/tokenCrypto.ts`) + **auto-refresh** + **state seguro** (nonce + expiração, não
  `userId` cru).
- [ ] Migrar **Asana** para o núcleo: criptografar `asanaToken`, state seguro, adicionar refresh.
- [ ] Migrar **Drive** para o núcleo: criptografar tokens, state seguro (mantém o refresh que já tem).
- [ ] Encaixar **Canva** no mesmo núcleo (já é o mais próximo; consolidar, não reescrever).

**Pronto quando:** os três conectores usam um só core; tokens criptografados; state seguro nos três.

### Fase 2 — Brand Kit / pool de assets (mídia + fontes)

Objetivo: dar corpo à Mídia e às Fontes; o kit nasce cheio no cadastro.

- [ ] `Asset` deixa de ser tabela morta → **pool de assets da marca**. Entradas: upload manual +
  **"importar do Drive"** + **"importar anexo do Asana"** (reaproveita o base64 que os conectores
  já baixam — botão, não feature nova).
- [ ] **Fontes entram no kit:** além do nome em `primaryFonts`, permitir upload de fonte custom
  (arquivo) ou escolher Google Font, guardado como parte do kit.
- [ ] **Auto-popular no cadastro** (resolve a pesquisa rasa): pedir **site + @instagram + logo** no
  onboarding; encadear logo→`extract-from-logo`→paleta/fonte, site/IG→`researchBrand`
  **persistido**→Referências. Apresentar como **rascunho que o designer confirma** (não verdade
  silenciosa — a pesquisa IA também pode errar).
- [ ] **Indicador de "força da marca"** no cadastro + aviso na Fábrica quando o contexto é raso.

**Pronto quando:** um asset importado do Drive/Asana aparece no pool; fonte custom sobe; um cadastro
novo com URL+logo nasce com paleta, fontes e referências preenchidas.

### Fase 3 — Ligar config na geração (o #1/#2/#3, agora sobre 1 motor)

Objetivo: o que o designer configura **age no pixel**.

- [ ] **Assets como imagem real:** passar as URLs dos assets da marca (logo primeiro) ao objeto
  `brand` do `htmlDesign.ts`; instruir o artista a usá-los em vez de inventar. Acaba a
  troca-de-logo-na-mão. Reviewer ganha check "usou o logo real?".
- [ ] **`presentationConfig` chega ao artista:** adicionar vibe/ousadia/paleta/fotos ao objeto
  `brand` do `htmlDesign.ts` (hoje só vão ao planner/reviewer). É threading, não feature nova.
- [ ] **Check de fonte fora da paleta no reviewer html-design** (o que só existia no IR morto).

**Pronto quando:** mudar "ousadia"/paleta no branding muda visivelmente o deck gerado; o logo real
aparece nos slides sem intervenção; fonte fora da marca é sinalizada.

### Fase 4 — Canva como saída editável (resolve o BUG 2)

Objetivo: o botão "Exportar para Canva" entregar **design editável**, não fotos.

- [ ] Religar o botão: **gerar PPTX** (`htmlToPptx.ts`, já existe) → subir no R2 (URL pública) →
  `POST /url-imports` com mime PPTX → poll `GET /url-imports/{jobId}` → devolver `edit_url`.
- [ ] Garantir que `htmlDocsToPptx` **embute as imagens** (`<img>` por URL → imagem no PPTX). 🟡 verificar.
- [ ] Aposentar / enxugar o caminho PNG (`asset→design→merge`) e o sprawl do `canvaSync`
  (fetch/toggle/cron) se não entregar valor.
- [ ] Expor a escolha ao usuário: PNG (fiel, não editável) × PPTX→Canva (editável, perde efeitos).

**Ressalva de fidelidade:** PPTX de HTML/CSS livre pode perder gradientes/sombras/posição
absoluta/fonte do Google. Texto continua texto. É trade-off de produto (editabilidade × fidelidade).

**Pronto quando:** clicar "Exportar para Canva" abre no Canva um design com texto editável.

---

## 4. Quick wins (independentes — podem ir já)

- [ ] **BUG 1** — extensão do export HTML (`deckExport.ts:179`) → ~2 linhas.
- [ ] Corrigir os dois comentários mentirosos (`renderableDeck.ts:8`, `designContent.ts:235`) —
  pode antecipar da Fase 0.

---

## 5. O que NÃO é o problema (para não reinvestigar)

- O empacotamento do export HTML **não** gera documento gigante — os slides têm ~2KB. Era só a
  extensão errada (BUG 1).
- Base64 inline / SVG gigante **não** foram a causa do "arquivo ilegível".
- O OAuth do Canva **não** é o "podre" — é o mais robusto dos três. O problema do Canva é o
  deliverable (PNG chapado, BUG 2).
- Mandar **HTML** pro Canva **não** funciona via API — o caminho editável é PPTX.

---

## 6. Pontos frágeis conhecidos

Base de evidência de cada item: ✅ verificado no código nesta sessão · 🟡 vem da memória de
sessões anteriores, **não re-verificado** (confirmar ao vivo antes de agir).

### No escopo direto deste plano

1. **✅ Fallback silencioso — CONFIRMADO no html-design (verificado ao vivo).**
   `buildFallbackSlide` (`htmlDesign.ts:577`) gera um slide "retângulo + título". Quando um lote
   falha após os retries, `processFallbackBatch` preenche o **lote inteiro** com fallback
   (`htmlDesign.ts:621` no lote 1, `:637` nos paralelos); lote curto também é completado com
   fallback (`:596`). A **única guarda** é `realCount === 0` → marca FAILED (`:645`). Consequência:
   um deck com, ex., **24 de 50 slides de fallback é entregue READY, sem aviso ao usuário**. O
   marcador de classe `-fallback-` existe para o reviewer sinalizar (`:576`, `:583`), mas **não há
   evidência de que o reviewer html-design ou o usuário sejam avisados**. Não morre com o IR — é do
   motor que fica.
   → **Escopo:** Fase 3. **Correção sugerida:** contar fallbacks e (a) avisar o usuário na UI,
   (b) alimentar o reviewer com essa info, (c) política de teto (ex.: `> X%` fallback → FAILED ou
   re-tentar o lote), não só o "tudo-ou-nada" atual.

2. **✅ base64 sem backstop no código.** A proibição de `data:`/base64 é **só no prompt**
   (`htmlDesign.ts:175`); `validateHtmlDesign` e `sanitizeSlideHtml` **não** removem `data:` URI
   nem impõem teto de tamanho. Não foi a causa do BUG 1, mas segue latente — o próprio prompt diz
   que base64 "quebra a geração".
   → **Escopo:** Fase 3. **Correção:** filtrar `data:` em imagens e impor teto de tamanho de
   `html`/`css` na validação de slide.

3. **✅ Migrations do Canva — estado de deploy.** Há migrations novas no working tree não commitadas
   (`prisma/migrations/…_add_canva_sync_fields`, `…_add_canva_oauth_state_at`). A Fase 1 mexe em
   conector; se o ambiente estiver dessincronizado do schema, quebra.
   → **Escopo:** pré-requisito da Fase 1. **Ação:** conferir `migrate status` no ambiente antes.

4. **✅ Branch inteira não commitada.** ~57 arquivos no working tree (inclui a remoção do
   DesignDocument e a migração do Canva por-usuário) **não commitados nem revisados**. Risco de
   perda e de a Fase 0 partir de base instável.
   → **Escopo:** pré-requisito de tudo. **Ação:** commitar/revisar a branch antes de abrir a Fase 0.

### Qualidade / escala / resiliência (tangenciais à consolidação, mas são pontos frágeis)

5. **🟡 Reviewer visual amostra poucos slides (~8, espalhados).** Deck grande passa quase todo sem
   revisão real. Da memória — confirmar cobertura atual antes de agir.

6. **🟡 Escala p/ ~200 slides.** Pontos pendentes citados na memória (amostragem do reviewer, chave
   de design no Redis). Confirmar o que já foi resolvido (a sessão foi fatiada em 3 keys em 07-13).

7. **🟡 Resiliência do Gemini.** 429 de créditos e "modelo lento" (responde em ~70s sem erro) já
   derrubaram gerações antes. Há tratamento (`lib/geminiRetry.ts`), mas é histórico que reincide —
   monitorar, não assumir resolvido.
