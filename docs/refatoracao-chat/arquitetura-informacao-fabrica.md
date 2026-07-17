# Arquitetura de Informação — Chat da Fábrica (`/[marca]/fabrica`)

> Documento de planejamento de IA/UX para a refatoração do chat REAL da Fábrica.
> Escopo: `frontend/src/app/[marca]/fabrica/page.tsx` + `fabrica.module.css`.
> Baseado no contrato `docs/refatoracao-chat/contrato-fabrica-page.md` e na leitura do `page.tsx` atual (850 linhas).
> Dono deste arquivo: **Doc_IA_Fabrica**. Este documento é normativo para UI_CSS_Fabrica e UX_FabricaTSX.

---

## 1. Visão geral da tela

### 1.1 Estrutura macro: 2 colunas

A página é um painel de trabalho de tela cheia (`100dvh`, `overflow: hidden` na raiz), dividida em duas regiões funcionais:

| Região | Elemento | Função | Largura (desktop) |
|---|---|---|---|
| Esquerda | `<aside class="chatPanel">` | Conversa com o agente, entrada de dados, contexto | Fluida: `clamp(340px, 38vw, 460px)` (hoje fixa em 400px) |
| Direita | `<main class="previewPanel">` | Preview do design em tempo real, navegação de slides | Ocupa o restante (`flex: 1`) |

A relação entre as colunas é de **comando → resultado**: o usuário conversa à esquerda e vê o artefato nascer à direita. O painel de chat é um painel lateral de largura controlada, não uma coluna de leitura centralizada (ver seção 7).

### 1.2 Anatomia vertical do painel de chat (de cima para baixo)

| Ordem | Região | Classes | Conteúdo |
|---|---|---|---|
| 1 | Header | `chatHeader`, `chatHeaderLeft`, `chatHeaderRight` (nova) | Título da marca (`chatTitle`), pill de fase (`chatPhase`), `AiSpendBadge`, botão Nova (`newConvBtn`, nova), badge de conexão (`connectionBadge`) |
| 2 | Thread | `thread` | Fluxo de mensagens com **scroll independente** (única região rolável do painel); contém empty state, mensagens, typing, pergunta ativa e barra de progresso |
| 3 | Pills de contexto | `btwStrip`, `btwPill`, `asanaPill` | Contexto acumulado `/btw` e injeções do Asana, removíveis; só aparece quando há contexto |
| 4 | Strip de anexo | `attachStrip` | Arquivo anexado (imagem/PDF) com botão de remover; só aparece quando há anexo |
| 5 | Input bar | `inputWrap`, `inputBar`, `iconBtn`, `inputField`, `sendBtn` | Botão anexar (Paperclip) + textarea auto-redimensionável + botão enviar; `slashMenu` flutua acima quando ativo; `FolderPicker` fica dentro de `inputWrap`, acima da barra |
| 6 | Hint | `inputHint` | Linha de ajuda: atalhos de teclado ou hint de permissão |

O header, as pills, o strip de anexo, a input bar e o hint **não rolam**: são `flex-shrink: 0`. Apenas a `thread` tem `overflow-y: auto`, o que mantém o campo de entrada sempre visível — requisito crítico de usabilidade para um chat de produção.

### 1.3 Diagrama ASCII (desktop)

```
+------------------------------------------------------------------------------------------------+
| .root (100dvh, overflow:hidden)                                                                |
+------------------------------+-----------------------------------------------------------------+
| .chatPanel (340-460px)       | .previewPanel (flex:1)                                          |
| +--------------------------+ | +-------------------------------------------------------------+ |
| | .chatHeader              | | | .previewTopBar (overlay de progresso durante update)        | |
| | [Marca] [Fase]           | | | .saveBadge (Salvando rascunho... / Salvo)  [topo-direita]   | |
| |     [$AiSpend] [Nova]    | | |                                                             | |
| |     [(o) Online]         | | |           .slideWrap (renderer do design)                   | |
| +--------------------------+ | |                                                             | |
| | .thread (scroll unico)   | | +-------------------------------------------------------------+ |
| |                          | | | .slideNav        (<  3 / 6  >)                               | |
| |  [emptyState + sugestoes]| | | .thumbStrip      [1][2][3][4][5][6]                          | |
| |  ...mensagens...         | | +-------------------------------------------------------------+ |
| |  [typingDots]            | |                                                                 |
| |  [questionAccordion]     | |   (vazio + gerando => .buildView: skeleton,                    | |
| |  [progressRow xx%]       | |    barra de progresso, filmstrip)                              | |
| +--------------------------+ |   (vazio + ocioso => "Preview em tempo real")                  | |
| | .btwStrip [/btw x][Asana]| |                                                                 |
| | .attachStrip [img x]     | |                                                                 |
| | .inputWrap               | |                                                                 |
| |  [.slashMenu flutuante]  | |                                                                 |
| |  [FolderPicker]          | |                                                                 |
| |  .inputBar [+][textarea][^]                                                                 |
| | .inputHint (atalhos)     | |                                                                 |
| +--------------------------+ |                                                                 |
+------------------------------+-----------------------------------------------------------------+
```

### 1.4 Elementos fora do fluxo das colunas (overlays)

| Elemento | Posicionamento | Disparo |
|---|---|---|
| `AsanaPopup` | Modal/popup global | `/asana` no slash menu |
| `NotificationCard` | Card fixo (modo revisão / notificações) | `notification` ou `reviewMode` ativos |

---

## 2. Hierarquia de mensagens na thread

A thread é uma **linha do tempo vertical** com alinhamento lateral por papel. Ordem de leitura: topo (mais antigo) → base (mais recente), com smart scroll mantendo o usuário no final, salvo quando ele rola para cima manualmente.

| Tipo | Alinhamento | Container | Fundo / cor | Tipografia | Filhos possíveis |
|---|---|---|---|---|---|
| **Usuário** | Direita | `userRow` > `userBubble` | `var(--color-accent)` (#23221f), texto `#fff` (contraste ~16:1), radius `18px 18px 4px 18px`, `max-width: min(85%, 560px)` | ≥ 14px | Texto principal, `messageAttachments` (pills de anexo), `asanaBlock` (bloco "Contexto Asana" com logo e `<pre>`) — cores dos filhos ajustadas para legibilidade sobre fundo escuro |
| **IA** | Esquerda | `aiRow` > `aiAvatar` (32px, Sparkles) + `aiBubble` | Neutro claro glass (`rgba(255,255,255,0.7)`), texto `--color-text` | ≥ 14px | `thinkingBlock` (colapsável) + `aiText` com `cursor` piscante durante streaming |
| **Sistema / erro** | Largura total | `systemRow` | Avermelhado, texto `#991b1b` | ≥ 12px | Mensagem única de texto |
| **Thinking** | Dentro do bubble da IA | `thinkingBlock` | Bloco discreto colapsável | Metadado ≥ 12px | Header clicável (`<button>` com `aria-expanded`/`aria-controls`) "Mostrar/Ocultar raciocínio" + `thinkingBody` |
| **Pergunta ativa** | Largura total, no fluxo da thread | `questionAccordion` | Card destacado | Pergunta ≥ 14px | `questionMeta` (pill "Pergunta ativa" + modo), `questionHeader` (ícone Sparkles brand + texto), `questionHelper`, `questionOptions` (botões com label + descrição), `questionFreeformWrap` (input + "Enviar outro"), `questionSkipBtn` ("Pular (Automático)") |
| **Indicador de digitação** | Esquerda (posição da IA) | `aiRow` + `aiBubbleLoading` > `typingDots` | Bubble glass com 3 pontos animados (`typingBounce`) | — | Renderizado quando `isStreaming` e última mensagem é do usuário |
| **Barra de progresso** | Largura total, fim da thread | `progressRow` | Card com eyebrow "Fábrica em execução", valor `%`, label e track/bar | Eyebrow/label ≥ 12px em `--color-text-secondary` | Visível apenas com `workerStatus === 'running'`; largura da barra é o único inline style permitido (valor dinâmico) |

Regras de hierarquia:

1. **Uma voz por lado.** Usuário sempre à direita (accent escuro), IA sempre à esquerda (glass neutro com avatar). Nunca inverter.
2. **Sistema interrompe o fluxo.** `systemRow` ocupa a largura total e usa cor de erro — é o único padrão avermelhado na thread.
3. **A pergunta ativa é prioridade máxima.** O accordion mora dentro da thread (acompanha o scroll) e é o único elemento com CTA interativo além das mensagens; enquanto existir `activeQuestion`, o olhar do usuário deve ir para ela.
4. **Progresso não é mensagem.** A `progressRow` é um elemento de status ancorado no fim da thread, separado das bolhas, com `role="status"` e `role="progressbar"`.
5. **Thinking é opt-in.** O raciocínio da IA fica colapsado por padrão; o usuário expande se quiser auditar.

---

## 3. Estados do sistema e feedback visual

Fontes de estado (hook `useFabricaWs`): `phase`, `workerStatus`, `progress`, `isStreaming`, `connected`, `activeQuestion`, `notification`, `reviewMode`, `currentDesign`, `messages`, `saveStatus` (derivado).

| Estado | Condição | Feedback visual | Região afetada | ARIA |
|---|---|---|---|---|
| **Vazio** | `messages.length === 0` | `emptyState`: ícone Sparkles, título "O que você quer criar?", subtítulo explicativo + chips de sugestão (`suggestChips`/`suggestChip`, hover 100% CSS) que preenchem o input ao clicar | Thread | — |
| **Escutando** | `phase === 'listening'`, ocioso | Pill de fase "Escutando" no header; placeholder do textarea "Descreva o que você quer criar..." / "Refine ou peça ajustes..." | Header + input | `chatPhase` |
| **Streaming** | `isStreaming === true` | Cursor piscante (`cursor`) no fim do último bubble da IA; `typingDots` quando a última mensagem é do usuário; placeholder muda para "Gerando... digite algo para adicionar contexto em tempo real"; envio durante streaming vira `/btw` automático | Thread + input | `thread` com `aria-live="polite"` |
| **Gerando (progresso)** | `workerStatus === 'running'` | `progressRow` na thread: eyebrow + `{progress}%` + label + track/bar; no preview: `buildView` (skeleton + barra + label + filmstrip) ou `previewTopBar` se já há design; pill de fase "Gerando" | Thread + preview + header | `progressRow` `role="status"`; `progressTrack` `role="progressbar"` com `aria-valuenow/min/max` |
| **Aguardando resposta** | `activeQuestion` definido | `questionAccordion` na thread com pill "Pergunta ativa", modo (automático/guiado), opções, freeform e pular | Thread | Botões de opção com `title` descritivo |
| **Reconectando** | `connected === false` | `connectionBadge` vira estado offline: dot vermelho (`connectionOffline`), ícone `WifiOff`, label "Reconectando" | Header | `connectionBadge` `role="status"` |
| **Erro** | `msg.role === 'system'` / `workerStatus === 'error'` | `systemRow` avermelhado na thread; pill de fase "Erro" | Thread + header | Texto ≥ 12px `#991b1b` |
| **Salvando rascunho** | `saveStatus === 'saving'` (há design + running) | `saveBadge` absoluto top-right no preview: spinner Loader2 (`saveBadgeSpin`) + "Salvando rascunho…", cor `#92400e` (`saveBadgeSaving`) | Preview | — |
| **Salvo** | `saveStatus === 'saved'` (há design, parado, sem erro) | `saveBadge`: check + "Salvo", cor `#166534` (`saveBadgeSaved`) | Preview | — |
| **Modo revisão** | `reviewMode` ativo / `notification` | `NotificationCard` sobreposto com ações de aprovar/recusar/modo; pill de fase "Revisando" | Overlay global + header | Fornecido pelo componente `NotificationCard` |

Tabela de fases (`phaseLabel`) exibidas na pill do header: Escutando, Refinando, Preparando, Gerando, Revisando, Ajustando, Concluído, Erro.

---

## 4. Funcionalidades específicas preservadas (inventário funcional)

Nenhuma funcionalidade pode ser removida ou degradada na refatoração. A tabela abaixo é o checklist de regressão.

| # | Funcionalidade | Implementação atual | Pontos de atenção na refatoração |
|---|---|---|---|
| 1 | Anexo de arquivo | Botão Paperclip (`iconBtn`) → `<input type="file" accept="image/*,.pdf">` oculto → `fileToBase64` (chunked, 0x8000) → `attachStrip` com remover → enviado como `attachments` na mensagem | Manter accept; pill de anexo legível no bubble escuro do usuário (`messageAttachmentPill`) |
| 2 | Slash commands | `/btw`, `/asana`, `/editor`; menu filtrado por digitação (`slashSearch`); navegação ArrowUp/ArrowDown (circular), Enter aplica, Escape fecha; `onMouseDown` com `preventDefault` para não perder foco | `slashMenu` com `role="listbox"`, itens `role="option"` + `aria-selected`; descrições em `--color-text-secondary` |
| 3 | Pills de contexto `/btw` | Texto `/btw <ctx>` acumula em `btwContext`; durante streaming, qualquer envio vira `/btw` automático; pills removíveis com X | Pills com contraste adequado; botão X com alvo de toque razoável |
| 4 | Integração Asana | `AsanaPopup` (abrir via `/asana`) injeta texto em `asanaContext`; pill `asanaPill` com logo e primeira tarefa truncada em 28+2 chars; no bubble do usuário renderiza `asanaBlock` (header com logo + `<pre>`) | `asanaBlock*` legível sobre fundo accent escuro |
| 5 | Nova conversa | Botão "Nova" (`MessageSquarePlus`) com `window.confirm` quando streaming/running; `resetSession()` + `router.replace` + limpa inputs/pills/slide/popup | Substituir inline style por `newConvBtn`; `aria-label="Iniciar nova conversa"` |
| 6 | Smart scroll | `isScrolledUp` ref: se o usuário rolou >50px do fim, o auto-scroll para; `onScroll` atualiza a flag; `requestAnimationFrame` no effect | Preservar exatamente este comportamento |
| 7 | Permissões por papel | `useBrandPermissions`: `canGenerate = can('generate')`; sem permissão, `sendBtn` desabilitado com `title={permHint}` e `inputHint` exibe o hint no lugar dos atalhos | Nunca depender de erro 403 pós-fila; hint sempre visível |
| 8 | Persistência de sessão | `sessionId` capturado uma vez (lazy init da URL/sessionStorage) e regravado no `sessionStorage` a cada mudança — evita ciclo conecta→reconecta | Não reintroduzir leitura por render |
| 9 | Textarea auto-resize | `useLayoutEffect`: altura de 22px até 160px conforme conteúdo | Preservar; min-height da barra 48px |
| 10 | Preview | `ArtifactPanel` envolvendo `previewContent`; renderers por `kind` (`HtmlSlideRenderer`, `IRSlideRenderer`, `DesignRenderer` legacy); nav de slides (`slideNav` com ‹ › e label n/N) + `thumbStrip`; índice clampeado (`safeSlide`) derivado | Preview permanece à direita no desktop e no topo no mobile |
| 11 | FolderPicker | Destino do deck escolhido antes de gerar; `disabled={isStreaming}` | Manter dentro de `inputWrap`, acima da inputBar |

---

## 5. Responsivo

| Breakpoint | Layout | Regras |
|---|---|---|
| **Desktop (> 900px)** | 2 colunas lado a lado | `.chatPanel` fluido `width: clamp(340px, 38vw, 460px)`, `flex-shrink: 0`; `.previewPanel` `flex: 1`; thread com scroll independente; header/input fixos no painel |
| **≤ 900px** | Coluna única | `.root` vira `flex-direction: column`; `.previewPanel` sobe (`order: -1`) com `max-height: 42vh`; `.chatPanel` ocupa o restante em largura total; **input nunca pode ser cortado** — todas as regiões não-roláveis permanecem `flex-shrink: 0` e a thread absorve o espaço residual |

Correções de corte obrigatórias (bugs diagnosticados no contrato):

1. **Altura da raiz:** `.root` hoje usa `height: 100%`, mas a página não está dentro de AppShell → trocar para `height: 100vh; height: 100dvh;` com `overflow: hidden` (já existente) e `min-height: 0` nos filhos flex. `100dvh` cobre a barra dinâmica de endereço em mobile.
2. **Padding fantasma de 100px:** as classes `.progressRow`, `.progressHeader`, `.progressEyebrow`, `.progressValue`, `.progressTrack`, `.progressBar` e `.progressLabel` estão definidas duas vezes no CSS (linhas ~270 e ~391); a segunda versão impõe `padding-top: 100px; padding-bottom: 100px`, gerando um cartão de progresso gigante que quebra o layout. Unificar em UMA definição por classe, sem os 100px. Este é o bug crítico nº 1 do contrato.
3. **Overflow vertical:** com o progressRow corrigido e `min-height: 0` propagado, o painel inteiro cabe em `100dvh` sem scroll da página — apenas a thread rola.

---

## 6. Acessibilidade

### 6.1 Contraste e tipografia

| Regra | Alvo | Aplicação |
|---|---|---|
| Contraste de texto | ≥ 4.5:1 (WCAG AA) | Texto migrado de `--color-text-tertiary` (#96948f ≈ 2.9:1) para `--color-text-secondary`; tertiary permitido apenas em ícones/decorativo e placeholder (placeholder não é conteúdo) |
| Conteúdo | ≥ 14px | `userBubble`, `aiText`, `inputField`, opções de pergunta |
| Metadados / labels | ≥ 12px | `inputHint`, eyebrow de progresso, descrições, pills de fase/conexão |
| Referências de contraste já validadas | — | Bubble do usuário `#fff` sobre `#23221f` ≈ 16:1; erro `#991b1b` sobre fundo avermelhado claro |

### 6.2 Foco visível

Hoje não existe nenhum `:focus-visible`. Adicionar em TODOS os interativos:

```
outline: 2px solid var(--color-brand);
outline-offset: 2px;
```

Aplica-se a: botões (`newConvBtn`, `sendBtn`, `iconBtn`, `pillRemove`, `attachRemove`, `questionOptionBtn`, `questionFreeformBtn`, `questionSkipBtn`, `suggestChip`, `slideNavBtn`, `thumb`, header do `thinkingBlock`), textarea via `.inputBar:focus-within`, e itens do slash menu.

### 6.3 Roles e ARIA

| Elemento | Atributo |
|---|---|
| `thread` | `role="log"` `aria-live="polite"` `aria-label="Conversa com a fábrica"` |
| `thinkingBlock` header | `<button type="button">` com `aria-expanded` e `aria-controls` (ids via `useId`) |
| textarea | `aria-label="Mensagem para a fábrica"` + `aria-describedby` apontando para o id do `inputHint` |
| `sendBtn` | `aria-label="Enviar mensagem"` |
| `iconBtn` (anexo) | `aria-label="Anexar arquivo"` |
| botão Nova | `aria-label="Iniciar nova conversa"` |
| `slashMenu` | `role="listbox"`; itens `role="option"` `aria-selected={i === slashIdx}` |
| `connectionBadge` | `role="status"` |
| `progressRow` | `role="status"` |
| `progressTrack` | `role="progressbar"` `aria-valuenow={progress}` `aria-valuemin={0}` `aria-valuemax={100}` |
| Utilitário | Classe `visuallyHidden` (sr-only) para textos exclusivos de leitor de tela |

### 6.4 Reduced motion

Adicionar bloco `@media (prefers-reduced-motion: reduce)` desligando: `slowDrift` (fundo do painel), `slideUpFadeMsg` (entrada de mensagens), `typingBounce` (pontos de digitação), `buildShimmer`, `buildPulse`, `sendGlow`, `blink` (cursor de streaming). Elementos de status (dots, spinner) permanecem legíveis em estado estático.

### 6.5 Navegação por teclado (já existente, preservar)

- `Enter` envia; `Shift+Enter` quebra linha.
- Com slash menu aberto: `ArrowUp`/`ArrowDown` navegam (circular), `Enter` aplica, `Escape` fecha.
- Todos os controles alcançáveis por Tab em ordem visual: header → thread (controles internos) → pills → anexo → FolderPicker → inputBar → hint é apenas texto.

---

## 7. Nota de decisão: por que este chat NÃO usa max-width de 860px

**Decisão registrada:** o chat da Fábrica não adota a medida centralizada de leitura (`max-width: 860px` ou similar) usada em páginas de conteúdo/documentação.

Justificativa:

1. **É um painel lateral, não uma coluna de conteúdo.** O `chatPanel` tem largura controlada por `clamp(340px, 38vw, 460px)` — ele nunca se aproxima de 860px em nenhum viewport. Aplicar um max-width de leitura seria redundante e criaria espaço morto dentro do painel.
2. **A medida de leitura já é confortável.** Com 340–460px de largura e fonte ≥ 14px, as linhas dos bubbles ficam na faixa de ~50–70 caracteres, que é exatamente a medida recomendada para leitura. O bubble do usuário ainda limita-se a `max-width: min(85%, 560px)` dentro do painel, evitando linhas longas mesmo no limite superior.
3. **O restante da tela tem outra função.** A coluna direita é um preview visual (canvas do design), não texto corrido — medidas de tipografia não se aplicam a ela.

**Consequência:** qualquer ajuste de largura deve ser feito via `clamp()` do painel e `max-width` interno dos bubbles, nunca via wrapper centralizador de página.

---

## 8. Resumo das decisões de IA (checklist de aceite)

1. Layout de 2 colunas com raiz em `100dvh` e overflow travado; apenas a thread rola.
2. Chat à esquerda com largura fluida 340–460px; preview à direita (`flex: 1`).
3. Ordem vertical do painel: header → thread → pills → anexo → inputBar (com FolderPicker e slash menu) → hint.
4. Hierarquia de mensagens: usuário direita/accent, IA esquerda/glass com avatar, sistema em largura total avermelhado, thinking colapsável, pergunta ativa como accordion no fluxo, typing e progresso como elementos de status separados.
5. Todos os 10 estados da seção 3 têm feedback visual definido e mapeado para ARIA.
6. As 11 funcionalidades da seção 4 são preservadas integralmente.
7. ≤900px: coluna única, preview em cima (≤42vh), chat embaixo, input nunca cortado.
8. AA de contraste, ≥14px conteúdo, focus-visible em todos os interativos, roles/aria conforme tabela, reduced-motion cobrindo as 7 animações nomeadas.
9. Sem max-width de 860px — decisão registrada na seção 7.
