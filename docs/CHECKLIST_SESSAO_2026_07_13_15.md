# Checklist — retomada (sessão de 2026-07-13)

> **Estado:** tudo no working tree da branch `fix/designer-generation-bugs`. **Nada commitado.**
> Backend: 113 testes ✅ · Typecheck ✅ nos dois · Lint ✅
> ⚠️ **Boa parte disso ainda NÃO foi verificada no app rodando.** Ver o bloqueio abaixo.

---

## 🔁 Revisão de 2026-07-15 (o que mudou desde 07-13)

- 🔴 **A premissa do bloqueio caiu.** Em 07-13 dizíamos "o Gemini está saudável, o erro é
  mentira". **Não é mais verdade:** a conta do Gemini está **SEM CRÉDITOS** (429 real,
  reconfirmado ao vivo em 07-15). A mensagem *"falha temporária na IA"* **agora é verdade**.
  Enquanto a conta estiver seca, NADA gera — e o bug de escala dos 30 slides fica
  inverificável. **Destravar crédito é a prioridade nº 1**, acima de qualquer item aqui.
- ✅ **`presentation50.test.ts` não suja mais o `tsc`** — `tsc --noEmit` sai limpo (exit 0).
- ✅ **Lixo tmp removido** (`capture.tmp.ts`, `seed5.tmp.ts`, `generate_30_slides.ts`,
  `generate_3_slides.ts`, `read_session.ts`, `backend.log`).
- ➕ **Nova frente entregue (não estava no plano de 07-13):** transparência de gasto de IA —
  widget "IA hoje" na Fábrica/Galeria + aba **Configurações → Gastos de IA** (billing por
  modelo, gasto e impostos separados). Rotas `GET /brands/:slug/ai-usage` (estendida) e
  `/ai-usage/billing`. Verificado o caminho de leitura contra o Redis real (retorna vazio
  porque não há gasto — Gemini seco). Env knobs: `AI_MODEL_PRICES`, `AI_USD_TO_BRL`,
  `AI_TAX_RATE`.
- ⚠️ **Dois dias depois, segue TUDO não-commitado** e a superfície só cresceu (billing por
  cima). É o maior risco de processo: commitar antes que fique impossível de revisar.

---

## 🔴 BLOQUEIO — congelado até haver crédito no Gemini

> **Atualização 07-15:** a causa aparente NÃO é mais "código nosso" — é a conta sem crédito.
> Todo o texto abaixo vale para quando o crédito voltar; até lá, não há o que diagnosticar.

Decks de **30 slides falham em série**; um de 8 passou (observado em 07-13, **antes** de a
conta secar). Quando houver crédito de novo, refazer o teste e ler a causa real:

```
[error] Erro no DesignDocument · error=<A CAUSA REAL>     ← pipeline.ts:372
```

- [ ] **Pré-requisito de diagnóstico:** o log em `pipeline.ts:372` hoje só imprime
      `error.message` — sem stack, sem `postId`, sem contagem de slides. **Enriquecer esse
      log ANTES** do próximo teste, senão a causa escapa de novo.
- [ ] Reiniciar o backend com stdout em arquivo e gerar UM deck de ~30 slides.
- [ ] Só depois de ler o erro, decidir o conserto.

**Suspeito nº 1: nós mesmos.** As mudanças no `geminiRetry.ts` (tiers de modelo) e o
`aiThrottle.ts` (semáforo AIMD) mexem em paralelismo/escala — onde os decks grandes
quebram. Se o log apontar para lá, considerar reverter `aiThrottle` e reavaliar.

> ⚠️ Nada de diagnóstico por dedução: já erramos afirmando "duplo disparo" olhando
> timestamps (posts que falham não gravam `sessionId`, então não dá para agrupá-los).

---

## ✅ O que foi feito (mas NÃO verificado no app)

### 1. Fallback cirúrgico do Gemini
- `lib/geminiRetry.ts` — **429 ≠ 503**. O 429 é a nossa própria paralelização estourando
  a cota: espera e **insiste no mesmo modelo**, honra o `retryDelay` do provedor, usa
  jitter total, e **não** alimenta o circuit breaker. Só 503/timeout trocam de modelo.
- **Tiers estéticos**: uma chamada nunca cruza de tier. `artista` (3.1-pro → 3-pro →
  2.5-pro) nunca cai num flash — antes, um 429 fazia metade do deck sair com outra mão.
- `lib/aiThrottle.ts` (novo) — semáforo AIMD por modelo (corta pela metade no 429, sobe
  +1 a cada 5 sucessos). **É o principal suspeito do bloqueio acima.**

### 2. Pastas na Fábrica
- A pasta escolhida vive na **sessão** (`redis.ts`), e o `pipeline.ts` carimba o
  `folderId` no `post.create`. Nova rota `PATCH /fabrica/sessions/:id/folder`.
- `components/Fabrica/FolderPicker.tsx` (novo) — "Salvar em: ▾" acima do input.
- [ ] **Ainda NÃO verificado (07-15):** a fiação existe (`fabrica.ts:82` PATCH de folder +
      carimbo `folderId` no `pipeline.ts`), mas o e2e nunca rodou — `folderId=—` em todos os
      posts do banco na última checagem. **Inverificável agora** (geração bloqueada pelo 429);
      testar de ponta a ponta assim que houver crédito.

### 3. F0 — o `[EDIT]` do chat da Fábrica (estava MORTO)
A IA prometia *"vou ajustar o slide 2"* e **nada acontecia, em silêncio**: o
`applySlideEdits` exigia `kind === 'html-design'`, mas o pipeline só produz `ir-design`.
- `lib/designIR/patcher.ts` (novo) — o `applyPatch` só existia no frontend; o chat não
  tem canvas do outro lado, então precisava de um patcher no servidor.
- `lib/designIR/aiPatch.ts` (novo) — motor único (`generateIRPatchForSlide`) partilhado
  pela rota `ai-patch` do editor e pelo brain.
- Fonte de verdade virou o **Post**, não o `session.currentDesign` (o Redis expira).
- O `return` silencioso morreu: agora há *editou* / *sem-arte* / *falhou*, e no caso de
  falha a IA **diz** que não conseguiu — e nunca regenera o deck por conta própria.

### 4. F1 — um renderizador de IR só
Havia três (editor, preview da Fábrica, compilador do backend) e **só o compilador era
fiel**. "Adiciona uma sombra no título" era gravado no IR, saía no PNG e **não aparecia
na tela**.
- `frontend/src/lib/designIR/style.ts` + `components/DesignIR/IRSlideView.tsx` (novos).
- `IRCanvasEditor` desenha por ele e põe a seleção como **overlay** (não injeta mais
  estilo nos elementos). `IRSlideRenderer` idem.

### 5. Mensagens honestas
- `humanizeGeminiError` só culpa a IA quando o erro é de fato 429/503/timeout. Qualquer
  outra coisa agora diz *"Falha na geração: <erro real>. Isto NÃO é instabilidade da IA"*.
- `designContent.ts` — `extractChatHistory`/`extractSessionId` passaram a reconhecer
  `ir-design`. Retroativo: os decks já gerados voltam a mostrar o histórico da conversa e
  o link "Abrir sessão" na galeria.

---

## Checklist de verificação (rodando o app de verdade)

Nada abaixo é pego por typecheck ou teste unitário — os bugs de hoje **passavam nos dois**.

- [ ] **Bloqueio:** ler o `Erro no DesignDocument` de um deck de 30 slides.
- [ ] Gerar deck curto → deve terminar `READY`.
- [ ] **F0:** no chat, *"deixa o título do slide 2 maior e o fundo mais escuro"* → tem de
      mudar **ao vivo** no preview (o `useFabricaWs` já acumula `design:slide` por índice),
      persistir no banco, e criar versão *"Antes da IA…"*.
- [ ] **F0 (honestidade):** pedir algo impossível → mensagem honesta, deck **intacto**,
      e **sem regenerar** por conta própria.
- [ ] **F1:** *"adiciona uma sombra suave no título"* → tem de **aparecer no canvas** e
      bater com o PNG do `GET /posts/:id/export`.
- [ ] **Pastas:** criar pasta na Fábrica, gerar, e conferir `folderId` preenchido no banco.
- [ ] Conferir que não há mais erro de hidratação no console da Fábrica.

## Limpeza pendente

- [x] ~~`presentation50.test.ts` com 2 erros de typecheck pré-existentes~~ — **resolvido
      (07-15):** `tsc --noEmit` sai limpo.
- [x] ~~Lixo não-rastreado (`capture.tmp.ts`, `seed5.tmp.ts`, `generate_30_slides.ts` etc.)~~
      — **removido (07-15).**
- [ ] **Bug pré-existente não corrigido** (decisão do Gustavo pendente, **ainda aberto em
      07-15**): chamadas em `routes/ai.ts` passam `model: 'gemini-2.5-flash-lite'` nos params
      mas **não** o `preferredModel` — e o `withTimeout` sobrescreve o `params.model`. Essas
      rotas nunca rodaram no flash-lite: rodam no `gemini-3.5-flash` (o modelo lento).
      Corrigir muda o modelo em ~10 lugares.
- [ ] **Commitar o working tree.** Tudo (07-13 + billing de 07-15) segue não-commitado na
      `fix/designer-generation-bugs`. Quanto mais espera, mais impossível fica o review.

## Roadmap (F2→F5, do plano aprovado)

Plano completo em `C:\Users\gusta\.claude\plans\fa-a-um-planejamento-n-concurrent-yao.md`.

- **F2 — chat no editor.** É o que "vira o Claude design": `AIChatPanel` no lugar da
  `AIEditBar` (que é caixa única, sem histórico), thread persistida, chips de seleção
  ("Slide 3 · 2 elementos"). Decisão já tomada: **o chat vai para o Editor**, não o canvas
  para a Fábrica (o Editor já tem canvas/seleção/undo/versões; a Fábrica só tem o chat).
- **F3 — confiança.** Diff das ops aplicadas, barra Aceitar/Desfazer, checkpoint por
  mensagem. ⚠️ `MAX_VERSIONS_PER_POST = 20` sem debounce para `source:'AI'`: 20 mensagens
  de chat expulsam as versões manuais do usuário.
- **F4 — escopo multi-slide.** Migrar o payload do brain de `index` para `slideId`.
- **F5 — unificação + review loop.** `review:approve` hoje é **no-op** e `review:decline`
  **regenera tudo** com um brief pobre. Com o `[EDIT]` vivo, `decline` deve virar um
  `[EDIT]` multi-slide a partir dos `deviations` do reviewer (`pipeline.ts:351` já os
  entrega com `slideIndex` e `fix` — é um payload de `edits` pronto).
